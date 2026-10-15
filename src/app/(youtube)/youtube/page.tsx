import Link from "next/link";
import { AlertTriangle, Clock, Film, Layers, Terminal } from "lucide-react";
import { NovoEpisodio } from "./novo-episodio";
import { TituloPagina } from "@/components/layout/casca";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";
import { Selo, type SeloTom } from "@/components/ui/selo";
import { listarEpisodios, remoto, type Episodio } from "@/lib/niche";

export const dynamic = "force-dynamic";

const TOM: Record<Episodio["estado"], SeloTom> = {
  quebrada: "erro",
  rascunho: "alerta",
  pronta: "acento",
  montada: "roxo",
  publicada: "ok",
};

const EXPLICA: Record<Episodio["estado"], string> = {
  quebrada: "o arquivo não carrega",
  rascunho: "o linter recusa — corrija antes de montar",
  pronta: "passa nas regras, falta montar",
  montada: "mp4 pronto, falta publicar",
  publicada: "no ar",
};

function minutos(segundos?: number): string {
  if (!segundos) return "—";
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return m ? `${m}m${String(s).padStart(2, "0")}` : `${s}s`;
}

export default async function PaginaEpisodios() {
  const servico = Boolean(remoto());
  let episodios: Episodio[] = [];
  let falha: string | null = null;
  try {
    episodios = await listarEpisodios();
  } catch (e) {
    falha = (e as Error).message;
  }

  return (
    <>
      <TituloPagina
        titulo="Episódios"
        descricao="Cada episódio é um arquivo em pautas/. O linter roda aqui e na montagem — é o mesmo código."
        acoes={<NovoEpisodio />}
      />

      {falha ? (
        <Card className="border-erro/40">
          <CardConteudo className="space-y-2 pt-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-erro">
              <Terminal className="size-4" />
              {servico ? "o serviço de render recusou" : "não consegui falar com o pacote niche"}
            </p>
            {/* A explicação depende de ONDE o dashboard está rodando. Falar de
                PATH e pillow para quem está na Vercel manda procurar o erro no
                lugar errado — o Python de lá não é o problema. */}
            {servico ? (
              <p className="text-tenue">
                {falha.includes("401")
                  ? "401 quer dizer que o dashboard chegou ao serviço, mas o NICHE_TOKEN das duas pontas não é o mesmo. Compare o valor no Railway e na Vercel — espaço ou quebra de linha ao colar já basta."
                  : "O dashboard fala com o serviço por NICHE_API_URL. Confira se o endereço está certo e se o serviço está de pé em /saude."}
              </p>
            ) : (
              <p className="text-tenue">
                O dashboard chama <code className="text-suave">python3 -m niche listar</code> na
                raiz do repositório. Confira se o Python 3.11+ está no PATH e se
                <code className="text-suave"> pyyaml</code> e{" "}
                <code className="text-suave">pillow</code> estão instalados.
              </p>
            )}
            <pre className="overflow-x-auto rounded-md bg-fundo p-3 text-xs text-suave">{falha}</pre>
          </CardConteudo>
        </Card>
      ) : null}

      {!falha && episodios.length === 0 ? (
        <Card>
          <CardConteudo className="pt-4 text-sm text-tenue">
            Nenhuma pauta em <code className="text-suave">pautas/</code>. Copie uma das
            existentes como ponto de partida — elas são os dois episódios já publicados.
          </CardConteudo>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {episodios.map((ep) => (
          <Card key={ep.slug} className="flex flex-col">
            <CardCabecalho>
              <div className="flex items-start justify-between gap-2">
                <CardTitulo className="leading-snug">{ep.titulo}</CardTitulo>
                <Selo tom={TOM[ep.estado]}>{ep.estado}</Selo>
              </div>
              <p className="text-[11px] text-tenue">{EXPLICA[ep.estado]}</p>
            </CardCabecalho>

            <CardConteudo className="flex flex-1 flex-col gap-3">
              {ep.defeito ? (
                <pre className="overflow-x-auto rounded-md bg-fundo p-2 text-[11px] text-erro">
                  {ep.defeito}
                </pre>
              ) : (
                <p className="line-clamp-3 text-xs leading-relaxed text-suave">{ep.angulo}</p>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-tenue">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" />
                  {minutos(ep.segundos)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Layers className="size-3" />
                  {ep.planos ?? 0} planos
                </span>
                {ep.video ? (
                  <span className="inline-flex items-center gap-1 text-roxo">
                    <Film className="size-3" />
                    mp4
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {ep.erros > 0 ? (
                  <Selo tom="erro">
                    <AlertTriangle className="size-3" />
                    {ep.erros} erro{ep.erros > 1 ? "s" : ""}
                  </Selo>
                ) : (
                  <Selo tom="ok">regras ok</Selo>
                )}
                {ep.avisos > 0 ? <Selo tom="alerta">{ep.avisos} aviso{ep.avisos > 1 ? "s" : ""}</Selo> : null}
                {ep.fontes?.length ? (
                  <Selo>{ep.fontes.length} fonte{ep.fontes.length > 1 ? "s" : ""}</Selo>
                ) : null}
              </div>

              <Link
                href={`/youtube/${ep.slug}`}
                className="mt-auto inline-flex h-9 items-center justify-center rounded-md bg-superficie-2 px-3.5 text-sm font-medium text-texto transition-colors hover:bg-borda"
              >
                Abrir
              </Link>
            </CardConteudo>
          </Card>
        ))}
      </div>
    </>
  );
}
