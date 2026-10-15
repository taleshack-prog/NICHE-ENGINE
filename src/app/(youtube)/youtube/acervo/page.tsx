import { TituloPagina } from "@/components/layout/casca";
import { Card, CardConteudo } from "@/components/ui/card";
import { lerAcervo, remoto, type Acervo } from "@/lib/niche";
import { PainelAcervo } from "./painel-acervo";

export const dynamic = "force-dynamic";

export default async function PaginaAcervo() {
  let acervo: Acervo | null = null;
  let falha: string | null = null;
  try {
    acervo = await lerAcervo();
  } catch (e) {
    falha = (e as Error).message;
  }

  return (
    <>
      <TituloPagina
        titulo="Acervo"
        descricao="As obras, as ilustrações e as trilhas que a montagem usa. Não vão para o git."
      />

      {falha ? (
        <Card className="border-erro/40">
          <CardConteudo className="pt-4 text-sm">
            <p className="font-medium text-erro">não consegui ler o acervo</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-fundo p-3 text-xs text-suave">
              {falha}
            </pre>
          </CardConteudo>
        </Card>
      ) : (
        <PainelAcervo inicial={acervo!} remoto={Boolean(remoto())} />
      )}
    </>
  );
}
