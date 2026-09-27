"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callClaudeStructured, iaDisponivel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { FORMATOS, POST_STATUS } from "@/lib/domain";
import { gravarHashtags, lerHashtags, lerMidia } from "@/lib/json-fields";
import { metaDisponivel, publicarNoInstagram } from "@/lib/meta";
import {
  gerarCopyPrompt,
  gerarCopySchema,
  gerarRoteiroPrompt,
  gerarRoteiroSchema,
  interpolar,
  type VariacaoRoteiro,
} from "@/lib/prompts";
import { acao, idSchema, type ActionResult } from "./_shared";

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

const createPostSchema = z.object({
  nichoId: idSchema,
  templateId: z.string().optional(),
  titulo: z.string().min(2, "Título muito curto").max(200),
  formato: z.enum(FORMATOS),
});

export async function createPost(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(createPostSchema, entrada, async (d) => {
    const p = await prisma.post.create({
      data: {
        nichoId: d.nichoId,
        templateId: d.templateId || null,
        titulo: d.titulo,
        formato: d.formato,
        status: "rascunho",
        hashtags: gravarHashtags([]),
      },
      select: { id: true },
    });
    revalidatePath("/producao");
    revalidatePath("/");
    return p;
  });
}

const updatePostSchema = z.object({
  id: idSchema,
  titulo: z.string().min(2).max(200).optional(),
  formato: z.enum(FORMATOS).optional(),
  roteiro: z.string().max(20_000).nullish(),
  legenda: z.string().max(8_000).nullish(),
  coverText: z.string().max(120).nullish(),
  hashtags: z.union([z.array(z.string()), z.string()]).optional(),
  templateId: z.string().nullish(),
});

export async function updatePost(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(updatePostSchema, entrada, async (d) => {
    const hashtags =
      d.hashtags === undefined
        ? undefined
        : gravarHashtags(Array.isArray(d.hashtags) ? d.hashtags : lerHashtags(d.hashtags));

    const p = await prisma.post.update({
      where: { id: d.id },
      data: {
        ...(d.titulo !== undefined && { titulo: d.titulo }),
        ...(d.formato !== undefined && { formato: d.formato }),
        ...(d.roteiro !== undefined && { roteiro: d.roteiro }),
        ...(d.legenda !== undefined && { legenda: d.legenda }),
        ...(d.coverText !== undefined && { coverText: d.coverText }),
        ...(d.templateId !== undefined && { templateId: d.templateId || null }),
        ...(hashtags !== undefined && { hashtags }),
      },
      select: { id: true },
    });
    revalidatePath("/producao");
    return p;
  });
}

export async function deletePost(entrada: unknown): Promise<ActionResult<undefined>> {
  return acao(z.object({ id: idSchema }), entrada, async (d) => {
    await prisma.post.delete({ where: { id: d.id } });
    revalidatePath("/producao");
    revalidatePath("/calendario");
    revalidatePath("/");
    return undefined;
  });
}

// ─────────────────────────────────────────────
// Kanban / agenda
// ─────────────────────────────────────────────

const moverSchema = z.object({ id: idSchema, status: z.enum(POST_STATUS) });

/**
 * Drag-and-drop do kanban.
 *
 * Duas guardas que o kanban precisa e a spec não previa:
 *  - mover para "agendado" sem data marcada não faz sentido: o Workflow B
 *    seleciona `WHERE status='agendado' AND agendado_para <= NOW()`, e um post
 *    sem data nunca sairia da fila (agendadoPara NULL nunca satisfaz <=);
 *  - marcar "publicado" pela mão é permitido (publicação manual no Business
 *    Suite é o caminho da Fase 1), mas registra publicadoEm.
 */
