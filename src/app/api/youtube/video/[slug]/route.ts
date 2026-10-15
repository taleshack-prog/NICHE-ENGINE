import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { buscarVideo, PASTA_RENDERS, remoto } from "@/lib/niche";

export const dynamic = "force-dynamic";

type Faixa = { start?: number; end?: number };

function fluxo(caminho: string, opcoes?: Faixa): ReadableStream<Uint8Array> {
  const leitor = createReadStream(caminho, opcoes);
  return new ReadableStream({
    start(ctrl) {
      leitor.on("data", (c) => ctrl.enqueue(new Uint8Array(c as Buffer)));
      leitor.on("end", () => ctrl.close());
      leitor.on("error", (e) => ctrl.error(e));
    },
    cancel() {
      leitor.destroy();
    },
  });
}

/**
 * Serve o mp4 montado, com suporte a Range.
 *
 * Sem Range o <video> baixa os 11 MB inteiros antes do primeiro quadro e não
 * deixa arrastar a linha do tempo — que é justamente o que se quer fazer ao
 * conferir se a legenda caiu no lugar certo.
 *
 * Com serviço remoto esta rota é um PROXY: o mp4 mora no volume do Railway,
 * atrás de um token que não pode ir para o navegador. O Range é repassado
 * para o serviço, então arrastar a linha continua funcionando.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  await exigirSessao();
  const { slug } = await params;
  if (!/^[\w-]{1,80}$/.test(slug)) {
    return NextResponse.json({ erro: "nome inválido" }, { status: 400 });
  }
  const range = req.headers.get("range");

  if (remoto()) {
    const r = await buscarVideo(slug, range);
    if (!r.ok || !r.body) {
      return NextResponse.json(
        { erro: r.status === 404 ? "ainda não montado" : `serviço respondeu ${r.status}` },
        { status: r.status === 404 ? 404 : 502 },
      );
    }
    const cabecalhos = new Headers({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
    for (const nome of ["content-length", "content-range"]) {
      const v = r.headers.get(nome);
      if (v) cabecalhos.set(nome, v);
    }
    return new NextResponse(r.body, { status: r.status, headers: cabecalhos });
  }

  const arquivo = path.join(PASTA_RENDERS, `${slug}.mp4`);
  if (!existsSync(arquivo)) {
    return NextResponse.json({ erro: "ainda não montado" }, { status: 404 });
  }
  const { size } = statSync(arquivo);
  if (range) {
    const [cru0, cru1] = range.replace(/bytes=/, "").split("-");
    const inicio = Number(cru0);
    const fim = cru1 ? Number(cru1) : size - 1;
    return new NextResponse(fluxo(arquivo, { start: inicio, end: fim }), {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fim - inicio + 1),
        "Content-Range": `bytes ${inicio}-${fim}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }
  return new NextResponse(fluxo(arquivo), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
    },
  });
}
