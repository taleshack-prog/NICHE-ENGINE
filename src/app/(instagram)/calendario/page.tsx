import { TituloPagina } from "@/components/layout/casca";
import { listarPostsAgendaveis } from "@/lib/queries";
import { Calendario } from "./calendario";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  const posts = await listarPostsAgendaveis();

  return (
    <>
      <TituloPagina
        titulo="Calendário"
        descricao="Agendamentos e publicações. Arraste um post para outro dia para reagendar."
      />
      <Calendario posts={posts} />
    </>
  );
}
