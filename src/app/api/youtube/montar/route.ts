import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { iniciarMontagem, lerTrabalho, verEpisodio } from "@/lib/niche";

export const dynamic = "force-dynamic";

/** Dispara a montagem. Devolve o id do trabalho; o log vem pelo GET. */
export async function POST(req: Request) {
  await exigirSessao();
  const corpo = (await req.json()) as {
    slug?: string;
    obras?: string;
    ilustra?: string;
    voz?: string;
    trilha?: string;
    tempos?: string;
    forcar?: boolean;
  };
  if (!corpo.slug) {
    return NextResponse.json({ erro: "faltou o slug" }, { status: 400 });
  }

  try {
    const ep = await verEpisodio(corpo.slug);
    if (ep.erros > 0 && !corpo.forcar) {
      return NextResponse.json(
        { erro: `a pauta tem ${ep.erros} erro(s) de linter`, achados: ep.achados },
        { status: 409 },
      );
    }

    const extras: string[] = [];
    // Pastas e arquivos vêm digitados pelo usuário. Conferir a existência aqui
    // transforma "ffmpeg falhou" três minutos depois em uma frase clara agora.
    for (const [bandeira, valor] of [
      ["--obras", corpo.obras], ["--ilustra", corpo.ilustra],
      ["--voz", corpo.voz], ["--trilha", corpo.trilha],
    ] as const) {
      if (!valor) continue;
      // turbopackIgnore: caminho montado em tempo de execução a partir do que
      // o usuário digitou. Sem a marca, a análise estática conclui que o
      // projeto inteiro pode ser lido e empacota tudo na saída do build.
      const alvo = path.isAbsolute(valor)
        ? valor
        : path.join(/* turbopackIgnore: true */ process.cwd(), valor);
      if (!existsSync(alvo)) {
        return NextResponse.json(
          { erro: `não achei ${bandeira} ${valor}` }, { status: 400 });
      }
      extras.push(bandeira, alvo);
    }
    if (corpo.tempos) extras.push("--tempos", corpo.tempos);
    if (corpo.forcar) extras.push("--forcar");

    return NextResponse.json(await iniciarMontagem(corpo.slug, extras));
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
