import { TituloPagina } from "@/components/layout/casca";
import { iaDisponivel } from "@/lib/ai";
import { metaDisponivel } from "@/lib/meta";
import { tabelaAnalytics } from "@/lib/queries";
import { PainelAnalytics } from "./painel-analytics";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [linhas, meta] = await Promise.all([tabelaAnalytics(), metaDisponivel()]);

  return (
    <>
      <TituloPagina
        titulo="Analytics"
        descricao="Métricas por post, ranking top 10% por score (salvamentos > compartilhamentos > retenção > alcance) e relatório semanal que realimenta a fila de pauta."
      />
      <PainelAnalytics linhas={linhas} iaDisponivel={iaDisponivel()} metaDisponivel={meta} />
    </>
  );
}