export async function moverPost(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(moverSchema, entrada, async (d) => {
    const atual = await prisma.post.findUniqueOrThrow({
      where: { id: d.id },
      select: { agendadoPara: true, publicadoEm: true },
    });

    if (d.status === "agendado" && !atual.agendadoPara) {
      throw new Error(
        "Defina a data de agendamento antes de mover para Agendado — a fila de publicação ignora posts sem data.",
      );
    }

    const p = await prisma.post.update({
      where: { id: d.id },
      data: {
        status: d.status,
        ...(d.status === "publicado" && !atual.publicadoEm && { publicadoEm: new Date() }),
      },
      select: { id: true },
    });

    revalidatePath("/producao");
    revalidatePath("/calendario");
    revalidatePath("/");
    return p;
  });
}

const agendarSchema = z.object({
  id: idSchema,
  // datetime-local do browser vem sem timezone; interpretamos no fuso do servidor.
  data: z.coerce.date(),
});

export async function agendarPost(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(agendarSchema, entrada, async (d) => {
    const p = await prisma.post.update({
      where: { id: d.id },
      data: { agendadoPara: d.data, status: "agendado" },
      select: { id: true },
    });
    revalidatePath("/producao");
    revalidatePath("/calendario");
    revalidatePath("/");
    return p;
  });
}

export async function desagendarPost(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(z.object({ id: idSchema }), entrada, async (d) => {
    const p = await prisma.post.update({
      where: { id: d.id },
      data: { agendadoPara: null, status: "pronto" },
      select: { id: true },
    });
    revalidatePath("/calendario");
    revalidatePath("/producao");
    return p;
  });
}

// ─────────────────────────────────────────────
// Publicação (Fase 5 — stub controlado na Fase 1)
// ─────────────────────────────────────────────

export async function publicarPost(entrada: unknown): Promise<ActionResult<{ igPostId: string }>> {
  return acao(z.object({ id: idSchema }), entrada, async (d) => {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: d.id } });

    if (!(await metaDisponivel())) {
      throw new Error(
        "Publicação automática não configurada (Fase 5). Publique pelo Meta Business Suite e mova o card para Publicado.",
      );
    }
    if (!post.legenda?.trim()) throw new Error("Post sem legenda.");

    const midia = lerMidia(post.midiaPaths);
    if (midia.length === 0) throw new Error("Post sem mídia anexada.");

    try {
      const { igPostId } = await publicarNoInstagram({
        formato: post.formato,
        legenda: post.legenda,
        midia,
      });

      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: "publicado",
          publicadoEm: new Date(),
          igPostId,
          erroPublicacao: null,
        },
      });

      revalidatePath("/producao");
      revalidatePath("/");
      return { igPostId };
    } catch (e) {
      // Persistir o erro é o que permite diagnosticar uma falha que aconteceu
      // às 3h da manhã pelo Workflow B.
      await prisma.post.update({
        where: { id: post.id },
        data: { erroPublicacao: (e as Error).message.slice(0, 1000) },
      });
      throw e;
    }
  });
}

// ─────────────────────────────────────────────
// IA: roteiro e copy (Fase 2)
// ─────────────────────────────────────────────

const gerarRoteiroEntrada = z.object({
  postId: idSchema,
  tema: z.string().min(5, "Descreva o tema").max(500),
});

export async function gerarRoteiro(
  entrada: unknown,
): Promise<ActionResult<{ variacoes: VariacaoRoteiro[] }>> {
  return acao(gerarRoteiroEntrada, entrada, async (d) => {
    if (!iaDisponivel()) throw new Error("ANTHROPIC_API_KEY não configurada (Fase 2).");

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      select: { nichoId: true },
    });

    const templates = await prisma.templateViral.findMany({
      where: { nichoId: post.nichoId },
      orderBy: [{ performance: "desc" }, { criadoEm: "desc" }],
      take: 6,
      select: { padrao: true, gancho: true },
    });

    if (templates.length < 3) {
      throw new Error(
        `O prompt exige 3 templates diferentes e o swipe file deste nicho tem ${templates.length}. Cadastre mais templates em /swipe antes de gerar roteiro.`,
      );
    }

    const swipeFile = templates
      .map((t, i) => `  ${i + 1}. padrao "${t.padrao}" — gancho tipo "${t.gancho}"`)
      .join("\n");

    // Gancho do último post publicado do nicho: base da regra "nunca repetir
    // gancho idêntico em posts consecutivos".
    const anterior = await prisma.post.findFirst({
      where: { nichoId: post.nichoId, roteiro: { not: null } },
      orderBy: [{ publicadoEm: "desc" }, { criadoEm: "desc" }],
      select: { roteiro: true },
    });
    const ganchoAnterior =
      anterior?.roteiro?.split("\n").find((l) => l.trim())?.trim() ?? "(nenhum)";

    const prompt = interpolar(gerarRoteiroPrompt, {
      tema: d.tema,
      swipeFile,
      ganchoAnterior,
    });

    const r = await callClaudeStructured(prompt, gerarRoteiroSchema, {
      tarefa: "roteiro",
      maxTokens: 4096,
    });

    return { variacoes: r.variacoes };
  });
}

