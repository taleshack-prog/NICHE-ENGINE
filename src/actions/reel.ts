"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callClaudeStructured, iaDisponivel } from "@/lib/ai";
import { aplicarCapa, formatoValido, renderizarCapa } from "@/lib/capa";
import { prisma } from "@/lib/db";
import {
  CUSTO_IMAGEM_USD,
  RESTRICOES_VISUAIS,
  VOZES_PT_BR,
  falDisponivel,
  gerarImagens,
  gerarNarracao,
  transcrever,
} from "@/lib/fal";
import { agruparCues, montarVideoLocal, movimentoPadrao } from "@/lib/montagem";
import { gravarMidia, lerMidia, type MidiaItem } from "@/lib/json-fields";
import {
  ESCALA_EM_INGLES,
  gerarCenasPrompt,
  gerarCenasSchema,
  interpolar,
} from "@/lib/prompts";
import { blocosDaNarracao, blocosParaPrompt, textoNarravel, type Bloco } from "@/lib/reel";
import { acao, idSchema, type ActionResult } from "./_shared";

/**
 * Reel completo: roteiro → narração → cenas → clipes → montagem → legenda.
 *
 * POR QUE EXISTE: o sistema sabia gerar UMA imagem e animá-la num clipe solto.
 * Isso não é um Reel — é um plano único com quarenta segundos de duração, que
 * o espectador abandona antes do quinto segundo. Um Reel faceless que retém
 * tem quatro camadas: voz, corte, legenda queimada e capa. Faltavam três.
 *
 * RETOMÁVEL POR CONSTRUÇÃO. Cada etapa grava o que produziu em `midiaPaths`
 * com um `papel`, e a execução seguinte pula o que já existe. Um Reel leva
 * minutos e dezenas de chamadas pagas: sem isso, uma falha no último passo
 * mandaria pagar a cadeia inteira de novo — e a narração nova teria tempos
 * diferentes, invalidando todos os clipes já produzidos.
 */

/**
 * Segundos de tela por cena.
 *
 * Era 5 porque o Kling entregava clipes de 5 segundos — limite do fornecedor,
 * não escolha de edição. Com a montagem local a duração é livre, e 6 segundos
 * é o ritmo de b-roll documental: tempo de ler a imagem sem ela cansar.
 */
const SEGUNDOS_POR_CENA = Number(process.env.REEL_SEGUNDOS_POR_CENA || "6");

/** Teto de cenas por vídeo. Guarda de custo: cada cena é uma imagem paga. */
const TETO_CENAS = Number(process.env.REEL_MAX_CENAS || "24");

/**
 * Corpo da legenda queimada, em pixels do vídeo final.
 *
 * O default do auto-caption é 24, pensado para vídeo horizontal, e some num
 * quadro vertical. O primeiro palpite daqui foi 64 e ficou grande demais na
 * tela: a linha ocupava quase toda a largura. 44 fica na faixa de 5-7% da
 * largura, que é onde as legendas de Reel costumam viver — e é ajustável,
 * porque o tamanho certo depende da resolução que o modelo de vídeo devolve.
 */
const LEGENDA_CORPO = Number(process.env.REEL_LEGENDA_CORPO || "44");

/** Estilo da legenda queimada, agora decidido aqui e não por um serviço pago. */
const estiloLegenda = () => ({ corpo: LEGENDA_CORPO, fonte: "Poppins" });

const gerarReelSchema = z.object({
  postId: idSchema,
  voz: z.enum(VOZES_PT_BR).optional(),
  velocidade: z.coerce.number().min(0.7).max(1.4).optional(),
});

const porOrdem = (a: MidiaItem, b: MidiaItem) => (a.ordem ?? 0) - (b.ordem ?? 0);

export type ResultadoReel = {
  videoUrl: string;
  cenas: number;
  duracaoSeg: number;
  custoEstimadoUsd: number;
  reaproveitados: number;
};

