import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { iniciarMontagem, lerTrabalho, verEpisodio } from "@/lib/niche";

export const dynamic = "force-dynamic";

/** Dispara a montagem. Devolve o id do trabalho; o log vem pelo GET. */
export async function POST(req: Request) {
  await exigirSessao();
  const corpo = (await req.json()) as {
    slug?: string;
    voz?: string;
    trilha?: string;
    tempos?: string;
    forcar?: boolean;
    entregar?: boolean;
    voz_nome?: string;
  };
  if (!corpo.slug) {
    return NextResponse.json({ erro: "faltou o slug" }, { status: 400 });
  }

  try {
    // A conferência acontece aqui E no serviço. Aqui para a tela poder
    // devolver os achados junto do 409; lá porque o serviço é público e não
    // pode confiar em quem chama.
    const ep = await verEpisodio(corpo.slug);
    if (ep.erros > 0 && !corpo.forcar) {
      return NextResponse.json(
        { erro: `a pauta tem ${ep.erros} erro(s) de linter`, achados: ep.achados },
        { status: 409 },
      );
    }
    return NextResponse.json(await iniciarMontagem(corpo.slug, corpo));
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}

/** Acompanhamento: ?id=... devolve estado e log acumulado. */
export async function GET(req: Request) {
  await exigirSessao();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ erro: "faltou o id" }, { status: 400 });
  const achado = await lerTrabalho(id);
  if (!achado) return NextResponse.json({ erro: "trabalho desconhecido" }, { status: 404 });
  return NextResponse.json(achado);
}
