"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callClaudeStructured, iaDisponivel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { CATEGORIAS_GANCHO } from "@/lib/domain";
import { gravarEstrutura } from "@/lib/json-fields";
import { decomposeViralPrompt, decomposeViralSchema, interpolar } from "@/lib/prompts";
import { acao, idSchema, type ActionResult } from "./_shared";

/**
 * Cadastro manual de template (Fase 1 — swipe file sem IA).
 */
const createTemplateSchema = z.object({
  nichoId: idSchema,
  fonte: z.string().min(3, "Informe o link ou origem do Reel").max(500),
  gancho: z.string().min(3).max(500),
  padrao: z.string().min(2).max(80),
  transcricao: z.string().max(20_000).optional(),
  performance: z.coerce.number().int().min(0).optional(),
  estrutura: z
    .object({
      hook: z.string().optional(),
      retention: z.string().optional(),
      loop: z.string().optional(),
      cta: z.string().optional(),
    })
    .optional(),
});

export async function createTemplate(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(createTemplateSchema, entrada, async (d) => {
    const t = await prisma.templateViral.create({
      data: {
        nichoId: d.nichoId,
        fonte: d.fonte,
        gancho: d.gancho,
        padrao: d.padrao,
        transcricao: d.transcricao ?? null,
        performance: d.performance ?? null,
        estrutura: gravarEstrutura(d.estrutura ?? {}),
      },
      select: { id: true },
    });
    revalidatePath("/swipe");
    return t;
  });
}

/**
 * Decomposição viral com IA (Fase 2).
 *
 * Grava o template E o gancho no banco de ganchos, incrementando `usos`.
 * O banco de ganchos é o que impede repetir gancho em posts consecutivos, que
 * é uma regra do prompt de roteiro — sem alimentá-lo aqui, a regra é letra
 * morta.
 */
const decomposeSchema = z.object({
  nichoId: idSchema,
  transcricao: z.string().min(40, "Transcrição curta demais para decompor").max(20_000),
  fonte: z.string().max(500).optional(),
});

export async function decomposeViral(
  entrada: unknown,
): Promise<ActionResult<{ id: string; padrao: string }>> {
  return acao(decomposeSchema, entrada, async (d) => {
    if (!iaDisponivel()) {
      throw new Error(
        "ANTHROPIC_API_KEY não configurada. Cadastre o template manualmente ou preencha a chave no .env.",
      );
    }

    const prompt = interpolar(decomposeViralPrompt, { transcricao: d.transcricao });
    const r = await callClaudeStructured(prompt, decomposeViralSchema, {
      tarefa: "decomposicao",
      maxTokens: 1500,
    });

    const template = await prisma.templateViral.create({
      data: {
        nichoId: d.nichoId,
        fonte: d.fonte ?? "decomposição manual",
        transcricao: d.transcricao,
        gancho: r.gancho.texto,
        padrao: r.padrao,
        estrutura: gravarEstrutura({
          hook: r.gancho.texto,
          retention: r.mecanismoRetencao,
          loop: r.loop,
          cta: r.cta,
        }),
      },
      select: { id: true, padrao: true },
    });

    await registrarGancho(r.gancho.texto, r.gancho.tipo);

    revalidatePath("/swipe");
    return template;
  });
}

/**
 * Promove um post vencedor a template — o loop de melhoria contínua da spec.
 * Idempotente: promover duas vezes o mesmo post não cria duplicata.
 */
export async function promoverPostATemplate(
  entrada: unknown,
): Promise<ActionResult<{ id: string; jaExistia: boolean }>> {
  return acao(z.object({ postId: idSchema }), entrada, async (d) => {
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      include: { metricas: { orderBy: { dataColeta: "desc" }, take: 1 }, template: true },
    });

    const fonte = post.igPostId
      ? `post interno ${post.id} (IG ${post.igPostId})`
      : `post interno ${post.id}`;

    const existente = await prisma.templateViral.findFirst({
      where: { nichoId: post.nichoId, fonte },
      select: { id: true },
    });
    if (existente) return { id: existente.id, jaExistia: true };

    // O gancho do post é a primeira linha do roteiro; se não houver roteiro,
    // cai para o título. Nunca deixar o campo vazio: gancho é obrigatório.
    const gancho =
      post.roteiro?.split("\n").find((l) => l.trim().length > 0)?.trim() || post.titulo;

    const t = await prisma.templateViral.create({
      data: {
        nichoId: post.nichoId,
        fonte,
        gancho: gancho.slice(0, 500),
        padrao: post.template?.padrao ?? `vencedor: ${post.formato}`,
        transcricao: post.roteiro,
        performance: post.metricas[0]?.alcance ?? null,
        estrutura: post.template?.estrutura ?? gravarEstrutura({ hook: gancho }),
      },
      select: { id: true },
    });

    revalidatePath("/swipe");
    revalidatePath("/analytics");
    return { id: t.id, jaExistia: false };
  });
}

export async function deleteTemplate(entrada: unknown): Promise<ActionResult<undefined>> {
  return acao(z.object({ id: idSchema }), entrada, async (d) => {
    await prisma.templateViral.delete({ where: { id: d.id } });
    revalidatePath("/swipe");
    return undefined;
  });
}

/** Registra/incrementa um gancho no banco de ganchos. */
async function registrarGancho(texto: string, categoria: string): Promise<void> {
  const cat = (CATEGORIAS_GANCHO as readonly string[]).includes(categoria)
    ? categoria
    : "contraste";

  const existente = await prisma.gancho.findFirst({ where: { texto } });
  if (existente) {
    await prisma.gancho.update({
      where: { id: existente.id },
      data: { usos: { increment: 1 } },
    });
    return;
  }
  await prisma.gancho.create({ data: { texto, categoria: cat, usos: 1 } });
}