const aplicarRoteiroSchema = z.object({
  postId: idSchema,
  gancho: z.string().min(3),
  corpo: z.string().min(10),
  loop: z.string().min(3),
  cta: z.string().min(3),
});

/** Grava a variação escolhida como roteiro do post. */
export async function aplicarRoteiro(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(aplicarRoteiroSchema, entrada, async (d) => {
    const roteiro = [d.gancho, "", d.corpo, "", d.loop, "", d.cta].join("\n");
    const p = await prisma.post.update({
      where: { id: d.postId },
      data: { roteiro, status: "produzindo" },
      select: { id: true },
    });
    revalidatePath("/producao");
    return p;
  });
}

/**
 * Blocos de hashtags dos últimos posts do nicho, para o prompt não repetir.
 *
 * Bloco idêntico em posts seguidos é exatamente o padrão que o Instagram trata
 * como spam — e é o resultado natural de pedir hashtags "do nicho" a um modelo
 * sem contexto do que já foi usado: ele converge para o mesmo conjunto óbvio
 * toda vez.
 */
async function hashtagsRecentesDoNicho(nichoId: string, excetoPostId: string): Promise<string> {
  const posts = await prisma.post.findMany({
    where: { nichoId, id: { not: excetoPostId }, hashtags: { not: null } },
    orderBy: { criadoEm: "desc" },
    take: 5,
    select: { titulo: true, hashtags: true },
  });

  const blocos = posts
    .map((p) => ({ titulo: p.titulo, tags: lerHashtags(p.hashtags) }))
    .filter((b) => b.tags.length > 0);

  if (blocos.length === 0) return "(nenhum post com hashtags ainda neste nicho)";

  return blocos
    .map((b) => `- "${b.titulo.slice(0, 60)}": ${b.tags.join(" ")}`)
    .join("\n");
}

export async function gerarCopy(
  entrada: unknown,
): Promise<ActionResult<{ legenda: string; hashtags: string[]; coverText: string }>> {
  return acao(z.object({ postId: idSchema }), entrada, async (d) => {
    if (!iaDisponivel()) throw new Error("ANTHROPIC_API_KEY não configurada (Fase 2).");

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      include: { nicho: { select: { nome: true, subNicho: true, persona: true } } },
    });

    if (!post.roteiro?.trim()) {
      throw new Error("Gere ou escreva o roteiro antes da copy — o prompt de copy parte dele.");
    }

    const nicho = [post.nicho.nome, post.nicho.subNicho].filter(Boolean).join(" / ");
    const prompt = interpolar(gerarCopyPrompt, {
      roteiro: post.roteiro,
      nicho,
      persona: post.nicho.persona ?? "(persona não definida para este nicho)",
      hashtagsRecentes: await hashtagsRecentesDoNicho(post.nichoId, post.id),
    });

    const r = await callClaudeStructured(prompt, gerarCopySchema, {
      tarefa: "copy",
      maxTokens: 2000,
    });

    await prisma.post.update({
      where: { id: post.id },
      data: {
        legenda: r.legenda,
        hashtags: gravarHashtags(r.hashtags),
        coverText: r.coverText,
      },
    });

    revalidatePath("/producao");
    return r;
  });
}
