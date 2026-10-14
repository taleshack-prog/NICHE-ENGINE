import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { listarEpisodios, RAIZ, type Episodio } from "@/lib/niche";

const executar = promisify(execFile);
export const dynamic = "force-dynamic";

export async function GET() {
  await exigirSessao();
  return NextResponse.json(await listarEpisodios());
}

/**
 * Cria o esqueleto de um episódio.
 *
 * Quem escreve o arquivo é o `niche novo`, não esta rota: o esqueleto criado
 * pelo botão e o criado pelo terminal têm que ser o mesmo, e um modelo
 * duplicado em TypeScript divergiria no primeiro conserto.
 */
export async function POST(req: Request) {
  await exigirSessao();
  const { titulo, slug } = (await req.json()) as { titulo?: string; slug?: string };
  if (!titulo?.trim()) {
    return NextResponse.json({ erro: "faltou o título" }, { status: 400 });
  }

  const args = ["-m", "niche", "novo", titulo.trim(), "--json"];
  if (slug?.trim()) args.push("--slug", slug.trim());

  try {
    const { stdout } = await executar(process.env.NICHE_PYTHON ?? "python3", args, {
      cwd: RAIZ,
      maxBuffer: 16 * 1024 * 1024,
    });
    return NextResponse.json(JSON.parse(stdout) as Episodio, { status: 201 });
  } catch (e) {
    const erro = e as { stderr?: string; message: string };
    return NextResponse.json(
      { erro: (erro.stderr || erro.message).trim() }, { status: 400 });
  }
}
