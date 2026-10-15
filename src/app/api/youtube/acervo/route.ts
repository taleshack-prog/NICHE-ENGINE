import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { enviarAoAcervo, lerAcervo, removerDoAcervo } from "@/lib/niche";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TIPOS = ["obras", "ilustra", "audio"] as const;
type Tipo = (typeof TIPOS)[number];

// Teto por arquivo. As obras em alta resolução chegam a 7 MB; 40 cobre com
// folga e ainda barra o upload acidental de um vídeo inteiro.
const MAXIMO = 40 * 1024 * 1024;

function tipoValido(t: string | null): t is Tipo {
  return TIPOS.includes(t as Tipo);
}

export async function GET() {
  await exigirSessao();
  try {
    return NextResponse.json(await lerAcervo());
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 });
  }
}

/**
 * Sobe obra, ilustração ou trilha.
 *
 * O acervo NÃO vai para o git: 22 MB de arte em histórico de repositório é
 * dívida permanente, e cada episódio novo traz arte nova. Localmente cai em
 * acervo/ (ignorado pelo git); com serviço, no volume do Railway.
 */
export async function POST(req: Request) {
  await exigirSessao();
  const forma = await req.formData();
  const tipo = forma.get("tipo");
  const arquivo = forma.get("arquivo");

  if (typeof tipo !== "string" || !tipoValido(tipo)) {
    return NextResponse.json({ erro: "tipo inválido" }, { status: 400 });
  }
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ erro: "faltou o arquivo" }, { status: 400 });
  }
  if (arquivo.size > MAXIMO) {
    return NextResponse.json({ erro: "arquivo acima de 40 MB" }, { status: 413 });
  }

  try {
    const item = await enviarAoAcervo(tipo, arquivo.name, await arquivo.arrayBuffer());
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  await exigirSessao();
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo");
  const nome = url.searchParams.get("nome");
  if (!tipoValido(tipo) || !nome) {
    return NextResponse.json({ erro: "faltou tipo ou nome" }, { status: 400 });
  }
  try {
    await removerDoAcervo(tipo, nome);
    return NextResponse.json({ removido: nome });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}