export async function gerarReel(entrada: unknown): Promise<ActionResult<ResultadoReel>> {
  return acao(gerarReelSchema, entrada, async (d) => {
    if (!iaDisponivel()) throw new Error("ANTHROPIC_API_KEY não configurada (Fase 2).");
    if (!falDisponivel()) throw new Error("FAL_KEY não configurada (Fase 3).");

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      include: { nicho: { select: { nome: true, subNicho: true } } },
    });

    if (!post.roteiro?.trim()) {
      throw new Error(
        "Gere ou escreva o roteiro antes — o Reel é a narração dele, não um texto novo.",
      );
    }
    if (post.formato !== "reel") {
      throw new Error(
        `Este post está gravado como "${post.formato}". Mude o Formato para Reel no topo do editor e clique em Salvar — para carrossel, o botão é o Carrossel.`,
      );
    }

    let midia = lerMidia(post.midiaPaths);
    let reaproveitados = 0;

    // Grava a cada etapa: é isto que torna a geração retomável depois de um
    // timeout do navegador, que num Reel de 8 clipes é cenário provável.
    const salvar = async (lista: MidiaItem[]) => {
      midia = lista;
      await prisma.post.update({
        where: { id: post.id },
        data: { midiaPaths: gravarMidia(lista) },
      });
      revalidatePath("/producao");
    };

    // ── 1. Narração ────────────────────────────────────────────────
    let narracao = midia.find((m) => m.papel === "narracao");
    if (narracao) {
      reaproveitados++;
    } else {
      const { url } = await gerarNarracao(textoNarravel(post.roteiro), {
        voz: d.voz,
        velocidade: d.velocidade,
      });
      narracao = {
        tipo: "audio",
        url,
        papel: "narracao",
        texto: textoNarravel(post.roteiro).slice(0, 300),
        criadoEm: new Date().toISOString(),
      };
      await salvar([...midia, narracao]);
    }

    // ── 2. Linha do tempo ──────────────────────────────────────────
    // Transcrição no nível de PALAVRA: ela serve a dois fins — recortar as
    // cenas e cronometrar a legenda. É barata, então roda também na retomada;
    // guardar palavra por palavra no banco pesaria mais do que o que custa
    // pedir de novo.
    const palavras = await transcrever(narracao.url, "word");

    // Os blocos vêm das cenas quando elas existem: recalcular devolveria
    // limites ligeiramente diferentes e as imagens já pagas sairiam do lugar.
    const cenasGravadas = midia.filter((m) => m.papel === "cena").sort(porOrdem);
    const blocos: Bloco[] =
      cenasGravadas.length > 0
        ? cenasGravadas.map((c, i) => ({
            ordem: c.ordem ?? i + 1,
            inicioMs: c.inicioMs ?? 0,
            duracaoMs: c.duracaoMs ?? SEGUNDOS_POR_CENA * 1000,
            texto: c.texto ?? "",
          }))
        : blocosDaNarracao(palavras, SEGUNDOS_POR_CENA * 1000);

    const custoEstimadoUsd = Number((blocos.length * CUSTO_IMAGEM_USD).toFixed(2));
    if (blocos.length > TETO_CENAS) {
      const seg = Math.round(
        blocos.reduce((a, b) => Math.max(a, b.inicioMs + b.duracaoMs), 0) / 1000,
      );
      throw new Error(
        `A narração tem ${seg}s e exigiria ${blocos.length} cenas (~US$ ${custoEstimadoUsd}), acima do teto de ${TETO_CENAS}. Encurte o roteiro ou aumente REEL_MAX_CENAS no .env.`,
      );
    }

    // ── 3. Cenas (imagens) ─────────────────────────────────────────
    let lista = [...midia];
    if (cenasGravadas.length < blocos.length) {
      const plano = await callClaudeStructured(
        interpolar(gerarCenasPrompt, {
          nicho: [post.nicho.nome, post.nicho.subNicho].filter(Boolean).join(" / "),
          blocos: blocosParaPrompt(blocos),
        }),
        gerarCenasSchema,
        { tarefa: "roteiro", maxTokens: 4096 },
      );

      // Tolerante a contagem divergente: a narração já foi paga, e recusar
      // aqui jogaria fora o passo mais caro por causa de uma cena a mais.
      const cenas = blocos.map(
        (b, i) => plano.cenas[i] ?? plano.cenas[plano.cenas.length - 1] ?? plano.cenas[0],
      );

      const imagens = await Promise.all(
        blocos.map((b, i) => {
          const existente = cenasGravadas.find((c) => c.ordem === b.ordem);
          if (existente) return Promise.resolve(existente);
          const cena = cenas[i];
          // Escala e motivo entram por fora do texto livre: são os dois campos
          // que o schema garante — a escala por não repetir em sequência, o
          // motivo por ser o mesmo em todas as cenas.
          const prompt = [
            cena?.promptVisual ?? b.texto,
            cena ? ESCALA_EM_INGLES[cena.escala] : "",
            plano.motivo,
            plano.direcaoVisual,
            RESTRICOES_VISUAIS,
          ]
            .filter(Boolean)
            .join(". ");
          return gerarImagens(prompt, { quantidade: 1, aspecto: "portrait_16_9" }).then(
            ([img]): MidiaItem => ({
              tipo: "imagem",
              url: img?.url ?? "",
              papel: "cena",
              ordem: b.ordem,
              inicioMs: b.inicioMs,
              duracaoMs: b.duracaoMs,
              texto: b.texto.slice(0, 300),
              // O movimento de câmera vai junto: é o prompt do clipe, e sem
              // ele a retomada teria que chamar a IA de cenas outra vez.
              promptUsado: cena?.movimento ?? "slow cinematic push-in",
              criadoEm: new Date().toISOString(),
            }),
          );
        }),
      );

      const faltando = imagens.find((m) => !m.url);
      if (faltando) throw new Error(`o fal.ai não devolveu imagem para a cena ${faltando.ordem}.`);

      lista = [...lista.filter((m) => m.papel !== "cena"), ...imagens];
      await salvar(lista);
    } else {
      reaproveitados += cenasGravadas.length;
    }

    // ── 4. Montagem local ──────────────────────────────────────────
    // Aqui estava a geração de um clipe image-to-video por cena: US$ 0,35 cada,
    // ~90% da conta do vídeo, na camada que menos mudava o resultado. O
    // movimento de câmera é feito agora pelo ffmpeg sobre a imagem fixa —
    // custo zero, e para narração documental é a linguagem certa.
    const cenas = lista.filter((m) => m.papel === "cena").sort(porOrdem);

    let final = lista.find((m) => m.papel === "final");
    if (final) {
      reaproveitados++;
    } else {
      const montado = await montarVideoLocal({
        cenas: cenas.map((c, i) => ({
          ordem: c.ordem ?? i + 1,
          imagemUrl: c.url,
          duracaoMs: c.duracaoMs ?? SEGUNDOS_POR_CENA * 1000,
          // Alternância determinística: a mesma lista monta igual duas vezes,
          // então comparar duas montagens mede a sua mudança, não o sorteio.
          movimento: movimentoPadrao(c.ordem ?? i + 1),
        })),
        audioUrl: narracao.url,
        legendas: agruparCues(palavras),
        formato: "vertical",
        estiloLegenda: estiloLegenda(),
        chave: post.id,
      });

      final = {
        tipo: "video",
        url: montado.url,
        papel: "final",
        duracaoMs: montado.duracaoSeg * 1000,
        criadoEm: new Date().toISOString(),
      };
      lista = [...lista, final];
      await salvar(lista);
    }

    // ── 6. Capa ────────────────────────────────────────────────────
    // Sobre a PRIMEIRA cena, limpa. No Reel a capa não é quadro do vídeo: vai
    // como `cover_url` do container (ver src/lib/meta.ts).
    const texto = post.coverText?.trim();
    const base = cenas[0]?.url;
    if (texto && base && !lista.some((m) => m.papel === "capa")) {
      try {
        const capa = await renderizarCapa({
          imagemUrl: base,
          texto,
          formato: formatoValido(post.formato),
        });
        await salvar(aplicarCapa(lista, base, capa.url));
      } catch {
        // Vídeo pronto vale mais que capa: a capa tem botão próprio no editor.
      }
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { status: post.status === "rascunho" ? "produzindo" : post.status },
    });
    revalidatePath("/producao");
    revalidatePath("/");

    return {
      videoUrl: final.url,
      cenas: cenas.length,
      duracaoSeg: Math.round((final.duracaoMs ?? 0) / 1000),
      custoEstimadoUsd,
      reaproveitados,
    };
  });
}

