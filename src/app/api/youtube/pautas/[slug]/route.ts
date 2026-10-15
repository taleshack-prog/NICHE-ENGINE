import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { caminhoDaPauta, salvarPauta, verEpisodio } from "@/lib/niche";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  await exigirSessao();
  const { slug } = await params;
  try {
    return NextResponse.json(await verEpisodio(slug));
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  await exigirSessao();
  const { slug } = await params;
  const { yaml } = (await req.json()) as { yaml?: string };
  if (typeof yaml !== "string") {
    return NextResponse.json({ erro: "faltou o campo yaml" }, { status: 400 });
  }
  try {
    // Salvar JÁ devolve a leitura nova: o linter roda no servidor, no mesmo
    // código que a montagem usa, e a tela só mostra o que ele disse.
    return NextResponse.json(await salvarPauta(slug, yaml));
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}

/**
 * Apaga a pauta — e SÓ ela.
 *
 * O mp4 em renders/ fica: render custa minutos, e apagar junto transformaria
 * um clique errado numa espera de três minutos para recuperar o que já estava
 * pronto.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  await exigirSessao();
  const { slug } = await params;
  try {
    await unlink(caminhoDaPauta(slug));
    return NextResponse.json({ apagada: slug });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}
