import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { diagnosticarChave } from "@/lib/diagnostico-ia";
import { chaveFal, MODELO_FAL } from "@/lib/fal";
import { modeloDoRoteiro, provedor } from "@/lib/pauta-ia";

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

  // Qual credencial vai escrever a pauta vem primeiro: diagnosticar a da
  // Anthropic quando quem trabalha é a fal manda consertar o que não está
  // sendo usado.
  const quem = provedor();
  const fal = chaveFal();
  if (quem === "fal") {
    return NextResponse.json({
      provedor: "fal",
      modelo: MODELO_FAL,
      chave: fal
        ? `FAL_KEY presente, ${fal.length} caracteres, termina em …${fal.slice(-4)}`
        : "FAL_KEY AUSENTE",
      veredito: fal
        ? "o rascunho e a correção usam a sua credencial da fal — a mesma da " +
          "narração. A ANTHROPIC_API_KEY não é usada e pode ficar como está."
        : "nenhuma credencial de IA no ambiente: defina FAL_KEY e faça um " +
          "novo deploy (na Vercel a variável só entra no próximo).",
    }, { status: fal ? 200 : 503 });
  }

  const d = await diagnosticarChave(modeloDoRoteiro());
  return NextResponse.json(
    { provedor: "anthropic", ...d },
    { status: d.http === 200 ? 200 : 503 },
  );
}
