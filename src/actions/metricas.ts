"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callClaudeStructured, iaDisponivel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { coletarInsights, metaDisponivel } from "@/lib/meta";
import {
  interpolar,
  relatorioSemanalPrompt,
  relatorioSemanalSchema,
  type RelatorioSemanal,
} from "@/lib/prompts";
import { normalizarRetencao, scorePost } from "@/lib/scoring";
import { rankingPorMetrica } from "@/lib/ranking";
import { diaRef, inicioJanela7Dias } from "@/lib/utils";
import { acao, idSchema, type ActionResult } from "./_shared";

// ─────────────────────────────────────────────
// Registro de métricas
// ─────────────────────────────────────────────

const numeroOpcional = z.coerce.number().min(0).optional();

const registrarSchema = z.object({
  postId: idSchema,
  dataRef: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD")
    .optional(),
  alcance: numeroOpcional,
  impressoes: numeroOpcional,
  salvamentos: numeroOpcional,
  compartilhamentos: numeroOpcional,
  comentarios: numeroOpcional,
  followsGanhos: numeroOpcional,
  retention3s: z.coerce.number().min(0).max(100).optional(),
  watchRate: z.coerce.number().min(0).max(100).optional(),
});

/**
 * Registro manual de métricas (Fase 4).
 *
 * Faz upsert por (postId, dataRef). Sem isso, registrar duas vezes no mesmo dia
 * criaria duas linhas e qualquer soma de alcance/salvamentos ficaria inflada —
 * exatamente o risco que o Workflow C corre rodando diariamente.
 */
export async function registrarMetricas(
  entrada: unknown,
): Promise<ActionResult<{ id: string; criada: boolean }>> {
  return acao(registrarSchema, entrada, async (d) => {
    const ref = d.dataRef ?? diaRef();

    const dados = {
      alcance: intOuNull(d.alcance),
      impressoes: intOuNull(d.impressoes),
      salvamentos: intOuNull(d.salvamentos),
      compartilhamentos: intOuNull(d.compartilhamentos),
      comentarios: intOuNull(d.comentarios),
      followsGanhos: intOuNull(d.followsGanhos),
      retention3s: normalizarRetencao(d.retention3s ?? null),
      watchRate: normalizarRetencao(d.watchRate ?? null),
    };

    const existente = await prisma.metrica.findUnique({
      where: { postId_dataRef: { postId: d.postId, dataRef: ref } },
      select: { id: true },
    });

    const m = await prisma.metrica.upsert({
      where: { postId_dataRef: { postId: d.postId, dataRef: ref } },
      create: { postId: d.postId, dataRef: ref, dataColeta: new Date(), ...dados },
      update: { dataColeta: new Date(), ...dados },
      select: { id: true },
    });

    revalidatePath("/analytics");
    revalidatePath("/");
    return { id: m.id, criada: !existente };
  });
}

function intOuNull(v: number | undefined): number | null {
  return v === undefined ? null : Math.round(v);
}

/**
 * Coleta automática via Graph API (Fase 5) — mesmo efeito do Workflow C,
 * disponível no dashboard para colher fora do horário do cron.
 */
export async function coletarMetricasAutomatico(): Promise<
  ActionResult<{ coletados: number; falhas: string[] }>
> {
  return acao(z.object({}), {}, async () => {
    if (!(await metaDisponivel())) {
      throw new Error("Graph API não configurada (Fase 5). Registre as métricas manualmente.");
    }

    const seteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const posts = await prisma.post.findMany({
      where: { status: "publicado", igPostId: { not: null }, publicadoEm: { gte: seteDias } },
      select: { id: true, titulo: true, igPostId: true },
    });

    const ref = diaRef();
    const falhas: string[] = [];
    let coletados = 0;

    for (const p of posts) {
      if (!p.igPostId) continue;
      try {
        const i = await coletarInsights(p.igPostId);
        await prisma.metrica.upsert({
          where: { postId_dataRef: { postId: p.id, dataRef: ref } },
          create: {
            postId: p.id,
            dataRef: ref,
            alcance: i.alcance,
            salvamentos: i.salvamentos,
            compartilhamentos: i.compartilhamentos,
            comentarios: i.comentarios,
          },
          update: {
            dataColeta: new Date(),
            alcance: i.alcance,
            salvamentos: i.salvamentos,
            compartilhamentos: i.compartilhamentos,
            comentarios: i.comentarios,
          },
        });
        coletados++;
      } catch (e) {
        falhas.push(`${p.titulo}: ${(e as Error).message}`);
      }
    }

    revalidatePath("/analytics");
    return { coletados, falhas };
  });
}

// ─────────────────────────────────────────────
// Relatório semanal
// ─────────────────────────────────────────────

export type ResultadoRelatorio =
  | { gerado: true; relatorio: RelatorioSemanal; topicosCriados: number; nicho: string }
  | { gerado: false; motivo: string; postsNaJanela: number; nicho: string | null };

/**
 * Relatório semanal de IA (Fase 4) + realimentação da tabela `topicos`.
 *
 * ESCOPO: um nicho por relatório, sempre.
 *
 * A versão anterior lia posts de TODOS os nichos e depois gravava os tópicos
 * resultantes no primeiro nicho ativo. Duas coisas erradas de uma vez:
 *
 * 1. Comparar padrão entre nichos não se sustenta. Audiência, saturação e CPM
 *    são outros — um "contraste" que vence em finanças e perde em produtividade
 *    não diz nada sobre o padrão, diz sobre os nichos. O prompt compararia P1
 *    com P2 como se fossem do mesmo jogo.
 * 2. A recomendação nascia de um conjunto misturado e ia parar na fila de pauta
 *    de UM nicho — que o Workflow A consome para produzir conteúdo daquele
 *    nicho. Conclusão de produtividade viraria pauta de cripto.
 *
 * A guarda de 3 posts é regra do próprio prompt ("declare a incerteza"): com
 * menos de 3 posts a IA inevitavelmente inventa padrão. Melhor não chamar.
 */
