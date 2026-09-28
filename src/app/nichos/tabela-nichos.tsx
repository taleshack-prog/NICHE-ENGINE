"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createNicho,
  deleteNicho,
  promptAnaliseNicho,
  scoreNichos,
  updateNicho,
} from "@/actions/nichos";
import { Botao } from "@/components/ui/botao";
import { Campo, Input, Selecao } from "@/components/ui/campos";
import { Modal, ModalConteudo, ModalGatilho } from "@/components/ui/modal";
import { Selo } from "@/components/ui/selo";
import { TCabecalho, TCorpo, TD, TH, TLinha, Tabela, Vazio } from "@/components/ui/tabela";
import { useAcao } from "@/components/ui/use-acao";
import { NICHO_STATUS, NICHO_STATUS_LABEL, type NichoStatus } from "@/lib/domain";
import { faixaScore } from "@/lib/scoring";

export type NichoLinha = {
  id: string;
  nome: string;
  subNicho: string | null;
  cpmEstimado: number | null;
  demandaPerene: number | null;
  concorrencia: number | null;
  score: number | null;
  status: string;
  persona: string | null;
  _count: { posts: number; templates: number };
};

const TOM_FAIXA = { alto: "ok", medio: "alerta", baixo: "erro", indefinido: "neutro" } as const;

