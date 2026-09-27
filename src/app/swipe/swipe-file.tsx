"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, Sparkles, Trash2 } from "lucide-react";
import { createTemplate, decomposeViral, deleteTemplate } from "@/actions/templates";
import { Botao } from "@/components/ui/botao";
import { AreaTexto, Campo, Input, Selecao } from "@/components/ui/campos";
import { Card, CardConteudo } from "@/components/ui/card";
import { Modal, ModalConteudo, ModalGatilho } from "@/components/ui/modal";
import { Selo } from "@/components/ui/selo";
import { useAcao } from "@/components/ui/use-acao";
import { lerEstrutura } from "@/lib/json-fields";
import { fmtNum } from "@/lib/utils";

export type TemplateCard = {
  id: string;
  fonte: string;
  gancho: string;
  padrao: string;
  performance: number | null;
  estrutura: string;
  transcricao: string | null;
  nichoId: string;
  nicho: { nome: string };
  _count: { posts: number };
};

type NichoOpcao = { id: string; nome: string; subNicho: string | null };

export function SwipeFile({
  templates,
  nichos,
  padroes,
  iaDisponivel,
}: {
  templates: TemplateCard[];
  nichos: NichoOpcao[];
  padroes: string[];
  iaDisponivel: boolean;
}) {
  const router = useRouter();
  const [filtroNicho, setFiltroNicho] = React.useState("");
  const [filtroPadrao, setFiltroPadrao] = React.useState("");
  const { carregando, executar } = useAcao();

  const visiveis = templates.filter(
    (t) =>
      (!filtroNicho || t.nichoId === filtroNicho) &&
      (!filtroPadrao || t.padrao === filtroPadrao),
  );

  async function remover(id: string, gancho: string) {
    if (!window.confirm(`Excluir o template "${gancho.slice(0, 60)}"?`)) return;
    await executar(() => deleteTemplate({ id }), {
      sucesso: "Template excluído.",
      aoConcluir: () => router.refresh(),
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FormularioDecomposicao
          nichos={nichos}
          iaDisponivel={iaDisponivel}
          aoSalvar={() => router.refresh()}
        />
        <FormularioManual nichos={nichos} aoSalvar={() => router.refresh()} />

        <div className="ml-auto flex items-center gap-2">
          <Selecao
            aria-label="Filtrar por nicho"
            value={filtroNicho}
            onChange={(e) => setFiltroNicho(e.target.value)}
            className="h-8 w-44 text-xs"
          >
            <option value="">Todos os nichos</option>
            {nichos.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nome}
              </option>
            ))}
          </Selecao>
          <Selecao
            aria-label="Filtrar por padrão"
            value={filtroPadrao}
            onChange={(e) => setFiltroPadrao(e.target.value)}
            className="h-8 w-44 text-xs"
          >
            <option value="">Todos os padrões</option>
            {padroes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Selecao>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <Card>
          <CardConteudo className="py-12 text-center text-sm text-tenue">
            {templates.length === 0 ? (
              <>
                Swipe file vazio. Colar a transcrição de um Reel que performou e decompor é o
                primeiro passo do sistema — a geração de roteiro exige 3 templates por nicho.
              </>
            ) : (
              "Nenhum template com esses filtros."
            )}
          </CardConteudo>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((t) => {
            const e = lerEstrutura(t.estrutura);
            const link = t.fonte.startsWith("http") ? t.fonte : null;
            return (
              <Card key={t.id} className="flex flex-col">
                <CardConteudo className="flex-1 space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Selo tom="acento">{t.padrao}</Selo>
                    <div className="flex items-center gap-1">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir Reel original"
                          className="rounded p-1 text-tenue hover:bg-superficie-2 hover:text-texto"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        title="Excluir"
                        disabled={carregando}
                        onClick={() => remover(t.id, t.gancho)}
                        className="rounded p-1 text-tenue hover:bg-superficie-2 hover:text-erro"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm font-medium leading-snug">{t.gancho}</p>

                  <dl className="space-y-1.5 text-[11px] text-tenue">
                    {e.retention ? (
                      <div>
                        <dt className="inline font-semibold text-suave">Retenção: </dt>
                        <dd className="inline">{e.retention}</dd>
                      </div>
                    ) : null}
                    {e.loop ? (
                      <div>
                        <dt className="inline font-semibold text-suave">Loop: </dt>
                        <dd className="inline">{e.loop}</dd>
                      </div>
                    ) : null}
                    {e.cta ? (
                      <div>
                        <dt className="inline font-semibold text-suave">CTA: </dt>
                        <dd className="inline">{e.cta}</dd>
                      </div>
                    ) : null}
                  </dl>
                </CardConteudo>
                <div className="flex items-center justify-between border-t border-borda px-4 py-2 text-[11px] text-tenue">
                  <span>{t.nicho.nome}</span>
                  <span className="tabular-nums">
                    {t.performance ? `${fmtNum(t.performance)} views` : "sem dado"} ·{" "}
                    {t._count.posts} post(s)
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function FormularioDecomposicao({
  nichos,
  iaDisponivel,
  aoSalvar,
}: {
  nichos: NichoOpcao[];
  iaDisponivel: boolean;
  aoSalvar: () => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const { carregando, campos, executar } = useAcao();

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await executar(
      () =>
        decomposeViral({
          nichoId: fd.get("nichoId"),
          transcricao: fd.get("transcricao"),
          fonte: fd.get("fonte") || undefined,
        }),
      { sucesso: "Decomposto e salvo no swipe file." },
    );
    if (r) {
      setAberto(false);
      aoSalvar();
    }
  }

  return (
    <Modal open={aberto} onOpenChange={setAberto}>
      <ModalGatilho asChild>
        <Botao variante="primario" disabled={nichos.length === 0}>
          <Sparkles />
          Decompor viral
        </Botao>
      </ModalGatilho>
      <ModalConteudo
        titulo="Decompor Reel viral"
        descricao="Cole a transcrição. A IA extrai gancho, mecanismo de retenção, loop, CTA e nomeia o padrão."
        largura="lg"
      >
        {!iaDisponivel ? (
          <p className="mb-3 rounded-md border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
            ANTHROPIC_API_KEY não configurada. Preencha no .env para usar a decomposição
            automática, ou cadastre o template manualmente.
          </p>
        ) : null}

        <form onSubmit={enviar} className="space-y-3">
          <Campo rotulo="Nicho" erro={campos.nichoId} htmlFor="d-nicho">
            <Selecao id="d-nicho" name="nichoId" required>
              {nichos.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nome}
                  {n.subNicho ? ` — ${n.subNicho}` : ""}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Link do Reel original" erro={campos.fonte} htmlFor="d-fonte">
            <Input id="d-fonte" name="fonte" placeholder="https://instagram.com/reel/..." />
          </Campo>
          <Campo
            rotulo="Transcrição"
            erro={campos.transcricao}
            htmlFor="d-transcricao"
            dica="Mínimo ~40 caracteres. Transcrição completa dá decomposição melhor que resumo."
          >
            <AreaTexto
              id="d-transcricao"
              name="transcricao"
              required
              rows={10}
              placeholder="Ninguém te conta isso sobre…"
            />
          </Campo>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="primario" disabled={carregando || !iaDisponivel}>
              {carregando ? "Decompondo…" : "Decompor com IA"}
            </Botao>
          </div>
        </form>
      </ModalConteudo>
    </Modal>
  );
}

function FormularioManual({
  nichos,
  aoSalvar,
}: {
  nichos: NichoOpcao[];
  aoSalvar: () => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const { carregando, campos, executar } = useAcao();

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await executar(
      () =>
        createTemplate({
          nichoId: fd.get("nichoId"),
          fonte: fd.get("fonte"),
          gancho: fd.get("gancho"),
          padrao: fd.get("padrao"),
          performance: fd.get("performance") || undefined,
          estrutura: {
            retention: String(fd.get("retention") ?? "") || undefined,
            loop: String(fd.get("loop") ?? "") || undefined,
            cta: String(fd.get("cta") ?? "") || undefined,
          },
        }),
      { sucesso: "Template salvo." },
    );
    if (r) {
      setAberto(false);
      aoSalvar();
    }
  }

  return (
    <Modal open={aberto} onOpenChange={setAberto}>
      <ModalGatilho asChild>
        <Botao variante="contorno" disabled={nichos.length === 0}>
          <Plus />
          Cadastro manual
        </Botao>
      </ModalGatilho>
      <ModalConteudo
        titulo="Template manual"
        descricao="Para quando você já sabe o padrão e não quer gastar chamada de IA."
        largura="lg"
      >
        <form onSubmit={enviar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nicho" erro={campos.nichoId} htmlFor="m-nicho">
              <Selecao id="m-nicho" name="nichoId" required>
                {nichos.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Padrão" erro={campos.padrao} htmlFor="m-padrao">
              <Input id="m-padrao" name="padrao" required placeholder="lista negativa" />
            </Campo>
          </div>
          <Campo rotulo="Gancho" erro={campos.gancho} htmlFor="m-gancho">
            <Input id="m-gancho" name="gancho" required placeholder="Ninguém te conta que…" />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Fonte" erro={campos.fonte} htmlFor="m-fonte">
              <Input id="m-fonte" name="fonte" required placeholder="link ou origem" />
            </Campo>
            <Campo rotulo="Views do original" erro={campos.performance} htmlFor="m-perf">
              <Input id="m-perf" name="performance" type="number" min={0} />
            </Campo>
          </div>
          <Campo rotulo="Mecanismo de retenção" htmlFor="m-ret">
            <Input id="m-ret" name="retention" placeholder="lista prometida de 3 itens" />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Loop" htmlFor="m-loop">
              <Input id="m-loop" name="loop" placeholder="o fim retoma o gancho" />
            </Campo>
            <Campo rotulo="CTA" htmlFor="m-cta">
              <Input id="m-cta" name="cta" placeholder="salvar para a próxima queda" />
            </Campo>
          </div>
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