/**
 * Gera só a narração, para ouvir antes de pagar os clipes.
 *
 * POR QUE EXISTE: voz e velocidade são gosto, não acerto técnico — eu errei a
 * velocidade por palpite e o defeito só apareceu depois de oito clipes pagos.
 * A narração custa uma fração de um clipe; testá-la isolada é a diferença
 * entre ajustar por centavos e ajustar por US$ 3.
 *
 * Descarta cenas, clipes e vídeo final: voz nova tem tempos novos, e manter os
 * clipes antigos deixaria imagem e fala fora de sincronia — silenciosamente,
 * porque nada falharia.
 */
export async function previaNarracao(
  entrada: unknown,
): Promise<ActionResult<{ url: string; descartados: number }>> {
  return acao(
    z.object({
      postId: idSchema,
      voz: z.enum(VOZES_PT_BR).optional(),
      velocidade: z.coerce.number().min(0.7).max(1.4).optional(),
    }),
    entrada,
    async (d) => {
      if (!falDisponivel()) throw new Error("FAL_KEY não configurada (Fase 3).");

      const post = await prisma.post.findUniqueOrThrow({
        where: { id: d.postId },
        select: { id: true, roteiro: true, midiaPaths: true },
      });
      if (!post.roteiro?.trim()) throw new Error("Escreva ou gere o roteiro antes.");

      const { url } = await gerarNarracao(textoNarravel(post.roteiro), {
        voz: d.voz,
        velocidade: d.velocidade,
      });

      const antes = lerMidia(post.midiaPaths);
      const obsoletos = new Set(["narracao", "cena", "clipe", "final"]);
      const lista: MidiaItem[] = [
        ...antes.filter((m) => !obsoletos.has(m.papel ?? "")),
        {
          tipo: "audio",
          url,
          papel: "narracao",
          texto: textoNarravel(post.roteiro).slice(0, 300),
          criadoEm: new Date().toISOString(),
        },
      ];

      await prisma.post.update({
        where: { id: post.id },
        data: { midiaPaths: gravarMidia(lista) },
      });

      revalidatePath("/producao");
      return { url, descartados: antes.filter((m) => obsoletos.has(m.papel ?? "")).length };
    },
  );
}

