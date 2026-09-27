"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { NICHO_STATUS } from "@/lib/domain";
import { calcularScoreNicho } from "@/lib/scoring";
import { acao, idSchema, type ActionResult } from "./_shared";

const score1a10 = z.coerce.number().int().min(1).max(10);

const nichoBase = {
  nome: z.string().min(2, "Nome muito curto").max(120),
  subNicho: z.string().max(120).optional(),
  cpmEstimado: z.coerce.number().min(0).max(1000).optional(),
  demandaPerene: score1a10.optional(),
  concorrencia: score1a10.optional(),
  persona: z.string().max(600).optional(),
  status: z.enum(NICHO_STATUS).optional(),
};

const createNichoSchema = z.object(nichoBase);
const updateNichoSchema = z.object({ id: idSchema, ...nichoBase }).partial({ nome: true });

export async function createNicho(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(createNichoSchema, entrada, async (d) => {
    const score = calcularScoreNicho({
      demandaPerene: d.demandaPerene ?? null,
      concorrencia: d.concorrencia ?? null,
      cpmEstimado: d.cpmEstimado ?? null,
    });

    const nicho = await prisma.nicho.create({
      data: {
        nome: d.nome,
        subNicho: d.subNicho ?? null,
        cpmEstimado: d.cpmEstimado ?? null,
        demandaPerene: d.demandaPerene ?? null,
        concorrencia: d.concorrencia ?? null,
        persona: d.persona ?? null,
        status: d.status ?? "candidato",
        score,
      },
      select: { id: true },
    });

    revalidatePath("/nichos");
    revalidatePath("/");
    return nicho;
  });
}

export async function updateNicho(entrada: unknown): Promise<ActionResult<{ id: string }>> {
  return acao(updateNichoSchema, entrada, async (d) => {
    const atual = await prisma.nicho.findUniqueOrThrow({ where: { id: d.id } });

    // Recalcula o score sempre que qualquer insumo dele muda — deixar o score
    // desatualizado é pior do que não tê-lo, porque a tabela ordena por ele.
    const demandaPerene = d.demandaPerene ?? atual.demandaPerene;
    const concorrencia = d.concorrencia ?? atual.concorrencia;
    const cpmEstimado = d.cpmEstimado ?? atual.cpmEstimado;

    const nicho = await prisma.nicho.update({
      where: { id: d.id },
      data: {
        ...(d.nome !== undefined && { nome: d.nome }),
        ...(d.subNicho !== undefined && { subNicho: d.subNicho }),
        ...(d.persona !== undefined && { persona: d.persona }),
        ...(d.status !== undefined && { status: d.status }),
        demandaPerene,
        concorrencia,
        cpmEstimado,
        score: calcularScoreNicho({ demandaPerene, concorrencia, cpmEstimado }),
      },
      select: { id: true },
    });

    revalidatePath("/nichos");
    revalidatePath("/");
    return nicho;
  });
}

/** Recalcula o score de todos os nichos. Útil depois de mudar a fórmula. */
export async function scoreNichos(): Promise<ActionResult<{ atualizados: number }>> {
  return acao(z.object({}), {}, async () => {
    const nichos = await prisma.nicho.findMany({
      select: { id: true, demandaPerene: true, concorrencia: true, cpmEstimado: true, score: true },
    });

    let atualizados = 0;
    for (const n of nichos) {
      const novo = calcularScoreNicho(n);
      if (novo !== n.score) {
        await prisma.nicho.update({ where: { id: n.id }, data: { score: novo } });
        atualizados++;
      }
    }

    revalidatePath("/nichos");
    return { atualizados };
  });
}

export async function deleteNicho(entrada: unknown): Promise<ActionResult<undefined>> {
  return acao(z.object({ id: idSchema }), entrada, async (d) => {
    // Cascade apaga templates e posts do nicho. Confirmação é da UI.
    await prisma.nicho.delete({ where: { id: d.id } });
    revalidatePath("/nichos");
    revalidatePath("/");
    return undefined;
  });
}

/**
 * Prompt de análise de nicho para a IA.
 *
 * Na Fase 1 a tela usa isto com copy-to-clipboard (a spec pede exatamente
 * isso). O texto vive no servidor para não duplicar o prompt no bundle do
 * cliente.
 */
export async function promptAnaliseNicho(entrada: unknown): Promise<ActionResult<string>> {
  return acao(z.object({ id: idSchema }), entrada, async (d) => {
    const n = await prisma.nicho.findUniqueOrThrow({ where: { id: d.id } });

    return [
      "Você é analista de nichos para páginas faceless no Instagram.",
      "",
      "Avalie o nicho abaixo e devolve APENAS JSON válido, sem markdown:",
      '{"demandaPerene":<1-10>,"concorrencia":<1-10>,"cpmEstimado":<USD por 1k impressões>,',
      '"subNichoRecomendado":"...","persona":"...","justificativa":"...","veredito":"ativo|descartado"}',
      "",
      "CRITÉRIOS:",
      "1. demandaPerene: o interesse existe fora de hype? 10 = busca estável há anos.",
      "2. concorrencia: 10 = saturado por páginas grandes com produção profissional.",
      "3. cpmEstimado: quanto anunciantes pagam nesse tema (finanças/saúde alto, curiosidades baixo).",
      "4. subNichoRecomendado: recorte mais estreito onde dá para vencer em 90 dias.",
      "5. persona: uma frase — quem é, idade, dor principal.",
      "6. veredito: 'descartado' se concorrência >= 8 e demanda <= 6.",
      "",
      "NICHO:",
      `nome: ${n.nome}`,
      `sub-nicho atual: ${n.subNicho ?? "(não definido)"}`,
      `persona atual: ${n.persona ?? "(não definida)"}`,
      `estimativas atuais: demanda=${n.demandaPerene ?? "?"}, concorrencia=${n.concorrencia ?? "?"}, cpm=${n.cpmEstimado ?? "?"}`,
    ].join("\n");
  });
}
