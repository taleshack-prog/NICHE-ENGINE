"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock, FileText, Image as ImageIcon, MessageSquare, Plus } from "lucide-react";
import { createPost, moverPost } from "@/actions/posts";
import { Botao } from "@/components/ui/botao";
import { Campo, Input, Selecao } from "@/components/ui/campos";
import { Modal, ModalConteudo, ModalGatilho } from "@/components/ui/modal";
import { Selo, TOM_STATUS } from "@/components/ui/selo";
import { useAcao } from "@/components/ui/use-acao";
import {
  FORMATOS,
  FORMATO_LABEL,
  POST_STATUS,
  POST_STATUS_LABEL,
  type Formato,
  type PostStatus,
} from "@/lib/domain";
import type { PostProducao } from "@/lib/queries";
import { cn, fmtDataHora } from "@/lib/utils";
import { EditorPost } from "./editor-post";

type NichoOpcao = { id: string; nome: string; subNicho: string | null };
type TemplateOpcao = { id: string; padrao: string; gancho: string; nichoId: string };

export function Kanban({
  posts,
  nichos,
  templates,
  iaDisponivel,
  falDisponivel,
  metaDisponivel,
}: {
  posts: PostProducao[];
  nichos: NichoOpcao[];
  templates: TemplateOpcao[];
  iaDisponivel: boolean;
  falDisponivel: boolean;
  metaDisponivel: boolean;
}) {
  const router = useRouter();
  const { executar } = useAcao();
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [colunaAlvo, setColunaAlvo] = React.useState<PostStatus | null>(null);
  const [abertoId, setAbertoId] = React.useState<string | null>(null);

  const postAberto = posts.find((p) => p.id === abertoId) ?? null;

  async function soltar(status: PostStatus) {
    const id = arrastando;
    setArrastando(null);
    setColunaAlvo(null);
    if (!id) return;

    const post = posts.find((p) => p.id === id);
    if (!post || post.status === status) return;

    await executar(() => moverPost({ id, status }), {
      aoConcluir: () => router.refresh(),
    });
  }

  return (
    <>
      <div className="mb-4">
        <NovoPost nichos={nichos} templates={templates} aoSalvar={() => router.refresh()} />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        {POST_STATUS.map((status) => {
          const daColuna = posts.filter((p) => p.status === status);
          return (
            <section
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setColunaAlvo(status);
              }}
              onDragLeave={() => setColunaAlvo((c) => (c === status ? null : c))}
              onDrop={() => soltar(status)}
              className={cn(
                "flex min-h-40 flex-col rounded-xl border border-borda bg-superficie/60 p-2",
                colunaAlvo === status && "drop-ativo",
              )}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-suave">
                  {POST_STATUS_LABEL[status]}
                </h2>
                <span className="text-[11px] tabular-nums text-tenue">{daColuna.length}</span>
              </header>

              <div className="flex-1 space-y-2">
                {daColuna.map((p) => (
                  <article
                    key={p.id}
                    draggable
                    onDragStart={() => setArrastando(p.id)}
                    onDragEnd={() => setArrastando(null)}
                    onClick={() => setAbertoId(p.id)}
                    className={cn(
                      "cursor-pointer rounded-lg border border-borda bg-superficie p-3 transition-colors hover:border-acento/50",
                      arrastando === p.id && "arrastando",
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{p.titulo}</p>
                      <Selo tom={TOM_STATUS[p.status] ?? "neutro"}>
                        {FORMATO_LABEL[p.formato as Formato] ?? p.formato}
                      </Selo>
                    </div>

                    <p className="mb-2 truncate text-[11px] text-tenue">
                      {p.nicho}
                      {p.padrao ? ` · ${p.padrao}` : ""}
                    </p>

                    <div className="flex items-center gap-2.5 text-[11px] text-tenue">
                      <span
                        className={cn("flex items-center gap-1", p.temRoteiro && "text-ok")}
                        title="Roteiro"
                      >
                        <FileText className="size-3" />
                        {p.temRoteiro ? "ok" : "—"}
                      </span>
                      <span
                        className={cn("flex items-center gap-1", p.temLegenda && "text-ok")}
                        title="Legenda"
                      >
                        <MessageSquare className="size-3" />
                        {p.temLegenda ? "ok" : "—"}
                      </span>
                      <span
                        className={cn("flex items-center gap-1", p.qtdMidia > 0 && "text-ok")}
                        title="Mídia"
                      >
                        <ImageIcon className="size-3" />
                        {p.qtdMidia}
                      </span>
                    </div>

                    {p.agendadoPara ? (
                      <p className="mt-2 flex items-center gap-1 text-[11px] text-roxo">
                        <Clock className="size-3" />
                        {fmtDataHora(p.agendadoPara)}
                      </p>
                    ) : null}

                    {p.erroPublicacao ? (
                      <p className="mt-2 line-clamp-2 rounded border border-erro/30 bg-erro/10 px-1.5 py-1 text-[10px] text-erro">
                        {p.erroPublicacao}
                      </p>
                    ) : null}
                  </article>
                ))}

                {daColuna.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[11px] text-tenue">vazio</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-tenue">
        Arraste os cards entre as colunas. Mover para <strong>Agendado</strong> exige data
        definida — a fila de publicação ignora post agendado sem data.
      </p>

      {postAberto ? (
        <EditorPost
          post={postAberto}
          templates={templates.filter((t) => t.nichoId === postAberto.nichoId)}
          iaDisponivel={iaDisponivel}
          falDisponivel={falDisponivel}
          metaDisponivel={metaDisponivel}
          aoFechar={() => setAbertoId(null)}
          aoAtualizar={() => router.refresh()}
        />
      ) : null}
    </>
  );
}

function NovoPost({
  nichos,
  templates,
  aoSalvar,
}: {
  nichos: NichoOpcao[];
  templates: TemplateOpcao[];
  aoSalvar: () => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [nichoId, setNichoId] = React.useState(nichos[0]?.id ?? "");
  const { carregando, campos, executar } = useAcao();

  const templatesDoNicho = templates.filter((t) => t.nichoId === nichoId);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await executar(
      () =>
        createPost({
          nichoId: fd.get("nichoId"),
          templateId: fd.get("templateId") || undefined,
          titulo: fd.get("titulo"),
          formato: fd.get("formato"),
        }),
      { sucesso: "Post criado como rascunho." },
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
          <Plus />
          Novo post
        </Botao>
      </ModalGatilho>
      <ModalConteudo titulo="Novo post" descricao="Entra no kanban como rascunho.">
        <form onSubmit={enviar} className="space-y-3">
          <Campo rotulo="Título de trabalho" erro={campos.titulo} htmlFor="p-titulo">
            <Input
              id="p-titulo"
              name="titulo"
              required
              placeholder="3 erros que fazem iniciante perder dinheiro"
            />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nicho" erro={campos.nichoId} htmlFor="p-nicho">
              <Selecao
                id="p-nicho"
                name="nichoId"
                required
                value={nichoId}
                onChange={(e) => setNichoId(e.target.value)}
              >
                {nichos.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Formato" erro={campos.formato} htmlFor="p-formato">
              <Selecao id="p-formato" name="formato" required defaultValue="reel">
                {FORMATOS.map((f) => (
                  <option key={f} value={f}>
                    {FORMATO_LABEL[f]}
                  </option>
                ))}
              </Selecao>
            </Campo>
          </div>
          <Campo
            rotulo="Template do swipe file"
            htmlFor="p-template"
            dica="Opcional, mas é o que liga o post ao padrão no relatório semanal."
          >
            <Selecao id="p-template" name="templateId" defaultValue="">
              <option value="">Sem template</option>
              {templatesDoNicho.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.padrao} — {t.gancho.slice(0, 50)}
                </option>
              ))}
            </Selecao>
          </Campo>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="primario" disabled={carregando}>
              {carregando ? "Criando…" : "Criar"}
            </Botao>
          </div>
        </form>
      </ModalConteudo>
    </Modal>
  );
}
