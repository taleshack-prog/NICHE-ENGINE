import { TituloPagina } from "@/components/layout/casca";
import { iaDisponivel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { falDisponivel } from "@/lib/fal";
import { metaDisponivel } from "@/lib/meta";
import { listarNichosSimples, listarPostsProducao } from "@/lib/queries";
import { Kanban } from "./kanban";

export const dynamic = "force-dynamic";

export default async function ProducaoPage() {
  const [posts, nichos, templates, meta] = await Promise.all([
    listarPostsProducao(),
    listarNichosSimples(),
    prisma.templateViral.findMany({
      select: { id: true, padrao: true, gancho: true, nichoId: true },
      orderBy: [{ performance: "desc" }],
    }),
    metaDisponivel(),
  ]);

  return (
    <>
      <TituloPagina
        titulo="Produção"
        descricao="Rascunho → Produzindo → Pronto → Agendado → Publicado. Clique no card para abrir o editor."
      />
      <Kanban
        posts={posts}
        nichos={nichos}
        templates={templates}
        iaDisponivel={iaDisponivel()}
        falDisponivel={falDisponivel()}
        metaDisponivel={meta}
      />
    </>
  );
}