export async function relatorioSemanal(entrada: unknown = {}): Promise<
  ActionResult<ResultadoRelatorio>
> {
  return acao(z.object({ nichoId: idSchema.optional() }), entrada, async (d) => {
    const inicio = inicioJanela7Dias();
    const nicho = await nichoDoRelatorio(d.nichoId, inicio);

    if (!nicho) {
      return {
        gerado: false,
        motivo:
          "Nenhum nicho ativo. Marque um nicho como ativo em /nichos — o relatório analisa um nicho por vez, porque comparar padrão entre nichos diferentes não se sustenta.",
        postsNaJanela: 0,
        nicho: null,
      } satisfies ResultadoRelatorio;
    }

    const posts = await prisma.post.findMany({
      where: { nichoId: nicho.id, publicadoEm: { gte: inicio } },
      include: {
        template: { select: { padrao: true } },
        metricas: { orderBy: { dataColeta: "desc" }, take: 1 },
      },
      orderBy: { publicadoEm: "asc" },
    });

    const comMetrica = posts.filter((p) => p.metricas.length > 0);

    if (comMetrica.length < 3) {
      return {
        gerado: false,
        motivo: `São necessários pelo menos 3 posts com métricas nos últimos 7 dias em "${nicho.nome}". Com menos que isso, qualquer padrão apontado seria ruído.`,
        postsNaJanela: comMetrica.length,
        nicho: nicho.nome,
      } satisfies ResultadoRelatorio;
    }

    if (!iaDisponivel()) throw new Error("ANTHROPIC_API_KEY não configurada (Fase 2).");

    const payload = comMetrica.map((p, i) => {
      const m = p.metricas[0];
      return {
        post: `P${i + 1}`,
        titulo: p.titulo,
        padrao: p.template?.padrao ?? "(sem template)",
        formato: p.formato,
        alcance: m?.alcance ?? null,
        salvamentos: m?.salvamentos ?? null,
        compartilhamentos: m?.compartilhamentos ?? null,
        comentarios: m?.comentarios ?? null,
        retention3s: m?.retention3s ?? null,
        follows: m?.followsGanhos ?? null,
      };
    });

    const prompt = interpolar(relatorioSemanalPrompt, {
      metricas: JSON.stringify(payload, null, 1),
      ranking: rankingPorMetrica(payload),
    });

    const relatorio = await callClaudeStructured(prompt, relatorioSemanalSchema, {
      tarefa: "relatorio",
      maxTokens: 3000,
    });

    // Fecha o loop: a recomendação entra em `topicos` DO MESMO NICHO analisado,
    // e o Workflow A a consome na próxima execução das 06h.
    const temas = [
      relatorio.recomendacaoProximaSemana,
      ...relatorio.hipoteses.slice(0, 2),
    ].map((t) => t.slice(0, 500));

    await prisma.topico.createMany({
      data: temas.map((tema, idx) => ({
        tema,
        nichoId: nicho.id,
        status: "pendente",
        prioridade: idx === 0 ? 10 : 5,
      })),
    });

    revalidatePath("/analytics");
    revalidatePath("/");
    return {
      gerado: true,
      relatorio,
      topicosCriados: temas.length,
      nicho: nicho.nome,
    } satisfies ResultadoRelatorio;
  });
}

/**
 * Qual nicho o relatório analisa.
 *
 * Sem escolha explícita, prefere o nicho ATIVO com mais posts medidos na
 * janela: é onde existe massa para comparar. Empate ou nenhum post medido cai
 * no ativo de maior score, que é o que a operação elegeu como aposta.
 */
async function nichoDoRelatorio(
  nichoId: string | undefined,
  inicio: Date,
): Promise<{ id: string; nome: string } | null> {
  if (nichoId) {
    return prisma.nicho.findUnique({ where: { id: nichoId }, select: { id: true, nome: true } });
  }

  const ativos = await prisma.nicho.findMany({
    where: { status: "ativo" },
    select: {
      id: true,
      nome: true,
      score: true,
      _count: { select: { posts: { where: { publicadoEm: { gte: inicio } } } } },
    },
    orderBy: { score: "desc" },
  });

  if (ativos.length === 0) return null;

  const escolhido = [...ativos].sort(
    (a, b) => b._count.posts - a._count.posts || (b.score ?? 0) - (a.score ?? 0),
  )[0]!;

  return { id: escolhido.id, nome: escolhido.nome };
}

/** Ranking do top 10% da semana — base do botão "promover a template". */
export async function rankingSemanal(): Promise<
  ActionResult<Array<{ id: string; titulo: string; score: number; alcance: number | null }>>
> {
  return acao(z.object({}), {}, async () => {
    const inicio = inicioJanela7Dias();
    const posts = await prisma.post.findMany({
      where: { publicadoEm: { gte: inicio } },
      include: { metricas: { orderBy: { dataColeta: "desc" }, take: 1 } },
    });

    return posts
      .map((p) => {
        const m = p.metricas[0];
        return {
          id: p.id,
          titulo: p.titulo,
          alcance: m?.alcance ?? null,
          score: scorePost({
            alcance: m?.alcance ?? null,
            salvamentos: m?.salvamentos ?? null,
            compartilhamentos: m?.compartilhamentos ?? null,
            retention3s: m?.retention3s ?? null,
          }),
        };
      })
      .sort((a, b) => b.score - a.score);
  });
}
