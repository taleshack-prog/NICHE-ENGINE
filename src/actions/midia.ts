"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { TIPOS_MIDIA } from "@/lib/domain";
import { falDisponivel, gerarImagens, gerarVideo, promptVisualDeRoteiro } from "@/lib/fal";
import { gravarMidia, lerMidia, type MidiaItem } from "@/lib/json-fields";
import { acao, idSchema, type ActionResult } from "./_shared";

/**
 * Geração de mídia (Fase 3).
 *
 * Imagem é síncrona. Vídeo passa por fila do fal.ai e pode levar minutos: a
 * action espera com teto de tentativas (ver src/lib/fal.ts). Para volume, o
 * caminho certo é o Workflow A do n8n, não o clique no dashboard.
 */

const gerarMidiaSchema = z.object({
  postId: idSchema,
  tipo: z.enum(TIPOS_MIDIA),
  quantidade: z.coerce.number().int().min(1).max(10).optional(),
  promptExtra: z.string().max(1000).optional(),
});

export async function gerarMidia(
  entrada: unknown,
): Promise<ActionResult<{ adicionados: number }>> {
  return acao(gerarMidiaSchema, entrada, async (d) => {
    if (!falDisponivel()) {
      throw new Error("FAL_KEY não configurada (Fase 3). Anexe a mídia manualmente por URL.");
    }

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: d.postId },
      select: { id: true, titulo: true, roteiro: true, midiaPaths: true, formato: true },
    });

    const atual = lerMidia(post.midiaPaths);
    let novos: MidiaItem[];

    if (d.tipo === "imagem") {
      const prompt =
        d.promptExtra?.trim() ||
        promptVisualDeRoteiro(post.titulo, post.roteiro ?? post.titulo);
      novos = await gerarImagens(prompt, {
        quantidade: d.quantidade ?? (post.formato === "carrossel" ? 5 : 3),
        aspecto: post.formato === "carrossel" ? "square_hd" : "portrait_16_9",
      });
    } else {
      // Kling é image-to-video: precisa de um frame de partida.
      const base = atual.find((m) => m.tipo === "imagem");
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

    await prisma.post.update({
      where: { id: post.id },
      data: { midiaPaths: gravarMidia([...atual, ...novos]) },
    });

    revalidatePath("/producao");
    return { adicionados: novos.length };
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
