import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EditorEpisodio } from "./editor-episodio";
import { lerAcervo, verEpisodio, type ItemDoAcervo } from "@/lib/niche";

export const dynamic = "force-dynamic";

export default async function PaginaEpisodio({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let episodio;
  try {
    episodio = await verEpisodio(slug);
  } catch {
    notFound();
  }
  // A lista de áudio vem junto para a aba Montagem oferecer trilha e narração
  // como escolha, em vez de caminho digitado — caminho digitado só falha três
  // minutos depois, quando o ffmpeg não acha o arquivo.
  let audio: ItemDoAcervo[] = [];
  try {
    audio = (await lerAcervo()).audio;
  } catch {
    /* acervo indisponível: a aba mostra o aviso e segue */
  }

  return (
    <>
      <Link
        href="/youtube"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-tenue transition-colors hover:text-suave"
      >
        <ArrowLeft className="size-3.5" />
        Episódios
      </Link>
      <EditorEpisodio inicial={episodio} audio={audio} />
    </>
  );
}
