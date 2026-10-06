"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aplicarCapa, formatoValido, renderizarCapa, renderizarSlide } from "@/lib/capa";
import { callClaudeStructured, iaDisponivel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { TIPOS_MIDIA } from "@/lib/domain";
import {
  RESTRICOES_VISUAIS,
  falDisponivel,
  gerarImagens,
  gerarVideo,
  promptVisualDeRoteiro,
} from "@/lib/fal";
import { gravarMidia, lerMidia, type MidiaItem } from "@/lib/json-fields";
import { gerarSlidesPrompt, gerarSlidesSchema, interpolar } from "@/lib/prompts";
import { acao, idSchema, type ActionResult } from "./_shared";

/**
 * Geração de mídia (Fase 3).
 *
 * Imagem é síncrona. Vídeo passa por fila do fal.ai e pode levar minutos: a
 * action espera com teto de tentativas (ver src/lib/fal.ts). Para volume, o
 * caminho certo é o Workflow A do n8n, não o clique no dashboard.
 */

const gerarCapaSchema = z.object({
  postId: idSchema,
  /** Imagem base. Sem isto, usa a primeira imagem da lista. */
  imagemUrl: z.string().min(1).optional(),
});

/**
 * Queima o coverText numa das imagens do post.
 *
 * Existe como ação separada — e não só como efeito da geração — porque o
 * usuário escolhe entre as 3 imagens que o FLUX devolve, e porque editar o
 * coverText à mão precisa de um jeito de reaplicar sem pagar geração nova.
 */
export async function gerarCapa(entrada: unknown): Promise<ActionResult<{ url: string }>> {
  return acao(gerarCapaSchema, entrada, async (d) => {
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      select: { id: true, coverText: true, formato: true, midiaPaths: true },
    });

    const texto = post.coverText?.trim();
    if (!texto) {
      throw new Error(
        "Este post não tem texto de capa. Clique em Gerar copy, ou escreva o campo Cover text e salve, antes de gerar a capa.",
      );
    }

    const lista = lerMidia(post.midiaPaths);
    const alvo = d.imagemUrl ?? lista.find((m) => m.tipo === "imagem")?.url;
    if (!alvo) {
      throw new Error("Não há imagem para servir de fundo. Gere ou anexe uma imagem primeiro.");
    }

    // Reaplicar sobre a própria capa empilharia texto sobre texto a cada
    // clique; a base correta é sempre a imagem limpa que a originou.
    const item = lista.find((m) => m.url === alvo);
    const origem = item?.papel === "capa" ? (item.origemUrl ?? item.url) : alvo;

    const capa = await renderizarCapa({
      imagemUrl: origem,
      texto,
      formato: formatoValido(post.formato),
    });

    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia(aplicarCapa(lista, origem, capa.url)) },
    });

    revalidatePath("/producao");
    return { url: capa.url };
  });
}

/**
 * Carrossel completo a partir do roteiro: texto em TODOS os slides.
 *
 * POR QUE EXISTE: o roteiro nasce para narração e ficava no banco como texto
 * corrido. O post saía com uma capa escrita e duas imagens decorativas — uma
 * capa com anexos. Carrossel que retém tem uma ideia por tela, progressão entre
 * elas e um pedido no fim; nada disso acontece sem alguém quebrar o roteiro.
 *
 * A IA devolve também uma `direcaoVisual` única aplicada a todos os prompts de
 * imagem. Sem ela, cada slide saía de um banco de imagens diferente — o defeito
 * mais visível do primeiro carrossel real que este sistema produziu.
 */
