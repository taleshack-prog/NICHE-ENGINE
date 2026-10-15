import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { diagnosticarChave } from "@/lib/diagnostico-ia";
import { modeloDoRoteiro } from "@/lib/pauta-ia";

export const dynamic = "force-dynamic";

/**
 * GET /api/youtube/diagnostico — confere a credencial de IA sem gastar token.
 *
 * Existe para poder perguntar "a chave da Vercel vale?" sem clicar no botão
 * pago e sem ninguém precisar colar segredo em lugar nenhum. A resposta nunca
 * traz a chave: só tamanho, prefixo público e os últimos 4.
 */
export async function GET() {
  await exigirSessao();
  const d = await diagnosticarChave(modeloDoRoteiro());
  return NextResponse.json(d, { status: d.http === 200 ? 200 : 503 });
}
