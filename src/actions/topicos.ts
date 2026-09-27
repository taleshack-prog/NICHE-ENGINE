"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { TOPICO_STATUS } from "@/lib/domain";
import { acao, idSchema, type ActionResult } from "./_shared";

/**
 * Tabela `topicos` — a fila de pauta que o Workflow A consome às 06h e que o
 * relatório semanal realimenta. É onde o loop do sistema fecha, então tem CRUD
 * próprio no dashboard em vez de ser só uma tabela do n8n.
 */

const createTopicoSchema = z.object({
  tema: z.string().min(5, "Descreva o tema").max(500),
  nichoId: z.string().optional(),
  prioridade: z.coerce.number().int().min(0).max(100).optional(),
});

export async function createTopico(entrada: unknown): Promise<ActionResult<{ id: number }>> {
  return acao(createTopicoSchema, entrada, async (d) => {
    const t = await prisma.topico.create({
      data: {
        tema: d.tema,
        nichoId: d.nichoId || null,
        prioridade: d.prioridade ?? 0,
        status: "pendente",
      },
      select: { id: true },
    });
    revalidatePath("/");
    return t;
  });
}

export async function updateTopicoStatus(
  entrada: unknown,
): Promise<ActionResult<{ id: number }>> {
  return acao(
    z.object({ id: z.coerce.number().int(), status: z.enum(TOPICO_STATUS) }),
    entrada,
    async (d) => {
      const t = await prisma.topico.update({
        where: { id: d.id },
        data: { status: d.status },
        select: { id: true },
      });
      revalidatePath("/");
      return t;
    },
  );
}

export async function deleteTopico(entrada: unknown): Promise<ActionResult<undefined>> {
  return acao(z.object({ id: z.coerce.number().int() }), entrada, async (d) => {
    await prisma.topico.delete({ where: { id: d.id } });
    revalidatePath("/");
    return undefined;
  });
}

/** Cria o post a partir de um tópico da fila e marca o tópico como em produção. */
export async function promoverTopicoAPost(
  entrada: unknown,
): Promise<ActionResult<{ postId: string }>> {
  return acao(
    z.object({ id: z.coerce.number().int(), nichoId: idSchema, formato: z.string() }),
    entrada,
    async (d) => {
      const topico = await prisma.topico.findUniqueOrThrow({ where: { id: d.id } });

      const post = await prisma.post.create({
        data: {
          titulo: topico.tema.slice(0, 200),
          formato: d.formato,
          nichoId: topico.nichoId ?? d.nichoId,
          status: "rascunho",
          hashtags: "[]",
        },
        select: { id: true },
      });

      await prisma.topico.update({ where: { id: d.id }, data: { status: "em_producao" } });

      revalidatePath("/producao");
      revalidatePath("/");
      return { postId: post.id };
    },
  );
}
