import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { salvarPauta, verEpisodio } from "@/lib/niche";

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
