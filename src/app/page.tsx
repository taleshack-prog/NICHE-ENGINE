import Link from "next/link";
import {
  AlertTriangle,
  Bookmark,
  Eye,
  Share2,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { GraficoCrescimento } from "./grafico-crescimento";
import { TituloPagina } from "@/components/layout/casca";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";
import { Selo, TOM_STATUS } from "@/components/ui/selo";
import { FORMATO_LABEL, POST_STATUS_LABEL, type Formato, type PostStatus } from "@/lib/domain";
import {
  kpisSemana,
  listarTopicos,
  serieCrescimento,
  statusIntegracoes,
} from "@/lib/queries";
import { fmtDataHora, fmtNum } from "@/lib/utils";

// Dashboard sempre reflete o banco agora — nada aqui deve ser pré-renderizado.
export const dynamic = "force-dynamic";

export default async function VisaoGeral() {
  const [kpis, serie, topicos, integracoes] = await Promise.all([
    kpisSemana(),
    serieCrescimento(),
    listarTopicos(),
    statusIntegracoes(),
  ]);

  const cards = [
    { rotulo: "Posts publicados", valor: String(kpis.postsPublicados), Icone: TrendingUp },
    { rotulo: "Alcance", valor: fmtNum(kpis.alcance), Icone: Eye },
    { rotulo: "Salvamentos", valor: fmtNum(kpis.salvamentos), Icone: Bookmark },
    { rotulo: "Compartilhamentos", valor: fmtNum(kpis.compartilhamentos), Icone: Share2 },
    { rotulo: "Novos seguidores", valor: fmtNum(kpis.follows), Icone: UserPlus },
  ];

  return (
    <>
      <TituloPagina
        titulo="Visão geral"
        descricao="Últimos 7 dias · métricas da última coleta de cada post"
      />

      {kpis.agendadosAtrasados.length > 0 ? (
        <Card className="mb-6 border-alerta/50 bg-alerta/10">
          <CardConteudo className="flex flex-wrap items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerta" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-alerta">
                {kpis.agendadosAtrasados.length} post(s) agendado(s) com data vencida
              </p>
              <p className="mt-1 text-xs text-suave">
                A fila de publicação não os processou. Verifique se o Workflow B está ativo e se
                o token do Meta na tabela <code className="font-mono">config</code> ainda é
                válido — token expirado é a causa silenciosa mais comum.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-tenue">
                {kpis.agendadosAtrasados.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <span className="text-suave">{p.titulo}</span> — previsto para{" "}
                    {fmtDataHora(p.agendadoPara)}
                    {p.erroPublicacao ? (
                      <span className="text-erro"> · {p.erroPublicacao.slice(0, 120)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            <Link href="/producao" className="text-xs text-acento underline">
              Ver produção
            </Link>
          </CardConteudo>
        </Card>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map(({ rotulo, valor, Icone }) => (
          <Card key={rotulo}>
            <CardConteudo className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-tenue">{rotulo}</span>
                <Icone className="size-3.5 text-tenue" />
              </div>
              <p className="text-2xl font-semibold tabular-nums">{valor}</p>
            </CardConteudo>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardCabecalho>
            <CardTitulo>Crescimento — 30 dias</CardTitulo>
            <p className="text-xs text-tenue">
              Linha cheia: seguidores acumulados. Linha tracejada: alcance diário.
            </p>
          </CardCabecalho>
          <CardConteudo>
            <GraficoCrescimento dados={serie} />
          </CardConteudo>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardCabecalho>
              <CardTitulo>Melhor post dos últimos 7 dias</CardTitulo>
            </CardCabecalho>
            <CardConteudo>
              {kpis.melhorPost ? (
                <>
                  <p className="text-sm leading-snug">{kpis.melhorPost.titulo}</p>
                  <p className="mt-2 text-xs text-tenue">
                    score {kpis.melhorPost.score.toFixed(3)} · taxa de salvamento e
                    compartilhamento ponderadas pelo alcance
                  </p>
                  <Link
                    href="/analytics"
                    className="mt-3 inline-block text-xs text-acento underline"
                  >
                    Promover a template
                  </Link>
                </>
              ) : (
                <p className="text-xs text-tenue">
                  Nenhum post com métricas nos últimos 7 dias.
                </p>
              )}
            </CardConteudo>
          </Card>

          <Card>
            <CardCabecalho>
              <CardTitulo>Integrações</CardTitulo>
            </CardCabecalho>
            <CardConteudo className="space-y-2 text-xs">
              <LinhaStatus rotulo="IA (Anthropic)" ativo={integracoes.ia} fase="Fase 2" />
              <LinhaStatus rotulo="Mídia (fal.ai)" ativo={integracoes.fal} fase="Fase 3" />
              <LinhaStatus rotulo="Publicação (Meta)" ativo={integracoes.meta} fase="Fase 5" />
              {integracoes.tokenAtualizadoEm ? (
                <p className="pt-1 text-[11px] text-tenue">
                  Token Meta atualizado em {fmtDataHora(integracoes.tokenAtualizadoEm)} — expira
                  em ~60 dias a partir daí.
                </p>
              ) : null}
            </CardConteudo>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardCabecalho>
            <CardTitulo>Fila de hoje</CardTitulo>
            <p className="text-xs text-tenue">Agendamentos do dia ainda não publicados</p>
          </CardCabecalho>
          <CardConteudo>
            {kpis.filaHoje.length === 0 ? (
              <p className="text-xs text-tenue">Nada agendado para hoje.</p>
            ) : (
              <ul className="space-y-2">
                {kpis.filaHoje.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-borda bg-superficie-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{p.titulo}</p>
                      <p className="text-[11px] text-tenue">
                        {FORMATO_LABEL[p.formato as Formato] ?? p.formato} · {p.nicho}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] tabular-nums text-suave">
                        {fmtDataHora(p.agendadoPara)}
                      </span>
                      <Selo tom={TOM_STATUS[p.status] ?? "neutro"}>
                        {POST_STATUS_LABEL[p.status as PostStatus] ?? p.status}
                      </Selo>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardConteudo>
        </Card>

        <Card>
          <CardCabecalho>
            <CardTitulo>Fila de pauta</CardTitulo>
            <p className="text-xs text-tenue">
              Tabela <code className="font-mono">topicos</code> — consumida pelo Workflow A às
              06h e realimentada pelo relatório semanal
            </p>
          </CardCabecalho>
          <CardConteudo>
            {topicos.length === 0 ? (
              <p className="text-xs text-tenue">
                Fila vazia. Gere o relatório semanal em Analytics para preenchê-la.
              </p>
            ) : (
              <ul className="space-y-2">
                {topicos.slice(0, 6).map((t) => (
                  <li
                    key={t.id}
                    className="rounded-md border border-borda bg-superficie-2 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-snug">{t.tema}</p>
                      <Selo tom={t.prioridade >= 10 ? "acento" : "neutro"}>
                        p{t.prioridade}
                      </Selo>
                    </div>
                    <p className="mt-1 text-[11px] text-tenue">
                      {t.nicho?.nome ?? "sem nicho"} · {t.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardConteudo>
        </Card>
      </div>
    </>
  );
}

function LinhaStatus({
  rotulo,
  ativo,
  fase,
}: {
  rotulo: string;
  ativo: boolean;
  fase: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-suave">{rotulo}</span>
      {ativo ? (
        <Selo tom="ok">conectada</Selo>
      ) : (
        <Selo tom="neutro">pendente · {fase}</Selo>
      )}
    </div>
  );
}
