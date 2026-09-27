import { TituloPagina } from "@/components/layout/casca";
import { listarNichos } from "@/lib/queries";
import { TabelaNichos } from "./tabela-nichos";

export const dynamic = "force-dynamic";

export default async function NichosPage() {
  const nichos = await listarNichos();

  return (
    <>
      <TituloPagina
        titulo="Nichos"
        descricao="Candidatos pontuados por demanda perene, concorrência e CPM. Só nichos ativos alimentam a produção."
      />
      <TabelaNichos nichos={nichos} />
    </>
  );
}