export function TabelaNichos({ nichos }: { nichos: NichoLinha[] }) {
  const router = useRouter();
  const { carregando, executar } = useAcao();

  async function mudarStatus(id: string, status: NichoStatus) {
    await executar(() => updateNicho({ id, status }), {
      sucesso: `Nicho marcado como ${NICHO_STATUS_LABEL[status].toLowerCase()}.`,
      aoConcluir: () => router.refresh(),
    });
  }

  async function recalcular() {
    await executar(() => scoreNichos(), { aoConcluir: () => router.refresh() });
  }

  async function copiarPrompt(id: string) {
    const r = await promptAnaliseNicho({ id });
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    try {
      await navigator.clipboard.writeText(r.data);
      toast.success("Prompt de análise copiado — cole no Claude.");
    } catch {
      // clipboard exige contexto seguro (https ou localhost)
      toast.error("Não foi possível acessar a área de transferência deste contexto.");
    }
  }

  async function remover(id: string, nome: string) {
    if (
      !window.confirm(
        `Excluir "${nome}"? Isso apaga também os templates e posts vinculados. Ação irreversível.`,
      )
    ) {
      return;
    }
    await executar(() => deleteNicho({ id }), {
      sucesso: "Nicho excluído.",
      aoConcluir: () => router.refresh(),
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FormularioNicho aoSalvar={() => router.refresh()} />
        <Botao variante="contorno" onClick={recalcular} disabled={carregando}>
          <RefreshCw className={carregando ? "animate-spin" : ""} />
          Recalcular scores
        </Botao>
      </div>

      <div className="rounded-xl border border-borda bg-superficie">
        <Tabela>
          <TCabecalho>
            <TLinha>
              <TH>Nicho</TH>
              <TH className="w-20 text-right">Demanda</TH>
              <TH className="w-24 text-right">Concorr.</TH>
              <TH className="w-20 text-right">CPM</TH>
              <TH className="w-20 text-right">Score</TH>
              <TH className="w-28">Status</TH>
              <TH className="w-24 text-right">Conteúdo</TH>
              <TH className="w-px" />
            </TLinha>
          </TCabecalho>
          <TCorpo>
            {nichos.length === 0 ? (
              <Vazio colSpan={8}>
                Nenhum nicho cadastrado. Comece adicionando 3 a 5 candidatos e comparando o
                score.
              </Vazio>
            ) : (
              nichos.map((n) => (
                <TLinha key={n.id}>
                  <TD>
                    <p className="font-medium">{n.nome}</p>
                    {n.subNicho ? (
                      <p className="text-[11px] text-tenue">{n.subNicho}</p>
                    ) : null}
                    {n.persona ? (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-tenue">
                        persona: {n.persona}
                      </p>
                    ) : null}
                  </TD>
                  <TD className="text-right tabular-nums">{n.demandaPerene ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{n.concorrencia ?? "—"}</TD>
                  <TD className="text-right tabular-nums">
                    {n.cpmEstimado !== null ? `$${n.cpmEstimado.toFixed(1)}` : "—"}
                  </TD>
                  <TD className="text-right">
                    <Selo tom={TOM_FAIXA[faixaScore(n.score)]}>
                      {n.score !== null ? n.score.toFixed(1) : "—"}
                    </Selo>
                  </TD>
                  <TD>
                    <Selecao
                      aria-label={`Status de ${n.nome}`}
                      value={n.status}
                      disabled={carregando}
                      onChange={(e) => mudarStatus(n.id, e.target.value as NichoStatus)}
                      className="h-7 text-xs"
                    >
                      {NICHO_STATUS.map((s) => (
                        <option key={s} value={s}>
                          {NICHO_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </Selecao>
                  </TD>
                  <TD className="text-right text-xs text-tenue tabular-nums">
                    {n._count.posts}p · {n._count.templates}t
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      <FormularioNicho nicho={n} aoSalvar={() => router.refresh()} />
                      <Botao
                        variante="fantasma"
                        tamanho="icone"
                        title="Copiar prompt de análise com IA"
                        onClick={() => copiarPrompt(n.id)}
                      >
                        <Sparkles />
                      </Botao>
                      <Botao
                        variante="fantasma"
                        tamanho="icone"
                        title="Excluir nicho"
                        onClick={() => remover(n.id, n.nome)}
                      >
                        <Trash2 />
                      </Botao>
                    </div>
                  </TD>
                </TLinha>
              ))
            )}
          </TCorpo>
        </Tabela>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-tenue">
        <Copy className="size-3" />
        Score = demanda × 2 − concorrência + CPM ÷ 5. O botão de IA copia o prompt de análise
        para você colar no Claude e devolver os números.
      </p>
    </>
  );
}

/**
 * Cria OU edita um nicho — o mesmo formulário, porque os campos são os mesmos.
 *
 * A tela só tinha criação: para corrigir uma persona mal escrita ou uma nota de
 * concorrência otimista, a única saída era excluir e recriar. Com cascade no
 * schema, excluir um nicho leva junto templates e posts — ou seja, o caminho
 * disponível para consertar um TEXTO destruía o histórico.
 */
function FormularioNicho({
  aoSalvar,
  nicho,
}: {
  aoSalvar: () => void;
  nicho?: NichoLinha;
}) {
  const [aberto, setAberto] = React.useState(false);
  const { carregando, campos, executar } = useAcao();
  const editando = nicho !== undefined;

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Campo vazio vira undefined, que o updateNicho interpreta como "mantém o
    // atual". Limpar um campo não é possível por aqui de propósito: apagar
    // persona sem querer é mais provável que querer apagá-la.
    const entrada = {
      nome: fd.get("nome"),
      subNicho: fd.get("subNicho") || undefined,
      cpmEstimado: fd.get("cpmEstimado") || undefined,
      demandaPerene: fd.get("demandaPerene") || undefined,
      concorrencia: fd.get("concorrencia") || undefined,
      persona: fd.get("persona") || undefined,
    };
    const r = editando
      ? await executar(() => updateNicho({ id: nicho.id, ...entrada }), {
          sucesso: "Nicho atualizado — score recalculado.",
        })
      : await executar(() => createNicho(entrada), { sucesso: "Nicho criado." });
    if (r) {
      setAberto(false);
      aoSalvar();
    }
  }

  return (
    <Modal open={aberto} onOpenChange={setAberto}>
      <ModalGatilho asChild>
        {editando ? (
          <Botao variante="fantasma" tamanho="icone" title={`Editar ${nicho.nome}`}>
            <Pencil />
          </Botao>
        ) : (
          <Botao variante="primario">
            <Plus />
            Novo nicho
          </Botao>
        )}
      </ModalGatilho>
      <ModalConteudo
        titulo={editando ? `Editar ${nicho.nome}` : "Novo nicho candidato"}
        descricao="Demanda e concorrência de 1 a 10. Alterar qualquer um dos três insumos recalcula o score na hora."
      >
        <form onSubmit={enviar} className="space-y-3">
          <Campo rotulo="Nome" erro={campos.nome} htmlFor="nome">
            <Input
              id="nome"
              name="nome"
              required
              defaultValue={nicho?.nome ?? ""}
              placeholder="Finanças e criptomoedas"
            />
          </Campo>
          <Campo rotulo="Sub-nicho" erro={campos.subNicho} htmlFor="subNicho">
            <Input
              id="subNicho"
              name="subNicho"
              defaultValue={nicho?.subNicho ?? ""}
              placeholder="erros de iniciante em cripto"
            />
          </Campo>
          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="Demanda (1-10)" erro={campos.demandaPerene} htmlFor="demandaPerene">
              <Input
                id="demandaPerene"
                name="demandaPerene"
                type="number"
                min={1}
                max={10}
                defaultValue={nicho?.demandaPerene ?? ""}
              />
            </Campo>
            <Campo rotulo="Concorrência (1-10)" erro={campos.concorrencia} htmlFor="concorrencia">
              <Input
                id="concorrencia"
                name="concorrencia"
                type="number"
                min={1}
                max={10}
                defaultValue={nicho?.concorrencia ?? ""}
              />
            </Campo>
            <Campo rotulo="CPM (USD)" erro={campos.cpmEstimado} htmlFor="cpmEstimado">
              <Input
                id="cpmEstimado"
                name="cpmEstimado"
                type="number"
                step="0.1"
                min={0}
                defaultValue={nicho?.cpmEstimado ?? ""}
              />
            </Campo>
          </div>
          <Campo
            rotulo="Persona"
            erro={campos.persona}
            htmlFor="persona"
            dica="Uma frase: quem é, idade, dor principal. Vai direto no prompt de copy."
          >
            <Input
              id="persona"
              name="persona"
              defaultValue={nicho?.persona ?? ""}
              placeholder="homem, 25-40, investe há pouco, medo de perder dinheiro"
            />
          </Campo>
          <div className="flex justify-end gap-2 pt-1">
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
