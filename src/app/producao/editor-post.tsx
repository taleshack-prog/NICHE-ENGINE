"use client";

import * as React from "react";
import {
  CalendarClock,
  Download,
  Film,
  Clapperboard,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  Send,
  Sparkles,
  Trash2,
  Type,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  agendarPost,
  aplicarRoteiro,
  deletePost,
  gerarCopy,
  gerarRoteiro,
  publicarPost,
  updatePost,
} from "@/actions/posts";
import {
  anexarMidiaUrl,
  gerarCapa,
  gerarCarrossel,
  gerarMidia,
  removerMidia,
} from "@/actions/midia";
import { gerarReel, limparEtapasReel, refazerLegenda } from "@/actions/reel";
import { Botao } from "@/components/ui/botao";
import { AreaTexto, Campo, Input, Selecao } from "@/components/ui/campos";
import { Selo } from "@/components/ui/selo";
import { useAcao } from "@/components/ui/use-acao";
import { FORMATOS, FORMATO_LABEL, type Formato } from "@/lib/domain";
import type { VariacaoRoteiro } from "@/lib/prompts";
import type { PostProducao } from "@/lib/queries";
import { contarPalavras } from "@/lib/utils";

type TemplateOpcao = { id: string; padrao: string; gancho: string };

export function EditorPost({
  post,
  templates,
  iaDisponivel,
  falDisponivel,
  metaDisponivel,
  aoFechar,
  aoAtualizar,
}: {
  post: PostProducao;
  templates: TemplateOpcao[];
  iaDisponivel: boolean;
  falDisponivel: boolean;
  metaDisponivel: boolean;
  aoFechar: () => void;
  aoAtualizar: () => void;
}) {
  const [titulo, setTitulo] = React.useState(post.titulo);
  const [formato, setFormato] = React.useState(post.formato);
  const [roteiro, setRoteiro] = React.useState(post.roteiro ?? "");
  const [legenda, setLegenda] = React.useState(post.legenda ?? "");
  const [coverText, setCoverText] = React.useState(post.coverText ?? "");
  const [hashtags, setHashtags] = React.useState(post.hashtagsLista.join(" "));
  const [templateId, setTemplateId] = React.useState(post.templateId ?? "");
  const [variacoes, setVariacoes] = React.useState<VariacaoRoteiro[] | null>(null);
  const [tema, setTema] = React.useState(post.titulo);
  const [corpoLegenda, setCorpoLegenda] = React.useState(44);

  const salvar = useAcao();
  const ia = useAcao();
  const midia = useAcao();
  const publicacao = useAcao();

  // Esc fecha o painel — atalho esperado num editor lateral.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aoFechar]);

  const primeiraLinhaLegenda = legenda.split("\n")[0] ?? "";
  const palavrasReGancho = contarPalavras(primeiraLinhaLegenda);
  const qtdHashtags = hashtags.split(/[\s,]+/).filter(Boolean).length;
  const palavrasCover = contarPalavras(coverText);
  const temImagem = post.midiaLista.some((m) => m.tipo === "imagem");
  const capa = post.midiaLista.find((m) => m.papel === "capa");
  const reelPronto = post.midiaLista.find((m) => m.papel === "final");
  const clipesFeitos = post.midiaLista.filter((m) => m.papel === "clipe").length;
  /**
   * A grade mostrava narração, 8 cenas e 8 clipes ao lado do Reel pronto. São
   * artefatos intermediários, guardados para a retomada — mas na tela pareciam
   * o resultado, e o resultado parecia só mais um item. Oficina recolhida,
   * entregável na frente.
   */
  const ETAPAS = new Set(["narracao", "cena", "clipe"]);
  const entregaveis = post.midiaLista.filter((m) => !ETAPAS.has(m.papel ?? ""));
  const etapas = post.midiaLista.filter((m) => ETAPAS.has(m.papel ?? ""));
  const cenasFeitas = post.midiaLista.filter((m) => m.papel === "cena").length;
  const slides = post.midiaLista.filter((m) => m.papel === "capa" || m.papel === "slide").length;

  const campos = () => ({
    id: post.id,
    titulo,
    formato,
    roteiro: roteiro || null,
    legenda: legenda || null,
    coverText: coverText || null,
    hashtags,
    templateId: templateId || null,
  });

  async function salvarCampos() {
    await salvar.executar(() => updatePost(campos()), {
      sucesso: "Post salvo.",
      aoConcluir: aoAtualizar,
    });
  }

  /**
   * Grava o que está na tela antes de uma ação que lê do banco.
   *
   * POR QUE ISTO EXISTE: os botões de geração decidem se estão habilitados
   * olhando o `formato` do FORMULÁRIO, e as Server Actions decidem se aceitam
   * olhando o `formato` do BANCO. Trocar o select sem salvar deixava os dois em
   * desacordo — o botão Reel ficava clicável e respondia "este post não é
   * Reel", com a tela mostrando Reel. Pedir ao usuário que lembre de salvar é
   * transferir para ele um problema que é do código.
   */
  async function garantirSalvo(): Promise<boolean> {
    const r = await salvar.executar(() => updatePost(campos()), { aoConcluir: aoAtualizar });
    return r !== null;
  }

  async function gerar() {
    const r = await ia.executar(() => gerarRoteiro({ postId: post.id, tema }));
    if (r && typeof r === "object" && "variacoes" in r) {
      setVariacoes((r as { variacoes: VariacaoRoteiro[] }).variacoes);
      toast.success("3 variações geradas. Escolha uma.");
    }
  }

  async function usarVariacao(v: VariacaoRoteiro) {
    await ia.executar(
      () =>
        aplicarRoteiro({
          postId: post.id,
          gancho: v.gancho,
          corpo: v.corpo,
          loop: v.loop,
          cta: v.cta,
        }),
      { sucesso: "Roteiro aplicado." },
    );
    setRoteiro([v.gancho, "", v.corpo, "", v.loop, "", v.cta].join("\n"));
    setVariacoes(null);
    aoAtualizar();
  }

  async function copy() {
    const r = await ia.executar(() => gerarCopy({ postId: post.id }), {
      sucesso: "Copy gerada.",
    });
    if (r && typeof r === "object" && "legenda" in r) {
      const c = r as { legenda: string; hashtags: string[]; coverText: string };
      setLegenda(c.legenda);
      setHashtags(c.hashtags.join(" "));
      setCoverText(c.coverText);
      aoAtualizar();
    }
  }

  /**
   * Cadeia completa do Reel. O confirm existe porque é a ação mais cara do
   * sistema — e porque ela demora minutos: sem aviso, o usuário fecha o editor
   * no meio achando que travou.
   */
  async function reel() {
    const retomando = cenasFeitas > 0 || clipesFeitos > 0;
    const aviso = retomando
      ? `Retomando: ${cenasFeitas} cenas e ${clipesFeitos} clipes já prontos serão reaproveitados. Continuar?`
      : "Gera narração, cenas, clipes, montagem e legenda. Leva alguns minutos e custa cerca de US$ 0,35 por 5 s de vídeo. Continuar?";
    if (!window.confirm(aviso)) return;

    if (!(await garantirSalvo())) return;

    toast.info("Produzindo o Reel. Cada etapa é salva — se o navegador cair, clique de novo e ele continua.");
    const r = await midia.executar(() => gerarReel({ postId: post.id }), {
      aoConcluir: aoAtualizar,
    });
    if (r && typeof r === "object" && "videoUrl" in r) {
      const d = r as { clipes: number; duracaoSeg: number; custoEstimadoUsd: number };
      toast.success(
        `Reel pronto: ${d.duracaoSeg}s, ${d.clipes} cortes, narrado e legendado (~US$ ${d.custoEstimadoUsd}).`,
      );
    }
  }

  /** Remonta e relegenda com outro corpo de fonte. Não chama o Kling. */
  async function ajustarLegenda() {
    toast.info("Remontando e relegendando — só as etapas baratas, sem gerar clipe novo.");
    await midia.executar(() => refazerLegenda({ postId: post.id, corpo: corpoLegenda }), {
      sucesso: `Legenda refeita com corpo ${corpoLegenda}.`,
      aoConcluir: aoAtualizar,
    });
  }

  /** Descarta narração, cenas e clipes para refazer do zero com outro roteiro. */
  async function refazerReel() {
    if (!window.confirm("Descartar narração, cenas e clipes e refazer do zero? O que já foi gerado não volta.")) return;
    await midia.executar(() => limparEtapasReel({ postId: post.id, tudo: true }), {
      sucesso: "Etapas descartadas. Clique em Reel para gerar de novo.",
      aoConcluir: aoAtualizar,
    });
  }

  async function gerarImagem() {
    const r = await midia.executar(() => gerarMidia({ postId: post.id, tipo: "imagem" }), {
      aoConcluir: aoAtualizar,
    });
    if (!r || typeof r !== "object") return;
    const d = r as { adicionados: number; capa: string | null; capaErro?: string };
    if (d.capa) {
      toast.success(`${d.adicionados} imagens. A primeira já saiu com o texto de capa.`);
    } else if (d.capaErro) {
      toast.warning(`Imagens anexadas, mas a capa falhou: ${d.capaErro}`);
    } else {
      toast.success(`${d.adicionados} imagens anexadas.`);
    }
  }

  /** Queima o cover text na imagem (ou troca qual imagem serve de fundo). */
  async function aplicarCapa(imagemUrl?: string) {
    await midia.executar(() => gerarCapa({ postId: post.id, imagemUrl }), {
      sucesso: "Capa gerada — a imagem com texto é a primeira da lista.",
      aoConcluir: aoAtualizar,
    });
  }

  /** slug-do-titulo-01.jpg — nome ordenável, porque o hash do arquivo não é. */
  function nomeArquivo(ordem: number): string {
    const slug =
      titulo
        .slice(0, 40)
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() || "post";
    return `${slug}-${String(ordem).padStart(2, "0")}.jpg`;
  }

  /**
   * Baixa os slides na ordem. Downloads em sequência com respiro entre eles:
   * disparar seis cliques no mesmo tick faz o Chrome engolir todos menos o
   * primeiro.
   */
  async function baixarTudo() {
    const prontos = post.midiaLista
      .filter((m) => m.papel)
      .sort((a, b) => (a.ordem ?? 1) - (b.ordem ?? 1));
    for (const m of prontos) {
      const a = document.createElement("a");
      a.href = m.url;
      a.download = nomeArquivo(m.ordem ?? 1);
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 350));
    }
    toast.success(`${prontos.length} imagens baixadas, numeradas na ordem.`);
  }

  /** Roteiro → 5-8 slides com texto próprio, num clique. */
  async function carrossel() {
    if (
      !window.confirm(
        "Gerar o carrossel inteiro? Isso substitui as imagens atuais e gera uma imagem por slide (5 a 8 chamadas pagas no fal.ai).",
      )
    ) {
      return;
    }
    if (!(await garantirSalvo())) return;

    toast.info("Quebrando o roteiro em slides e gerando as imagens — leva ~1 min.");
    const r = await midia.executar(() => gerarCarrossel({ postId: post.id }), {
      aoConcluir: aoAtualizar,
    });
    if (r && typeof r === "object" && "slides" in r) {
      toast.success(`Carrossel de ${(r as { slides: number }).slides} slides, todos com texto.`);
    }
  }

  async function gerarVideoClique() {
    toast.info("Vídeo passa por fila do fal.ai — pode levar alguns minutos.");
    await midia.executar(() => gerarMidia({ postId: post.id, tipo: "video" }), {
      sucesso: "Vídeo anexado.",
      aoConcluir: aoAtualizar,
    });
  }

  async function anexarUrl(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await midia.executar(
      () =>
        anexarMidiaUrl({
          postId: post.id,
          tipo: fd.get("tipo"),
          url: fd.get("url"),
        }),
      { sucesso: "Mídia anexada.", aoConcluir: aoAtualizar },
    );
    e.currentTarget.reset();
  }

  async function agendar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const valor = String(fd.get("data") ?? "");
    if (!valor) return;
    await salvar.executar(() => agendarPost({ id: post.id, data: valor }), {
      sucesso: "Post agendado.",
      aoConcluir: aoAtualizar,
    });
  }

  async function publicar() {
    if (!window.confirm("Publicar agora no Instagram via Graph API?")) return;
    await publicacao.executar(() => publicarPost({ id: post.id }), {
      sucesso: "Publicado.",
      aoConcluir: aoAtualizar,
    });
  }

  async function excluir() {
    if (!window.confirm(`Excluir o post "${post.titulo}"? Ação irreversível.`)) return;
    const r = await salvar.executar(() => deletePost({ id: post.id }), {
      sucesso: "Post excluído.",
    });
    if (r !== null) {
      aoFechar();
      aoAtualizar();
    }
  }

  const ocupado = salvar.carregando || ia.carregando || midia.carregando || publicacao.carregando;

  return (
    <>
      <div
        role="presentation"
        onClick={aoFechar}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
      />
      <aside
        aria-label={`Editor do post ${post.titulo}`}
        className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-xl flex-col border-l border-borda bg-superficie shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-borda p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{post.titulo}</p>
            <p className="mt-0.5 text-[11px] text-tenue">
              {post.nicho} · {post.status}
              {post.igPostId ? ` · IG ${post.igPostId}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar editor"
            className="rounded-md p-1 text-tenue hover:bg-superficie-2 hover:text-texto"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* ── Identificação ── */}
          <section className="space-y-3">
            <Campo rotulo="Título" htmlFor="e-titulo">
              <Input id="e-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Formato" htmlFor="e-formato">
                <Selecao
                  id="e-formato"
                  value={formato}
                  onChange={(e) => setFormato(e.target.value)}
                >
                  {FORMATOS.map((f) => (
                    <option key={f} value={f}>
                      {FORMATO_LABEL[f as Formato]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Template" htmlFor="e-template">
                <Selecao
                  id="e-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">Sem template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.padrao}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </div>
          </section>

          {/* ── Roteiro ── */}
          <section className="space-y-2 border-t border-borda pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-suave">
                Roteiro
              </h3>
              <span className="text-[11px] text-tenue">
                gancho → corpo → loop → CTA
              </span>
            </div>

            <div className="flex gap-2">
              <Input
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                placeholder="tema para a IA"
                className="h-8 text-xs"
              />
              <Botao
                variante="contorno"
                tamanho="sm"
                onClick={gerar}
                disabled={ocupado || !iaDisponivel}
                title={iaDisponivel ? "Gerar 3 variações" : "ANTHROPIC_API_KEY ausente"}
              >
                <Wand2 />
                {ia.carregando ? "Gerando…" : "3 variações"}
              </Botao>
            </div>

            {variacoes ? (
              <ul className="space-y-2">
                {variacoes.map((v, i) => (
                  <li
                    key={`${v.templateUsado}-${i}`}
                    className="rounded-lg border border-borda bg-superficie-2 p-3"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <Selo tom="acento">{v.templateUsado}</Selo>
                      <span className="text-[11px] text-tenue">
                        ~{v.duracaoEstimadaSeg}s
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-snug">{v.gancho}</p>
                    <p className="mt-1 line-clamp-3 text-[11px] text-tenue">{v.corpo}</p>
                    <Botao
                      variante="primario"
                      tamanho="sm"
                      className="mt-2"
                      onClick={() => usarVariacao(v)}
                      disabled={ocupado}
                    >
                      Usar esta
                    </Botao>
                  </li>
                ))}
              </ul>
            ) : null}

            <AreaTexto
              rows={8}
              value={roteiro}
              onChange={(e) => setRoteiro(e.target.value)}
              placeholder="Gancho na primeira linha…"
              className="font-mono text-xs"
            />
          </section>

          {/* ── Copy ── */}
          <section className="space-y-3 border-t border-borda pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-suave">Copy</h3>
              <Botao
                variante="contorno"
                tamanho="sm"
                onClick={copy}
                disabled={ocupado || !iaDisponivel}
              >
                <Sparkles />
                Gerar copy
              </Botao>
            </div>

            <Campo
              rotulo={`Legenda — re-gancho: ${palavrasReGancho}/12 palavras`}
              htmlFor="e-legenda"
              erro={palavrasReGancho > 12 ? ["A primeira linha passa de 12 palavras"] : undefined}
            >
              <AreaTexto
                id="e-legenda"
                rows={6}
                value={legenda}
                onChange={(e) => setLegenda(e.target.value)}
                placeholder="Primeira linha = re-gancho, funciona sozinha no feed"
              />
            </Campo>

            <Campo
              rotulo={`Hashtags — ${qtdHashtags} (alvo 8 a 12)`}
              htmlFor="e-hashtags"
              erro={
                qtdHashtags > 0 && (qtdHashtags < 8 || qtdHashtags > 12)
                  ? ["Fora da faixa 8-12"]
                  : undefined
              }
              dica="3 amplas · 5 de nicho · 2 long-tail. Sem #fyp, #viral, #explore."
            >
              <AreaTexto
                id="e-hashtags"
                rows={3}
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                className="font-mono text-xs"
              />
            </Campo>

            <Campo
              rotulo={`Cover text — ${palavrasCover}/6 palavras`}
              htmlFor="e-cover"
              erro={palavrasCover > 6 ? ["Passa de 6 palavras"] : undefined}
              dica="Salve o texto antes de aplicar — a capa é composta a partir do que está gravado."
            >
              <div className="flex gap-2">
                <Input
                  id="e-cover"
                  value={coverText}
                  onChange={(e) => setCoverText(e.target.value.toUpperCase())}
                  className="uppercase"
                />
                <Botao
                  variante="secundario"
                  tamanho="sm"
                  onClick={() => aplicarCapa()}
                  disabled={ocupado || !temImagem}
                  title={
                    temImagem
                      ? "Escrever este texto na imagem"
                      : "Gere ou anexe uma imagem primeiro"
                  }
                >
                  <Type />
                  Aplicar
                </Botao>
              </div>
            </Campo>
          </section>

          {/* ── Mídia ── */}
          <section className="space-y-3 border-t border-borda pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-suave">
                Mídia ({entregaveis.length})
              </h3>
              <div className="flex gap-2">
                <Botao
                  variante="primario"
                  tamanho="sm"
                  onClick={carrossel}
                  disabled={ocupado || !falDisponivel || !iaDisponivel || formato === "reel"}
                  title={
                    formato === "reel"
                      ? "Mude o formato para Carrossel"
                      : "Roteiro → slides, cada um com seu texto e sua imagem"
                  }
                >
                  <GalleryHorizontalEnd />
                  Carrossel
                </Botao>
                <Botao
                  variante="primario"
                  tamanho="sm"
                  onClick={reel}
                  disabled={ocupado || !falDisponivel || !iaDisponivel || formato !== "reel"}
                  title={
                    formato !== "reel"
                      ? "Mude o formato para Reel"
                      : "Roteiro → narração, cenas, clipes, montagem e legenda"
                  }
                >
                  <Clapperboard />
                  {midia.carregando ? "Produzindo…" : "Reel"}
                </Botao>
                <Botao
                  variante="contorno"
                  tamanho="sm"
                  onClick={gerarImagem}
                  disabled={ocupado || !falDisponivel}
                  title={falDisponivel ? "Gerar imagens (FLUX)" : "FAL_KEY ausente"}
                >
                  <ImageIcon />
                  Fal
                </Botao>
                <Botao
                  variante="contorno"
                  tamanho="sm"
                  onClick={gerarVideoClique}
                  disabled={ocupado || !falDisponivel}
                  title={falDisponivel ? "Image-to-video (Kling)" : "FAL_KEY ausente"}
                >
                  <Film />
                  Kling
                </Botao>
              </div>
            </div>

            {reelPronto ? (
              <div className="flex items-center gap-2 rounded-md border border-acento/40 bg-acento/10 px-2 py-1.5">
                <p className="flex-1 text-[11px] text-suave">
                  Reel montado, narrado e legendado. A capa vai como thumbnail na publicação.
                </p>
                <a
                  href={reelPronto.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-borda px-2 py-1 text-[11px] text-acento hover:text-texto"
                >
                  Assistir
                </a>
                <Botao variante="fantasma" tamanho="sm" onClick={refazerReel} disabled={ocupado}>
                  Refazer
                </Botao>
              </div>
            ) : null}

            {reelPronto ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-borda px-2 py-1.5">
                <label htmlFor="e-corpo" className="text-[11px] text-tenue">
                  Corpo da legenda
                </label>
                <input
                  id="e-corpo"
                  type="number"
                  min={18}
                  max={120}
                  step={2}
                  value={corpoLegenda}
                  onChange={(e) => setCorpoLegenda(Number(e.target.value))}
                  className="h-7 w-16 rounded-md border border-borda bg-superficie px-2 text-xs"
                />
                <Botao variante="secundario" tamanho="sm" onClick={ajustarLegenda} disabled={ocupado}>
                  Refazer legenda
                </Botao>
                <span className="text-[10px] text-tenue">
                  remonta e relegenda sem gerar clipe novo — nenhuma chamada paga de vídeo
                </span>
              </div>
            ) : clipesFeitos > 0 || cenasFeitas > 0 ? (
              <p className="rounded-md border border-alerta/40 bg-alerta/10 px-2 py-1.5 text-[11px] text-suave">
                Reel em produção: {cenasFeitas} cenas e {clipesFeitos} clipes prontos. Clique em{" "}
                <strong>Reel</strong> para continuar de onde parou — o que já foi gerado não é pago de novo.
              </p>
            ) : null}

            {slides > 1 ? (
              <div className="flex items-center gap-2 rounded-md border border-acento/40 bg-acento/10 px-2 py-1.5">
                <p className="flex-1 text-[11px] text-suave">
                  Carrossel de {slides} slides, todos com texto. O número no canto de cada
                  imagem é a ordem de publicação.
                </p>
                <Botao variante="secundario" tamanho="sm" onClick={baixarTudo} disabled={ocupado}>
                  <Download />
                  Baixar todos
                </Botao>
              </div>
            ) : capa ? (
              <p className="rounded-md border border-acento/40 bg-acento/10 px-2 py-1.5 text-[11px] text-suave">
                A primeira imagem já está com o texto de capa. Passe o mouse nela e use{" "}
                <Download className="inline size-3 align-[-2px]" /> para baixar pronta.
              </p>
            ) : null}

            {entregaveis.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2">
                {entregaveis.map((m) => (
                  <li
                    key={m.url}
                    className="group relative overflow-hidden rounded-md border border-borda bg-superficie-2"
                  >
                    {m.tipo === "imagem" ? (
                      /* next/image exigiria allowlist de domínios; as URLs vêm do
                         fal.ai e de onde o usuário colar. <img> é o certo aqui. */
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={m.url}
                        alt={m.tipo}
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                    ) : m.tipo === "video" ? (
                      // Sem `preload`, o navegador baixaria os 8 clipes inteiros
                      // ao abrir o editor. `metadata` traz só o primeiro quadro.
                      <video
                        src={m.url}
                        controls
                        preload="metadata"
                        className="aspect-square w-full bg-black object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center p-2">
                        <audio src={m.url} controls className="w-full" preload="metadata" />
                      </div>
                    )}
                    <span
                      className={`absolute left-1 top-1 rounded px-1 text-[9px] uppercase ${
                        m.papel
                          ? "bg-acento text-fundo font-semibold"
                          : "bg-black/70"
                      }`}
                    >
                      {m.papel === "capa"
                        ? slides > 1
                          ? `capa 1/${slides}`
                          : "capa"
                        : m.papel === "slide"
                          ? `${m.ordem ?? "?"}/${slides}`
                          : m.papel === "final"
                            ? "reel"
                            : m.papel === "narracao"
                              ? "voz"
                              : m.papel === "cena" || m.papel === "clipe"
                                ? `${m.papel} ${m.ordem ?? "?"}`
                                : m.tipo}
                    </span>
                    <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {m.papel === "capa" || m.papel === "slide" || m.papel === "final" ? (
                        <a
                          href={m.url}
                          // Nome legível e ordenável na pasta de downloads: o
                          // hash do arquivo não diz qual slide vem primeiro.
                          download={nomeArquivo(m.ordem ?? 1)}
                          aria-label="Baixar imagem pronta"
                          title="Baixar a imagem pronta"
                          className="rounded bg-black/70 p-0.5 text-acento hover:text-texto"
                        >
                          <Download className="size-3" />
                        </a>
                      ) : m.tipo === "imagem" && coverText.trim() ? (
                        <button
                          type="button"
                          aria-label="Usar esta imagem como capa"
                          title="Escrever o cover text nesta imagem"
                          disabled={ocupado}
                          onClick={() => aplicarCapa(m.url)}
                          className="rounded bg-black/70 p-0.5 text-acento hover:text-texto"
                        >
                          <Type className="size-3" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Remover mídia"
                        disabled={ocupado}
                        onClick={() =>
                          midia.executar(() => removerMidia({ postId: post.id, url: m.url }), {
                            aoConcluir: aoAtualizar,
                          })
                        }
                        className="rounded bg-black/70 p-0.5 text-erro"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-tenue">
                Sem mídia. Carrossel exige 2 a 10 imagens; Reel exige um vídeo.
              </p>
            )}

            {etapas.length > 0 ? (
              <details className="rounded-md border border-borda">
                <summary className="cursor-pointer px-2 py-1.5 text-[11px] text-tenue">
                  Etapas guardadas ({etapas.length}) — narração, cenas e clipes. Ficam aqui para a
                  retomada não repagar; não vão para o Instagram.
                </summary>
                <ul className="grid grid-cols-4 gap-2 p-2 pt-0">
                  {etapas.map((m) => (
                    <li
                      key={m.url}
                      className="relative overflow-hidden rounded border border-borda bg-superficie-2"
                    >
                      {m.tipo === "imagem" ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={m.url}
                          alt={`cena ${m.ordem ?? ""}`}
                          className="aspect-square w-full object-cover opacity-70"
                          loading="lazy"
                        />
                      ) : m.tipo === "video" ? (
                        <video
                          src={m.url}
                          controls
                          preload="none"
                          className="aspect-square w-full bg-black object-cover"
                        />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center p-1">
                          <audio src={m.url} controls className="w-full" preload="none" />
                        </div>
                      )}
                      <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] uppercase">
                        {m.papel === "narracao" ? "voz" : `${m.papel} ${m.ordem ?? ""}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <form onSubmit={anexarUrl} className="flex gap-2">
              <Selecao name="tipo" defaultValue="imagem" className="h-8 w-24 text-xs">
                <option value="imagem">Imagem</option>
                <option value="video">Vídeo</option>
              </Selecao>
              <Input
                name="url"
                type="url"
                required
                placeholder="URL pública da mídia"
                className="h-8 text-xs"
              />
              <Botao type="submit" variante="secundario" tamanho="sm" disabled={ocupado}>
                Anexar
              </Botao>
            </form>
            <p className="text-[10px] text-tenue">
              A URL precisa ser pública e estável: o Meta baixa a mídia do lado dele, e link
              assinado que expira é a causa nº 1 de container travado em processamento.
            </p>
          </section>

          {/* ── Agendamento e publicação ── */}
          <section className="space-y-3 border-t border-borda pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-suave">
              Distribuição
            </h3>

            <form onSubmit={agendar} className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <Campo rotulo="Agendar para" htmlFor="e-data">
                  <Input
                    id="e-data"
                    name="data"
                    type="datetime-local"
                    defaultValue={
                      post.agendadoPara
                        ? new Date(
                            post.agendadoPara.getTime() -
                              post.agendadoPara.getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ""
                    }
                    className="h-8 text-xs"
                  />
                </Campo>
              </div>
              <Botao type="submit" variante="secundario" tamanho="sm" disabled={ocupado}>
                <CalendarClock />
                Agendar
              </Botao>
            </form>

            <Botao
              variante="primario"
              tamanho="sm"
              onClick={publicar}
              disabled={ocupado || !metaDisponivel}
              title={
                metaDisponivel
                  ? "Publicar via Graph API"
                  : "Graph API não configurada (Fase 5) — publique pelo Meta Business Suite"
              }
              className="w-full"
            >
              <Send />
              {publicacao.carregando ? "Publicando…" : "Publicar agora"}
            </Botao>

            {!metaDisponivel ? (
              <p className="text-[10px] text-tenue">
                Fase 5 pendente. Publique manualmente e mova o card para Publicado — o registro
                de métricas funciona igual.
              </p>
            ) : null}
          </section>
        </div>

        <footer className="flex items-center gap-2 border-t border-borda p-3">
          <Botao variante="destrutivo" tamanho="sm" onClick={excluir} disabled={ocupado}>
            <Trash2 />
            Excluir
          </Botao>
          <div className="ml-auto flex gap-2">
            <Botao variante="fantasma" tamanho="sm" onClick={aoFechar}>
              Fechar
            </Botao>
            <Botao variante="primario" tamanho="sm" onClick={salvarCampos} disabled={ocupado}>
              {salvar.carregando ? "Salvando…" : "Salvar"}
            </Botao>
          </div>
        </footer>
      </aside>
    </>
  );
}