export async function gerarCarrossel(
  entrada: unknown,
): Promise<ActionResult<{ slides: number; custoImagens: number }>> {
  return acao(z.object({ postId: idSchema }), entrada, async (d) => {
    if (!iaDisponivel()) throw new Error("ANTHROPIC_API_KEY não configurada (Fase 2).");
    if (!falDisponivel()) throw new Error("FAL_KEY não configurada (Fase 3).");

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      include: { nicho: { select: { nome: true, subNicho: true, persona: true } } },
    });

    if (!post.roteiro?.trim()) {
      throw new Error(
        "Gere ou escreva o roteiro antes — os slides são a quebra dele, não um texto novo.",
      );
    }
    if (post.formato === "reel") {
      throw new Error(
        "Este post é Reel. Mude o formato para Carrossel no topo do editor e salve antes de gerar os slides.",
      );
    }

    const prompt = interpolar(gerarSlidesPrompt, {
      roteiro: post.roteiro,
      nicho: [post.nicho.nome, post.nicho.subNicho].filter(Boolean).join(" / "),
      persona: post.nicho.persona ?? "(persona não definida para este nicho)",
    });

    const plano = await callClaudeStructured(prompt, gerarSlidesSchema, {
      tarefa: "roteiro",
      maxTokens: 4096,
    });

    const formato = formatoValido(post.formato);
    const total = plano.slides.length;

    // Em paralelo porque são chamadas independentes: em série, 6 imagens
    // deixariam a action pendurada por mais de um minuto.
    const bases = await Promise.all(
      plano.slides.map((s) =>
        gerarImagens(`${s.promptVisual}. ${plano.direcaoVisual}. ${RESTRICOES_VISUAIS}`, {
          quantidade: 1,
          formato: "feed",
        }),
      ),
    );

    const lista: MidiaItem[] = [];
    for (const [i, slide] of plano.slides.entries()) {
      const base = bases[i]?.[0];
      if (!base) throw new Error(`o fal.ai não devolveu imagem para o slide ${slide.ordem}.`);

      // A capa respeita o coverText da copy quando ele existe: dois textos
      // diferentes na mesma tela (um no slide, outro na legenda) se contradizem.
      const texto =
        slide.papel === "capa" ? (post.coverText?.trim() || slide.texto) : slide.texto;

      const render = await renderizarSlide({
        imagemUrl: base.url,
        texto,
        formato,
        papel: slide.papel,
        ordem: slide.ordem,
        total,
      });

      lista.push({
        tipo: "imagem",
        url: render.url,
        papel: slide.papel === "capa" ? "capa" : "slide",
        ordem: slide.ordem,
        texto,
        origemUrl: base.url,
        promptUsado: base.promptUsado,
        criadoEm: new Date().toISOString(),
      });
    }

    // Substitui a mídia anterior: misturar slides novos com imagens soltas da
    // tentativa passada publicaria o carrossel fora de ordem.
    const video = lerMidia(post.midiaPaths).filter((m) => m.tipo === "video");

    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia([...lista, ...video]) },
    });

    revalidatePath("/producao");
    return { slides: total, custoImagens: total };
  });
}

const gerarMidiaSchema = z.object({
  postId: idSchema,
  tipo: z.enum(TIPOS_MIDIA),
  quantidade: z.coerce.number().int().min(1).max(10).optional(),
  promptExtra: z.string().max(1000).optional(),
});

