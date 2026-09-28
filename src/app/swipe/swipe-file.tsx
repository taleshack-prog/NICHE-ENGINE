"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, FlaskConical, PenLine, Plus, Sparkles, Sprout, Trash2 } from "lucide-react";
import { createPost } from "@/actions/posts";
import {
  createTemplate,
  decomposeViral,
  deleteTemplate,
  semearSwipeFile,
} from "@/actions/templates";
import { Botao } from "@/components/ui/botao";
import { AreaTexto, Campo, Input, Selecao } from "@/components/ui/campos";
import { Card, CardConteudo } from "@/components/ui/card";
import { Modal, ModalConteudo, ModalGatilho } from "@/components/ui/modal";
import { Selo } from "@/components/ui/selo";
import { useAcao } from "@/components/ui/use-acao";
import { lerEstrutura } from "@/lib/json-fields";
import { ehHipotese } from "@/lib/padroes";
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

  /**
   * Ponte do estágio 2 (recon viral) para o estágio 3 (produção).
   *
   * Sem ela o caminho era: sair do swipe file, ir em Produção, abrir "Novo
   * post", achar o template num dropdown OPCIONAL. Post criado sem template não
   * entra em nenhum agrupamento de padrão — some do relatório semanal em
   * silêncio. Deixar o vínculo por conta de um campo opcional num outro lugar
   * da interface era convidar exatamente esse esquecimento.
   */
  async function produzir(t: TemplateCard) {
    await executar(
      () =>
        createPost({
          titulo: t.gancho.slice(0, 120),
          nichoId: t.nichoId,
          templateId: t.id,
          formato: "reel",
        }),
      {
        sucesso: "Post criado e vinculado ao template.",
        aoConcluir: () => router.push("/producao"),
      },
    );
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
        <FormularioSemeadura
          nichos={nichos}
          iaDisponivel={iaDisponivel}
          nichoPadrao={filtroNicho || undefined}
          aoSalvar={() => router.refresh()}
        />

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
              <FiltroSemResultado
                templates={templates}
                nichos={nichos}
                filtroNicho={filtroNicho}
                filtroPadrao={filtroPadrao}
                aoFiltrarNicho={setFiltroNicho}
                aoLimpar={() => {
                  setFiltroNicho("");
                  setFiltroPadrao("");
                }}
              />
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Selo tom="acento">{t.padrao}</Selo>
                      {ehHipotese(t.fonte) ? (
                        <Selo tom="alerta">
                          <FlaskConical className="mr-1 size-3" />
                          hipótese
                        </Selo>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Criar post a partir deste template"
                        disabled={carregando}
                        onClick={() => produzir(t)}
                        className="rounded p-1 text-tenue hover:bg-superficie-2 hover:text-acento"
                      >
                        <PenLine className="size-3.5" />
                      </button>
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

/**
 * Estado vazio que diz ONDE o conteúdo está, não só que aqui não tem.
 *
 * "Nenhum template com esses filtros" é verdade e é inútil: quem filtrou por um
 * nicho e não achou nada fica sem saber se o template não existe, se está em
 * outro nicho, ou se o filtro quebrou. Mostrar a distribuição responde as três
 * de uma vez — e os nichos viram atalho, porque quem lê "Finanças (7)" quer
 * justamente ir para lá.
 */
function FiltroSemResultado({
  templates,
  nichos,
  filtroNicho,
  filtroPadrao,
  aoFiltrarNicho,
  aoLimpar,
}: {
  templates: TemplateCard[];
  nichos: NichoOpcao[];
  filtroNicho: string;
  filtroPadrao: string;
  aoFiltrarNicho: (id: string) => void;
  aoLimpar: () => void;
}) {
  const nomeNicho = nichos.find((n) => n.id === filtroNicho)?.nome ?? null;

  // Distribuição sempre sobre o TOTAL, não sobre o filtrado: o ponto é mostrar
  // o que existe fora do recorte atual.
  const porNicho = new Map<string, { nome: string; qtd: number }>();
  for (const t of templates) {
    const atual = porNicho.get(t.nichoId);
    porNicho.set(t.nichoId, { nome: t.nicho.nome, qtd: (atual?.qtd ?? 0) + 1 });
  }
  const distribuicao = [...porNicho.entries()].sort((a, b) => b[1].qtd - a[1].qtd);

  const padroesNoNicho = [
    ...new Set(
      templates.filter((t) => !filtroNicho || t.nichoId === filtroNicho).map((t) => t.padrao),
    ),
  ].sort();

  return (
    <div className="space-y-3">
      <p>
        Nenhum template
        {nomeNicho ? (
          <>
            {" "}
            em <strong className="text-texto">{nomeNicho}</strong>
          </>
        ) : null}
        {filtroPadrao ? (
          <>
            {" "}
            com padrão <strong className="text-texto">{filtroPadrao}</strong>
          </>
        ) : null}
        .
      </p>

      <p className="text-xs">
        {templates.length} template(s) no swipe file, distribuídos assim:
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {distribuicao.map(([id, { nome, qtd }]) => (
          <button
            key={id}
            type="button"
            onClick={() => aoFiltrarNicho(id)}
            className="rounded-md border border-borda px-2 py-1 text-xs text-suave transition-colors hover:border-acento hover:text-acento"
          >
            {nome} ({qtd})
          </button>
        ))}
      </div>

      {filtroPadrao && padroesNoNicho.length > 0 ? (
        <p className="text-xs">
          Padrões disponíveis{nomeNicho ? ` em ${nomeNicho}` : ""}: {padroesNoNicho.join(", ")}.
        </p>
      ) : null}

      <button
        type="button"
        onClick={aoLimpar}
        className="text-xs text-acento underline-offset-2 hover:underline"
      >
        Limpar filtros
      </button>
    </div>
  );
}

/**
 * Semeadura do swipe file: resolve a partida a frio de um nicho novo.
 *
 * O nicho vem pré-selecionado pelo filtro ativo, porque quem clica aqui quase
 * sempre acabou de ver "Nenhum template em X".
 */
function FormularioSemeadura({
  nichos,
  iaDisponivel,
  aoSalvar,
  nichoPadrao,
}: {
  nichos: NichoOpcao[];
  iaDisponivel: boolean;
  aoSalvar: () => void;
  nichoPadrao?: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const { carregando, campos, executar } = useAcao();

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await executar(
      () =>
        semearSwipeFile({
          nichoId: fd.get("nichoId"),
          quantidade: fd.get("quantidade"),
        }),
      { sucesso: "Swipe file semeado." },
    );
    if (r) {
      toast.message(`${r.criados} hipótese(s): ${r.padroes.join(", ")}`);
      setAberto(false);
      aoSalvar();
    }
  }

  return (
    <Modal open={aberto} onOpenChange={setAberto}>
      <ModalGatilho asChild>
        <Botao variante="contorno" disabled={nichos.length === 0 || !iaDisponivel}>
          <Sprout />
          Semear com IA
        </Botao>
      </ModalGatilho>
      <ModalConteudo
        titulo="Semear swipe file"
        descricao="Para nicho novo, sem virais decompostos ainda. A IA propõe mecanismos de gancho a partir da persona do nicho."
      >
        <form onSubmit={enviar} className="space-y-3">
          <div className="rounded-md border border-alerta/40 bg-alerta/10 p-3 text-xs text-alerta">
            O que sai daqui é <strong>hipótese</strong>, não viral comprovado — fica marcado como
            tal no card. Serve para destravar a produção: você publica, mede, e o relatório semanal
            diz quais se sustentam. Os que vencerem viram template de verdade pelo botão
            &ldquo;promover a template&rdquo; em Analytics.
          </div>
          <Campo rotulo="Nicho" erro={campos.nichoId} htmlFor="s-nicho">
            <Selecao id="s-nicho" name="nichoId" required defaultValue={nichoPadrao ?? ""}>
              <option value="" disabled>
                Selecione…
              </option>
              {nichos.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nome}
                  {n.subNicho ? ` · ${n.subNicho}` : ""}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo
            rotulo="Quantos padrões"
            erro={campos.quantidade}
            htmlFor="s-qtd"
            dica="A geração de roteiro exige 3 padrões distintos. 4 dá folga para a rotação."
          >
            <Input id="s-qtd" name="quantidade" type="number" min={3} max={6} defaultValue={4} />
          </Campo>
          <div className="flex justify-end gap-2 pt-1">
            <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="primario" disabled={carregando}>
              {carregando ? "Gerando…" : "Semear"}
            </Botao>
          </div>
        </form>
      </ModalConteudo>
    </Modal>
  );
}
