import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { criarPauta, listarEpisodios, pautaExistente } from "@/lib/niche";

export const dynamic = "force-dynamic";

export async function GET() {
  await exigirSessao();
  return NextResponse.json(await listarEpisodios());
}

/**
 * Cria o esqueleto de um episódio.
 *
 * Quem escreve o arquivo é o `niche novo` — pelo subprocesso local ou pelo
 * serviço —, nunca esta rota: o esqueleto criado pelo botão e o criado pelo
 * terminal têm que ser o mesmo, e um modelo duplicado em TypeScript
 * divergiria no primeiro conserto.
 */
export async function POST(req: Request) {
  await exigirSessao();
  const { titulo, slug } = (await req.json()) as { titulo?: string; slug?: string };
  if (!titulo?.trim()) {
    return NextResponse.json({ erro: "faltou o título" }, { status: 400 });
  }
  try {
    return NextResponse.json(await criarPauta(titulo.trim(), slug?.trim()), { status: 201 });
  } catch (e) {
    const existente = pautaExistente(e);
    if (existente) {
      return NextResponse.json(
        {
          erro: `já existe um episódio com esse título (${existente}.yml).`,
          slug: existente,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}
