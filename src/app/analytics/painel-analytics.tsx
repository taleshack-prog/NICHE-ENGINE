"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Crown, Download, FileBarChart, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  coletarMetricasAutomatico,
  registrarMetricas,
  relatorioSemanal,
  type ResultadoRelatorio,
} from "@/actions/metricas";
import { promoverPostATemplate } from "@/actions/templates";
import { Botao } from "@/components/ui/botao";
import { Campo, Input, Selecao } from "@/components/ui/campos";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";
import { Modal, ModalConteudo, ModalGatilho } from "@/components/ui/modal";
import { Selo } from "@/components/ui/selo";
import { TCabecalho, TCorpo, TD, TH, TLinha, Tabela, Vazio } from "@/components/ui/tabela";
import { useAcao } from "@/components/ui/use-acao";
import { FORMATO_LABEL, type Formato } from "@/lib/domain";
import type { LinhaAnalytics } from "@/lib/queries";
import { diaRef, fmtData, fmtNum, fmtPct } from "@/lib/utils";

export function PainelAnalytics({
  linhas,
  iaDisponivel,
  metaDisponivel,
}: {
  linhas: LinhaAnalytics[];
  iaDisponivel: boolean;
  metaDisponivel: boolean;
}) {
  const router = useRouter();
  const [relatorio, setRelatorio] = React.useState<ResultadoRelatorio | null>(null);
  const acaoRelatorio = useAcao();
  const acaoColeta = useAcao();
  const acaoPromover = useAcao();

  async function gerarRelatorio() {
    const r = await acaoRelatorio.executar(() => relatorioSemanal());
    if (r) {
      setRelatorio(r);
      if (r.gerado) {
        toast.success(`Relatório pronto · ${r.topicosCriados} tópico(s) na fila de pauta.`);
        router.refresh();
      }
    }
  }

  async function coletar() {
    const r = await acaoColeta.executar(() => coletarMetricasAutomatico());
    if (r) {
      toast.success(`${r.coletados} post(s) atualizados.`);
      if (r.falhas.length) toast.error(`${r.falhas.length} falha(s): ${r.falhas[0]}`);
      router.refresh();
    }
  }

  async function promover(id: string) {
    const r = await acaoPromover.executar(() => promoverPostATemplate({ postId: id }));
    if (r) {
      toast.success(
        r.jaExistia ? "Este post já está no swipe file." : "Promovido ao swipe file.",
      );
      router.refresh();
    }
  }

  function exportarCsv() {
    const cabecalho = [
      "titulo",
      "formato",
      "padrao",
      "publicado_em",
      "alcance",
      "salvamentos",
      "compartilhamentos",
      "comentarios",
      "follows",
      "retention_3s",
      "score",
      "top10",
    ];
    const corpo = linhas.map((l) =>
      [
        `"${l.titulo.replace(/"/g, '""')}"`,
        l.formato,
        l.padrao ?? "",
        l.publicadoEm?.toISOString() ?? "",
        l.alcance ?? "",
        l.salvamentos ?? "",
        l.compartilhamentos ?? "",
        l.comentarios ?? "",
        l.follows ?? "",
        l.retention3s ?? "",
        l.score,
        l.top10 ? "sim" : "nao",
      ].join(","),
    );

    const blob = new Blob([[cabecalho.join(","), ...corpo].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `niche-engine-metricas-${diaRef()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FormularioMetricas linhas={linhas} aoSalvar={() => router.refresh()} />
        <Botao
          variante="contorno"
          onClick={coletar}
          disabled={acaoColeta.carregando || !metaDisponivel}
          title={metaDisponivel ? "Coletar via Graph API" : "Graph API não configurada (Fase 5)"}
        >
          <ArrowUpRight />
          {acaoColeta.carregando ? "Coletando…" : "Coletar do Instagram"}
        </Botao>
        <Botao
          variante="contorno"
          onClick={gerarRelatorio}
          disabled={acaoRelatorio.carregando || !iaDisponivel}
          title={iaDisponivel ? "Gerar relatório semanal" : "ANTHROPIC_API_KEY ausente"}
        >
          <FileBarChart />
          {acaoRelatorio.carregando ? "Analisando…" : "Relatório semanal"}
        </Botao>
        <Botao variante="fantasma" onClick={exportarCsv} disabled={linhas.length === 0}>
          <Download />
          CSV
        </Botao>
      </div>

      {relatorio ? <BlocoRelatorio r={relatorio} /> : null}

      <div className="rounded-xl border border-borda bg-superficie">
        <Tabela>
          <TCabecalho>
            <TLinha>
              <TH>Post</TH>
              <TH className="w-24">Padrão</TH>
              <TH className="w-24 text-right">Alcance</TH>
              <TH className="w-20 text-right">Salvos</TH>
              <TH className="w-20 text-right">Compart.</TH>
              <TH className="w-20 text-right">Coment.</TH>
              <TH className="w-20 text-right">Follows</TH>
              <TH className="w-20 text-right">Ret. 3s</TH>
              <TH className="w-20 text-right">Score</TH>
              <TH className="w-px" />
            </TLinha>
          </TCabecalho>
          <TCorpo>
            {linhas.length === 0 ? (
              <Vazio colSpan={10}>
                Nenhum post publicado com métricas. Publique, registre as métricas e o ranking
                aparece aqui.
              </Vazio>
            ) : (
              linhas.map((l) => (
                <TLinha key={l.id} className={l.top10 ? "bg-ok/5" : undefined}>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      {l.top10 ? <Crown className="size-3.5 shrink-0 text-ok" /> : null}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.titulo}</p>
                        <p className="text-[11px] text-tenue">
                          {FORMATO_LABEL[l.formato as Formato] ?? l.formato} ·{" "}
                          {fmtData(l.publicadoEm)}
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD className="text-xs text-suave">{l.padrao ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{fmtNum(l.alcance)}</TD>
                  <TD className="text-right tabular-nums">{fmtNum(l.salvamentos)}</TD>
                  <TD className="text-right tabular-nums">{fmtNum(l.compartilhamentos)}</TD>
                  <TD className="text-right tabular-nums">{fmtNum(l.comentarios)}</TD>
                  <TD className="text-right tabular-nums">{fmtNum(l.follows)}</TD>
                  <TD className="text-right tabular-nums">{fmtPct(l.retention3s)}</TD>
                  <TD className="text-right">
                    <Selo tom={l.top10 ? "ok" : "neutro"}>{l.score.toFixed(3)}</Selo>
                  </TD>
                  <TD>
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      disabled={acaoPromover.carregando}
                      onClick={() => promover(l.id)}
                      title="Promover a template no swipe file"
                    >
                      <Crown />
                    </Botao>
                  </TD>
                </TLinha>
              ))
            )}
          </TCorpo>
        </Tabela>
      </div>

      <p className="mt-3 text-[11px] text-tenue">
        Score = (salvamentos/alcance × 6) + (compartilhamentos/alcance × 5) + (retenção 3s ×
        0,4). Taxas, não valores absolutos — assim um post de alcance pequeno com guarda alta
        não fica invisível. A coroa marca o top 10%.
      </p>
    </>
  );
}

function BlocoRelatorio({ r }: { r: ResultadoRelatorio }) {
  if (!r.gerado) {
    return (
      <Card className="mb-4 border-alerta/40 bg-alerta/10">
        <CardConteudo className="p-4 text-sm text-alerta">
          {r.motivo}
          <span className="mt-1 block text-xs text-suave">
            Posts com métricas nesta semana: {r.postsNaSemana}.
          </span>
        </CardConteudo>
      </Card>
    );
  }

  const { relatorio } = r;
  return (
    <Card className="mb-4">
      <CardCabecalho>
        <CardTitulo>Relatório da semana</CardTitulo>
        <p className="text-xs text-tenue">
          {r.topicosCriados} tópico(s) inserido(s) na fila de pauta — o Workflow A os consome na
          próxima execução.
        </p>
      </CardCabecalho>
      <CardConteudo className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ok">
            Padrões vencedores
          </h4>
          <ul className="space-y-2">
            {relatorio.padroesVencedores.map((p) => (
              <li key={p.padrao} className="text-xs">
                <span className="font-medium text-texto">{p.padrao}</span>
                <span className="block text-tenue">{p.evidencia}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-erro">
            Padrões perdedores
          </h4>
          <ul className="space-y-2">
            {relatorio.padroesPerdedores.length === 0 ? (
              <li className="text-xs text-tenue">Nenhum apontado.</li>
            ) : (
              relatorio.padroesPerdedores.map((p) => (
                <li key={p.padrao} className="text-xs">
                  <span className="font-medium text-texto">{p.padrao}</span>
                  <span className="block text-tenue">{p.evidencia}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="md:col-span-2">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-suave">
            Hipóteses para testar
          </h4>
          <ul className="list-inside list-disc space-y-1 text-xs text-tenue">
            {relatorio.hipoteses.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2 rounded-lg border border-acento/40 bg-acento/10 p-3">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-acento">
            Recomendação
          </h4>
          <p className="text-sm">{relatorio.recomendacaoProximaSemana}</p>
        </div>
      </CardConteudo>
    </Card>
  );
}

function FormularioMetricas({
  linhas,
  aoSalvar,
}: {
  linhas: LinhaAnalytics[];
  aoSalvar: () => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const { carregando, campos, executar } = useAcao();

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await executar(
      () =>
        registrarMetricas({
          postId: fd.get("postId"),
          dataRef: fd.get("dataRef") || undefined,
          alcance: fd.get("alcance") || undefined,
          impressoes: fd.get("impressoes") || undefined,
          salvamentos: fd.get("salvamentos") || undefined,
          compartilhamentos: fd.get("compartilhamentos") || undefined,
          comentarios: fd.get("comentarios") || undefined,
          followsGanhos: fd.get("followsGanhos") || undefined,
          retention3s: fd.get("retention3s") || undefined,
          watchRate: fd.get("watchRate") || undefined,
        }),
      { sucesso: "Métricas registradas." },
    );
    if (r) {
      setAberto(false);
      aoSalvar();
    }
  }

  return (
    <Modal open={aberto} onOpenChange={setAberto}>
      <ModalGatilho asChild>
        <Botao variante="primario" disabled={linhas.length === 0}>
          <Plus />
          Registrar métricas
        </Botao>
      </ModalGatilho>
      <ModalConteudo
        titulo="Registrar métricas"
        descricao="Uma linha por post e por dia. Registrar de novo no mesmo dia atualiza a linha em vez de duplicar."
        largura="lg"
      >
        <form onSubmit={enviar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Campo rotulo="Post" erro={campos.postId} htmlFor="mt-post">
              <Selecao id="mt-post" name="postId" required>
                {linhas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.titulo.slice(0, 60)}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Data" erro={campos.dataRef} htmlFor="mt-data">
              <Input id="mt-data" name="dataRef" type="date" defaultValue={diaRef()} />
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Campo rotulo="Alcance" erro={campos.alcance} htmlFor="mt-alcance">
              <Input id="mt-alcance" name="alcance" type="number" min={0} />
            </Campo>
            <Campo rotulo="Impressões" erro={campos.impressoes} htmlFor="mt-imp">
              <Input id="mt-imp" name="impressoes" type="number" min={0} />
            </Campo>
            <Campo rotulo="Salvamentos" erro={campos.salvamentos} htmlFor="mt-salv">
              <Input id="mt-salv" name="salvamentos" type="number" min={0} />
            </Campo>
            <Campo
              rotulo="Compartilh."
              erro={campos.compartilhamentos}
              htmlFor="mt-comp"
            >
              <Input id="mt-comp" name="compartilhamentos" type="number" min={0} />
            </Campo>
            <Campo rotulo="Comentários" erro={campos.comentarios} htmlFor="mt-coment">
              <Input id="mt-coment" name="comentarios" type="number" min={0} />
            </Campo>
            <Campo rotulo="Follows" erro={campos.followsGanhos} htmlFor="mt-follows">
              <Input id="mt-follows" name="followsGanhos" type="number" min={0} />
            </Campo>
            <Campo rotulo="Ret. 3s (%)" erro={campos.retention3s} htmlFor="mt-ret">
              <Input id="mt-ret" name="retention3s" type="number" min={0} max={100} step="0.1" />
            </Campo>
            <Campo rotulo="Watch rate (%)" erro={campos.watchRate} htmlFor="mt-watch">
              <Input id="mt-watch" name="watchRate" type="number" min={0} max={100} step="0.1" />
            </Campo>
          </div>

          <p className="text-[11px] text-tenue">
            Percentuais aceitos como 0-100 ou 0-1 — são normalizados para fração no banco.
          </p>

          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="primario" disabled={carregando}>
              {carregando ? "Salvando…" : "Salvar"}
            </Botao>
          </div>
        </form>
      </ModalConteudo>
    </Modal>
  );
}
