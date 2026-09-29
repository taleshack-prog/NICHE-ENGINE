"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callClaudeStructured, iaDisponivel } from "@/lib/ai";
import { aplicarCapa, formatoValido, renderizarCapa } from "@/lib/capa";
import { prisma } from "@/lib/db";
import {
  CUSTO_CLIPE_USD,
  RESTRICOES_VISUAIS,
  SEGUNDOS_POR_CLIPE,
  VOZES_PT_BR,
  falDisponivel,
  gerarImagens,
  gerarNarracao,
  gerarVideo,
  legendarVideo,
  montarVideo,
  transcrever,

} from "@/lib/fal";
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

/** Teto de clipes por Reel. Ver a guarda de custo em `estimar`. */
const TETO_CLIPES = Number(process.env.REEL_MAX_CLIPES || "12");

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

const gerarReelSchema = z.object({
  postId: idSchema,
  voz: z.enum(VOZES_PT_BR).optional(),
  velocidade: z.coerce.number().min(0.7).max(1.4).optional(),
});

const porOrdem = (a: MidiaItem, b: MidiaItem) => (a.ordem ?? 0) - (b.ordem ?? 0);

export type ResultadoReel = {
  videoUrl: string;
  clipes: number;
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
    // Reconstruída das cenas quando elas existem: re-transcrever devolveria
    // tempos ligeiramente diferentes e os clipes já prontos sairiam do lugar.
    const cenasGravadas = midia.filter((m) => m.papel === "cena").sort(porOrdem);
    let blocos: Bloco[];

    if (cenasGravadas.length > 0) {
      blocos = cenasGravadas.map((c, i) => ({
        ordem: c.ordem ?? i + 1,
        inicioMs: c.inicioMs ?? 0,
        duracaoMs: c.duracaoMs ?? SEGUNDOS_POR_CLIPE * 1000,
        texto: c.texto ?? "",
      }));
    } else {
      blocos = blocosDaNarracao(await transcrever(narracao.url), SEGUNDOS_POR_CLIPE * 1000);
    }

    const custoEstimadoUsd = Number((blocos.length * CUSTO_CLIPE_USD).toFixed(2));
    if (blocos.length > TETO_CLIPES) {
      const seg = Math.round(
        blocos.reduce((a, b) => Math.max(a, b.inicioMs + b.duracaoMs), 0) / 1000,
      );
      throw new Error(
        `A narração tem ${seg}s e exigiria ${blocos.length} clipes (~US$ ${custoEstimadoUsd}), acima do teto de ${TETO_CLIPES}. Encurte o roteiro ou aumente REEL_MAX_CLIPES no .env.`,
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

    // ── 4. Clipes ──────────────────────────────────────────────────
    // Em série e gravando a cada um: é a etapa cara. Em paralelo, uma falha
    // no meio perderia os clipes já pagos que ainda não foram persistidos.
    const cenas = lista.filter((m) => m.papel === "cena").sort(porOrdem);
    for (const cena of cenas) {
      if (lista.some((m) => m.papel === "clipe" && m.ordem === cena.ordem)) {
        reaproveitados++;
        continue;
      }
      const clipe = await gerarVideo(cena.url, cena.promptUsado ?? "slow cinematic push-in");
      lista = [
        ...lista,
        {
          ...clipe,
          papel: "clipe",
          ordem: cena.ordem,
          inicioMs: cena.inicioMs,
          duracaoMs: cena.duracaoMs,
          origemUrl: cena.url,
        },
      ];
      await salvar(lista);
    }

    // ── 5. Montagem + legenda ──────────────────────────────────────
    const clipes = lista.filter((m) => m.papel === "clipe").sort(porOrdem);
    const duracaoTotalMs = clipes.reduce(
      (a, c) => Math.max(a, (c.inicioMs ?? 0) + (c.duracaoMs ?? 0)),
      0,
    );

    let final = lista.find((m) => m.papel === "final");
    if (final) {
      reaproveitados++;
    } else {
      // A montagem só é gravada DEPOIS da legenda. Compor é barato (ffmpeg) e
      // gravar no meio criaria um estado em que a retomada pula a legenda e
      // publica o vídeo mudo de texto — falha silenciosa, a pior espécie.
      const montado = await montarVideo({
        clipes: clipes.map((c) => ({
          url: c.url,
          inicioMs: c.inicioMs ?? 0,
          duracaoMs: c.duracaoMs ?? SEGUNDOS_POR_CLIPE * 1000,
        })),
        audioUrl: narracao.url,
        duracaoTotalMs,
      });

      const legendado = await legendarVideo(montado.videoUrl, { corpo: LEGENDA_CORPO });
      final = {
        tipo: "video",
        url: legendado.videoUrl,
        papel: "final",
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
      clipes: clipes.length,
      duracaoSeg: Math.round(duracaoTotalMs / 1000),
      custoEstimadoUsd,
      reaproveitados,
    };
  });
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
    const clipes = midia.filter((m) => m.papel === "clipe").sort(porOrdem);

    if (!narracao || clipes.length === 0) {
      throw new Error(
        "As etapas do Reel não estão mais gravadas (narração e clipes). Gere o Reel novamente.",
      );
    }

    const corpo = d.corpo ?? LEGENDA_CORPO;
    const duracaoTotalMs = clipes.reduce(
      (a, c) => Math.max(a, (c.inicioMs ?? 0) + (c.duracaoMs ?? 0)),
      0,
    );

    const montado = await montarVideo({
      clipes: clipes.map((c) => ({
        url: c.url,
        inicioMs: c.inicioMs ?? 0,
        duracaoMs: c.duracaoMs ?? SEGUNDOS_POR_CLIPE * 1000,
      })),
      audioUrl: narracao.url,
      duracaoTotalMs,
    });

    const legendado = await legendarVideo(montado.videoUrl, { corpo });

    const lista: MidiaItem[] = [
      ...midia.filter((m) => m.papel !== "final"),
      {
        tipo: "video",
        url: legendado.videoUrl,
        papel: "final",
        criadoEm: new Date().toISOString(),
      },
    ];

    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia(lista) },
    });

    revalidatePath("/producao");
    return { videoUrl: legendado.videoUrl, corpo };
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