export async function gerarMidia(
  entrada: unknown,
): Promise<ActionResult<{ adicionados: number; capa: string | null; capaErro?: string }>> {
  return acao(gerarMidiaSchema, entrada, async (d) => {
    if (!falDisponivel()) {
      throw new Error("FAL_KEY não configurada (Fase 3). Anexe a mídia manualmente por URL.");
    }

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      select: {
        id: true,
        titulo: true,
        roteiro: true,
        midiaPaths: true,
        formato: true,
        coverText: true,
      },
    });

    const atual = lerMidia(post.midiaPaths);
    let novos: MidiaItem[];

    if (d.tipo === "imagem") {
      const prompt =
        d.promptExtra?.trim() ||
        promptVisualDeRoteiro(post.titulo, post.roteiro ?? post.titulo);
      novos = await gerarImagens(prompt, {
        quantidade: d.quantidade ?? (post.formato === "carrossel" ? 5 : 3),
        // Já na resolução final do destino: 1080×1920 no Reel, 1080×1350 no
        // feed. Pedir quadrado obrigava a capa a cortar as laterais.
        formato: post.formato === "reel" ? "reel" : "feed",
      });
    } else {
      // Kling é image-to-video: precisa de um frame de partida.
      //
      // E o frame é a imagem LIMPA, nunca a capa. Vídeo generativo deforma
      // letras: animar o texto queimado devolveria um Reel com a frase
      // derretendo nos primeiros segundos. No Instagram a capa não precisa
      // ser o primeiro quadro — vai como `cover_url` do Reel (ver src/lib/meta.ts).
      const primeira = atual.find((m) => m.tipo === "imagem");
      const base = primeira
        ? { url: primeira.papel === "capa" ? (primeira.origemUrl ?? primeira.url) : primeira.url }
        : undefined;
      if (!base) {
        throw new Error(
          "Gere ao menos uma imagem primeiro — o Kling é image-to-video e precisa de um frame inicial.",
        );
      }
      const movimento =
        d.promptExtra?.trim() ||
        "Slow cinematic camera push-in, subtle parallax, natural motion, high quality";
      novos = [await gerarVideo(base.url, movimento)];
    }

    let lista: MidiaItem[] = [...atual, ...novos];
    let capa: string | null = null;
    let capaErro: string | undefined;

    // A capa sai junto com a imagem. Este é o ponto do ciclo em que o sistema
    // deixa de entregar ingredientes e passa a entregar o post: sem isto, o
    // coverText continua sendo uma string no banco e o arquivo pronto tem que
    // ser montado à mão em editor externo.
    const texto = post.coverText?.trim();
    const origem = d.tipo === "imagem" ? novos[0]?.url : undefined;

    if (texto && origem && !atual.some((m) => m.papel === "capa")) {
      try {
        const render = await renderizarCapa({
          imagemUrl: origem,
          texto,
          formato: formatoValido(post.formato),
        });
        lista = aplicarCapa(lista, origem, render.url);
        capa = render.url;
      } catch (e) {
        // As imagens já foram pagas: falha na composição não pode descartá-las.
        // O erro sobe como aviso e o botão "Capa" permite tentar de novo.
        capaErro = (e as Error).message;
      }
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia(lista) },
    });

    revalidatePath("/producao");
    return { adicionados: novos.length, capa, ...(capaErro ? { capaErro } : {}) };
  });
}

const anexarSchema = z.object({
  postId: idSchema,
  tipo: z.enum(TIPOS_MIDIA),
  url: z.string().url("URL inválida"),
});

/**
 * Anexo manual por URL — o caminho da Fase 1 e o plano B quando o fal.ai falha.
 * A URL precisa ser pública: o Graph API baixa a mídia do lado do Meta, e URL
 * assinada que expira é a causa nº 1 de container travado em IN_PROGRESS.
 */
export async function anexarMidiaUrl(
  entrada: unknown,
): Promise<ActionResult<{ total: number }>> {
  return acao(anexarSchema, entrada, async (d) => {
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      select: { id: true, midiaPaths: true },
    });

    const lista = [
      ...lerMidia(post.midiaPaths),
      { tipo: d.tipo, url: d.url, criadoEm: new Date().toISOString() },
    ];

    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia(lista) },
    });

    revalidatePath("/producao");
    return { total: lista.length };
  });
}

export async function removerMidia(
  entrada: unknown,
): Promise<ActionResult<{ total: number }>> {
  return acao(z.object({ postId: idSchema, url: z.string().min(1) }), entrada, async (d) => {
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      select: { id: true, midiaPaths: true },
    });

    const lista = lerMidia(post.midiaPaths).filter((m) => m.url !== d.url);
    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia(lista) },
    });

    revalidatePath("/producao");
    return { total: lista.length };
  });
}
