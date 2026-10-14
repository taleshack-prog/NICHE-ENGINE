import { TituloPagina } from "@/components/layout/casca";
import { iaDisponivel } from "@/lib/ai";
import { listarNichosSimples, listarPadroes, listarTemplates } from "@/lib/queries";
import { SwipeFile } from "./swipe-file";

export const dynamic = "force-dynamic";

export default async function SwipePage() {
  const [templates, nichos, padroes] = await Promise.all([
    listarTemplates(),
    listarNichosSimples(),
    listarPadroes(),
  ]);

  return (
    <>
      <TituloPagina
        titulo="Swipe file"
        descricao="Templates virais decompostos em gancho, retenção, loop e CTA. A geração de roteiro exige 3 templates diferentes por nicho."
      />
      <SwipeFile
        templates={templates}
        nichos={nichos}
        padroes={padroes}
        iaDisponivel={iaDisponivel()}
      />
    </>
  );
}
