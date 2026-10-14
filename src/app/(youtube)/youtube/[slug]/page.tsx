import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EditorEpisodio } from "./editor-episodio";
import { verEpisodio } from "@/lib/niche";

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

  return (
    <>
      <Link
        href="/youtube"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-tenue transition-colors hover:text-suave"
      >
        <ArrowLeft className="size-3.5" />
        Episódios
      </Link>
      <EditorEpisodio inicial={episodio} />
    </>
  );
}
