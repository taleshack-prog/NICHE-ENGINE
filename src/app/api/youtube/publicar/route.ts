import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { gravarPublicacao } from "@/lib/niche";

export const dynamic = "force-dynamic";

/**
 * Título, descrição, hashtags e link vão para a PRÓPRIA pauta.
 *
 * Um episódio é um arquivo só: o que foi dito e o que foi ao ar ficam juntos,
 * e não existe banco para sincronizar. Quem escreve é o `niche publicar`, que
 * troca só o bloco `publicacao:` e preserva os comentários do arquivo.
 */
export async function POST(req: Request) {
  await exigirSessao();
  const { slug, ...dados } = (await req.json()) as {
    slug?: string;
    titulo?: string;
    descricao?: string;
    hashtags?: string[];
    url?: string;
    publicado_em?: string;
  };
  if (!slug) return NextResponse.json({ erro: "faltou o slug" }, { status: 400 });

  try {
    return NextResponse.json(await gravarPublicacao(slug, dados));
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}
