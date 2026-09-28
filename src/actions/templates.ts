"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callClaudeStructured, iaDisponivel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { CATEGORIAS_GANCHO } from "@/lib/domain";
import { gravarEstrutura, lerEstrutura } from "@/lib/json-fields";
import {
  canonizarPadrao,
  listaParaPrompt,
  PADRAO_NAO_CLASSIFICADO,
  type PadraoCatalogado,
} from "@/lib/padroes";
import { decomposeViralPrompt, decomposeViralSchema, interpolar } from "@/lib/prompts";
import { truncar } from "@/lib/utils";
import { acao, idSchema, type ActionResult } from "./_shared";

/**
 * Padrões já em uso, dos mais frequentes para os menos.
 *
 * A ordem importa dentro do prompt: o modelo lê a lista de cima para baixo, e
 * um padrão com 5 posts é candidato melhor a reuso do que um com 1 — é ele que
 * já tem massa para o relatório semanal comparar.
 */
async function padroesCatalogados(): Promise<PadraoCatalogado[]> {
  // Um template de referência por padrão, do qual sai a DEFINIÇÃO do mecanismo.
  // Preferimos o de maior performance: se o rótulo vai ser reusado, que seja
  // ancorado no exemplar que melhor representa o padrão.
  const templates = await prisma.templateViral.findMany({
    select: { padrao: true, estrutura: true, performance: true },
    orderBy: [{ performance: "desc" }, { criadoEm: "asc" }],
  });

  const porPadrao = new Map<string, PadraoCatalogado>();
  for (const t of templates) {
    const atual = porPadrao.get(t.padrao);
    if (atual) {
      atual.usos += 1;
      continue;
    }
    const retencao = lerEstrutura(t.estrutura).retention?.trim();
    porPadrao.set(t.padrao, {
      padrao: t.padrao,
      // Truncado: a definição serve para o modelo julgar encaixe, não para
      // reproduzir a análise inteira do template de origem.
      mecanismo: retencao ? truncar(retencao, 140) : null,
      usos: 1,
    });
  }

  return [...porPadrao.values()].sort((a, b) => b.usos - a.usos).slice(0, 25);
}

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
    // Mesma canonização da decomposição por IA: digitar "Contraste" aqui não
    // pode criar um segundo grupo ao lado de "contraste".
    const padrao = canonizarPadrao(
      d.padrao,
      (await padroesCatalogados()).map((c) => c.padrao),
    );

    const t = await prisma.templateViral.create({
      data: {
        nichoId: d.nichoId,
        fonte: d.fonte,
        gancho: d.gancho,
        padrao,
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

    // Vocabulário atual do swipe file, lido UMA vez: alimenta o prompt (para o
    // modelo reusar) e a canonização (para consertar o que ele devolver).
    const catalogados = await padroesCatalogados();

    const prompt = interpolar(decomposeViralPrompt, {
      transcricao: d.transcricao,
      padroesExistentes: listaParaPrompt(catalogados),
    });
    const r = await callClaudeStructured(prompt, decomposeViralSchema, {
      tarefa: "decomposicao",
      maxTokens: 1500,
    });

    // Segunda camada: mesmo pedindo reuso, o modelo pode devolver "Contraste"
    // ou "contraste " e fragmentar o agrupamento. A canonização resolve contra
    // a grafia já catalogada.
    const padrao = canonizarPadrao(
      r.padrao,
      catalogados.map((c) => c.padrao),
    );

    const template = await prisma.templateViral.create({
      data: {
        nichoId: d.nichoId,
        fonte: d.fonte ?? "decomposição manual",
        transcricao: d.transcricao,
        gancho: r.gancho.texto,
        padrao,
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
        padrao: post.template?.padrao ?? PADRAO_NAO_CLASSIFICADO,
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