const refazerLegendaSchema = z.object({
  postId: idSchema,
  corpo: z.coerce.number().int().min(18).max(120).optional(),
});

/**
 * Remonta e relegenda a partir dos clipes já gerados.
 *
 * O tamanho certo da legenda depende da resolução que o modelo de vídeo
 * devolveu, que varia por tier — não dá para acertar por palpite na primeira
 * vez. Sem esta ação, ajustar o corpo da fonte exigiria descartar tudo e pagar
 * oito clipes de novo por causa de um número.
 *
 * Montagem e legenda são as duas etapas baratas da cadeia: nenhuma chamada ao
 * Kling acontece aqui.
 */
export async function refazerLegenda(
  entrada: unknown,
): Promise<ActionResult<{ videoUrl: string; corpo: number }>> {
  return acao(refazerLegendaSchema, entrada, async (d) => {
    if (!falDisponivel()) throw new Error("FAL_KEY não configurada (Fase 3).");

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      select: { id: true, midiaPaths: true },
    });

    const midia = lerMidia(post.midiaPaths);
    const narracao = midia.find((m) => m.papel === "narracao");
    const cenas = midia.filter((m) => m.papel === "cena").sort(porOrdem);

    if (!narracao || cenas.length === 0) {
      throw new Error(
        "As etapas do Reel não estão mais gravadas (narração e cenas). Gere o Reel novamente.",
      );
    }

    const corpo = d.corpo ?? LEGENDA_CORPO;

    // Remontar ficou grátis: a única chamada paga aqui é a transcrição, que
    // custa frações de centavo. Antes isto exigia duas chamadas a serviços de
    // vídeo; ajustar o tamanho da legenda não deveria custar nada.
    const montado = await montarVideoLocal({
      cenas: cenas.map((c, i) => ({
        ordem: c.ordem ?? i + 1,
        imagemUrl: c.url,
        duracaoMs: c.duracaoMs ?? SEGUNDOS_POR_CENA * 1000,
        movimento: movimentoPadrao(c.ordem ?? i + 1),
      })),
      audioUrl: narracao.url,
      legendas: agruparCues(await transcrever(narracao.url, "word")),
      formato: "vertical",
      estiloLegenda: { corpo, fonte: "Poppins" },
      chave: `${post.id}-${corpo}`,
    });

    const lista: MidiaItem[] = [
      ...midia.filter((m) => m.papel !== "final"),
      {
        tipo: "video",
        url: montado.url,
        papel: "final",
        duracaoMs: montado.duracaoSeg * 1000,
        criadoEm: new Date().toISOString(),
      },
    ];

    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia(lista) },
    });

    revalidatePath("/producao");
    return { videoUrl: montado.url, corpo };
  });
}

/**
 * Descarta etapas para refazer. A retomada é cega — ela reaproveita tudo que
 * encontra —, então refazer exige dizer explicitamente o que não serve mais.
 *
 * "visual" preserva a narração: o roteiro continua o mesmo, só as imagens
 * mudam. Preservar também mantém a LINHA DO TEMPO idêntica, porque uma
 * narração nova teria tempos ligeiramente diferentes e a comparação entre a
 * tentativa velha e a nova deixaria de ser justa.
 */
export async function limparEtapasReel(
  entrada: unknown,
): Promise<ActionResult<{ removidos: number }>> {
  return acao(
    z.object({ postId: idSchema, alvo: z.enum(["visual", "tudo"]).default("visual") }),
    entrada,
    async (d) => {
      const post = await prisma.post.findUniqueOrThrow({
        where: { id: d.postId },
        select: { id: true, midiaPaths: true },
      });

      const descartar: ReadonlySet<string> =
        d.alvo === "tudo"
          ? new Set(["narracao", "cena", "clipe", "final"])
          : new Set(["cena", "clipe", "final"]);

      const antes = lerMidia(post.midiaPaths);
      const depois = antes.filter((m) => !descartar.has(m.papel ?? ""));

      await prisma.post.update({
        where: { id: post.id },
        data: { midiaPaths: gravarMidia(depois) },
      });

      revalidatePath("/producao");
      return { removidos: antes.length - depois.length };
    },
  );
}
