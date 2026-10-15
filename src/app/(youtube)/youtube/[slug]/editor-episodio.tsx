"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  Info,
  Loader2,
  Mic,
  Play,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
  Youtube,
} from "lucide-react";
import { PainelDeCusto, type Estimativa } from "../painel-custo";
import { Botao } from "@/components/ui/botao";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";
import { AreaTexto, Input, Rotulo, Selecao } from "@/components/ui/campos";
import { Selo, type SeloTom } from "@/components/ui/selo";
import type { Achado, Episodio, ItemDoAcervo } from "@/lib/niche";

const TOM: Record<Episodio["estado"], SeloTom> = {
  quebrada: "erro", rascunho: "alerta", pronta: "acento",
  montada: "roxo", publicada: "ok",
};

// Limites do próprio YouTube. Ficam aqui porque são os únicos números do
// dashboard que não vêm do Python — são regra da plataforma, não da pauta.
const LIMITE_TITULO = 100;
const LIMITE_DESCRICAO = 5000;

type Aba = "fala" | "linha" | "fontes" | "montagem" | "publicação";

/**
 * Uma barra só, três tons.
 *
 * POR QUE EXISTE: antes era um `string` chamado `erroSalvar`, e tudo caía
 * nele — inclusive "o linter não apontou nada", que é boa notícia. Pintada de
 * vermelho, com um "montar assim mesmo" ao lado que não tinha nada a ver com
 * a mensagem, ela mandava procurar problema onde não havia.
 *
 * `forcar` só vem de quem pode forçar: a própria montagem. Nenhuma outra
 * ação oferece esse botão.
 */
type Recado = {
  texto: string;
  tom: "erro" | "aviso" | "info";
  forcar?: boolean;
};

const TARJA: Record<Recado["tom"], string> = {
  erro: "border-erro/40 bg-erro/10 text-texto",
  aviso: "border-alerta/40 bg-alerta/10 text-texto",
  info: "border-borda bg-superficie-2 text-suave",
};

/**
 * Pastas de obras e ilustrações mudam pouco; digitar toda vez é imposto.
 *
 * Lido com useSyncExternalStore e não com useState + useEffect: o servidor não
 * tem localStorage, então o valor só existe depois da montagem. Puxá-lo num
 * efeito e chamar setState provoca uma segunda renderização em cascata — é o
 * que o react-hooks/set-state-in-effect reclama, e com razão.
 */
function useLembrado(chave: string) {
  const guardado = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return window.localStorage.getItem(chave) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  const [editado, setEditado] = useState<string | null>(null);
  const guardar = (v: string) => {
    setEditado(v);
    try {
      window.localStorage.setItem(chave, v);
    } catch {
      /* navegador sem storage: segue sem lembrar */
    }
  };
  return [editado ?? guardado, guardar] as const;
}

function ListaDeAchados({ achados }: { achados: Achado[] }) {
  if (achados.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ok">
        <CheckCircle2 className="size-4" />
        passou nas quatro regras, sem avisos
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {achados.map((a, i) => (
        <li
          key={i}
          className={`rounded-md border p-2.5 text-xs leading-relaxed ${
            a.grau === "erro"
              ? "border-erro/40 bg-erro/10 text-texto"
              : "border-alerta/30 bg-alerta/5 text-suave"
          }`}
        >
          <div className="mb-1 flex items-center gap-1.5">
            {a.grau === "erro" ? (
              <AlertTriangle className="size-3 text-erro" />
            ) : (
              <TriangleAlert className="size-3 text-alerta" />
            )}
            <span className="font-medium">{a.regra}</span>
            <span className="text-tenue">· {a.onde}</span>
          </div>
          {a.texto}
        </li>
      ))}
    </ul>
  );
}

export function EditorEpisodio({
  inicial,
  audio,
}: {
  inicial: Episodio;
  audio: ItemDoAcervo[];
}) {
  const router = useRouter();
  const [ep, setEp] = useState(inicial);
  const [yaml, setYaml] = useState(inicial.yaml ?? "");
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<Recado | null>(null);
  const [aba, setAba] = useState<Aba>("fala");

  const [estimativaIa, setEstimativaIa] = useState<Estimativa | null>(null);
  const [proposta, setProposta] = useState<string | null>(null);
  const [depois, setDepois] = useState<Episodio | null>(null);
  const [ocupadoIa, setOcupadoIa] = useState<"" | "estimando" | "corrigindo">("");

  const pub = (ep.publicacao ?? {}) as Record<string, unknown>;
  const [pTitulo, setPTitulo] = useState(String(pub.titulo ?? ""));
  const [pDescricao, setPDescricao] = useState(String(pub.descricao ?? ""));
  const [pHashtags, setPHashtags] = useState(
    Array.isArray(pub.hashtags) ? (pub.hashtags as string[]).join(" ") : "",
  );
  const [pUrl, setPUrl] = useState(String(pub.url ?? ""));
  const [salvandoPub, setSalvandoPub] = useState(false);

  const [voz, setVoz] = useState("");
  const [trilha, setTrilha] = useLembrado("niche.trilha");
  const [tempos, setTempos] = useState("");

  // Só para a tela saber qual dos dois botões está rodando — o que gasta e
  // o que não gasta não podem parecer a mesma coisa enquanto esperam.
  const [entregando, setEntregando] = useState(false);
  const [trabalho, setTrabalho] = useState<string | null>(null);
  const [estadoTrabalho, setEstadoTrabalho] = useState<string>("");
  const [log, setLog] = useState("");
  const fimDoLog = useRef<HTMLPreElement>(null);

  const sujo = yaml !== (ep.yaml ?? "");
  const montando = estadoTrabalho === "rodando";

  async function salvar() {
    setSalvando(true);
    setRecado(null);
    try {
      const r = await fetch(`/api/youtube/pautas/${ep.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml }),
      });
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.erro ?? "falha ao salvar");
      setEp(dados as Episodio);
      setYaml((dados as Episodio).yaml ?? yaml);
    } catch (e) {
      setRecado({ texto: (e as Error).message, tom: "erro" });
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Corrigir com IA — a única ação paga desta tela.
   *
   * A proposta NÃO sobrescreve o arquivo: volta como texto, já passada pelo
   * linter, e quem aceita é o usuário. Correção automática aplicada direto
   * esconderia o que mudou numa pauta que ele vai ler em voz alta.
   */
  async function corrigir(acao: "estimar-correcao" | "corrigir") {
    setOcupadoIa(acao === "corrigir" ? "corrigindo" : "estimando");
    setRecado(null);
    try {
      const r = await fetch("/api/youtube/ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, slug: ep.slug, yaml }),
      });
      const d = await r.json();
      if (!r.ok) {
        // "não há o que corrigir" chega aqui como 409 e vem marcado. É a
        // recusa de gastar token numa pauta limpa, não uma falha.
        setRecado({
          texto: d.erro ?? "falha na chamada",
          tom: d.informativo ? "info" : "erro",
        });
        return;
      }
      if (acao === "estimar-correcao") {
        setEstimativaIa({ ...d, real: false });
      } else {
        setProposta(d.proposta);
        setDepois(d.depois ?? null);
        setEstimativaIa({ uso: d.uso, precoConfigurado: true, real: true });
        if (d.aviso) setRecado({ texto: d.aviso, tom: "aviso" });
      }
    } catch (e) {
      setRecado({ texto: (e as Error).message, tom: "erro" });
    } finally {
      setOcupadoIa("");
    }
  }

  async function salvarPublicacao() {
    setSalvandoPub(true);
    setRecado(null);
    try {
      const r = await fetch("/api/youtube/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: ep.slug,
          titulo: pTitulo,
          descricao: pDescricao,
          hashtags: pHashtags.split(/\s+/).filter(Boolean),
          url: pUrl,
          publicado_em: pUrl ? new Date().toISOString().slice(0, 10) : "",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "falha ao gravar");
      setEp(d as Episodio);
      setYaml((d as Episodio).yaml ?? yaml);
    } catch (e) {
      setRecado({ texto: (e as Error).message, tom: "erro" });
    } finally {
      setSalvandoPub(false);
    }
  }

  async function apagar() {
    if (!window.confirm(`Apagar a pauta "${ep.titulo}"? O mp4 montado fica.`)) return;
    const r = await fetch(`/api/youtube/pautas/${ep.slug}`, { method: "DELETE" });
    if (r.ok) router.push("/youtube");
    else setRecado({ texto: (await r.json()).erro ?? "falha ao apagar", tom: "erro" });
  }

  async function montar(forcar = false, entregar = false) {
    setRecado(null);
    setLog("");
    setEntregando(entregar);
    const r = await fetch("/api/youtube/montar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: ep.slug, voz, trilha, tempos, forcar, entregar }),
    });
    const dados = await r.json();
    if (!r.ok) {
      // Aqui, e só aqui, o "montar assim mesmo" faz sentido: quem recusou
      // foi a montagem, e forçar é a saída.
      setRecado({
        texto: dados.erro ?? "falha ao iniciar",
        tom: "erro",
        forcar: !forcar && ep.erros > 0,
      });
      return;
    }
    setTrabalho(dados.id);
    setEstadoTrabalho("rodando");
    setAba("montagem");
  }

  // Acompanha o render por consulta periódica. O processo é destacado e grava
  // o log em arquivo, então fechar a aba (ou o dev server reiniciar) não mata
  // a montagem — ao voltar, o log continua lá.
  useEffect(() => {
    if (!trabalho || estadoTrabalho !== "rodando") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/youtube/montar?id=${trabalho}`);
      if (!r.ok) return;
      const { trabalho: t2, log: l } = await r.json();
      setLog(l);
      setEstadoTrabalho(t2.estado);
      if (t2.estado !== "rodando") {
        const novo = await fetch(`/api/youtube/pautas/${ep.slug}`);
        if (novo.ok) setEp((await novo.json()) as Episodio);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [trabalho, estadoTrabalho, ep.slug]);

  useEffect(() => {
    fimDoLog.current?.scrollTo(0, fimDoLog.current.scrollHeight);
  }, [log]);

  const duracao = useMemo(() => {
    const s = ep.segundos ?? 0;
    return s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}` : `${s}s`;
  }, [ep.segundos]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{ep.titulo}</h1>
            <Selo tom={TOM[ep.estado]}>{ep.estado}</Selo>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-tenue">{ep.angulo}</p>
        </div>
        <div className="flex items-center gap-2">
          <Botao variante="contorno" onClick={() => void salvar()} disabled={!sujo || salvando}>
            {salvando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {sujo ? "Salvar e validar" : "Salvo"}
          </Botao>
          <Botao
            variante="contorno"
            onClick={() => void montar(false)}
            disabled={montando || sujo || ep.erros > 0}
            title={
              ep.erros > 0
                ? "o linter recusou: corrija os erros"
                : sujo ? "salve antes de montar" : "monta sem narração, custo zero"
            }
          >
            {montando && !entregando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Montar
          </Botao>
          {/* O caminho inteiro num clique. É o único botão desta tela que
              gasta, e por isso o custo está escrito nele, não escondido. */}
          <Botao
            variante="primario"
            onClick={() => void montar(false, true)}
            disabled={montando || sujo || ep.erros > 0}
            title={
              ep.erros > 0
                ? "o linter recusou: corrija os erros"
                : sujo
                  ? "salve antes de entregar"
                  : "gera a narração, mede, monta e mixa — ~US$ 0,07"
            }
          >
            {montando && entregando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            Entregar pronto
          </Botao>
          <Botao
            variante="fantasma"
            tamanho="icone"
            onClick={() => void apagar()}
            title="apagar a pauta"
          >
            <Trash2 className="size-4" />
          </Botao>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-tenue">
        <span>{ep.blocos} blocos · {ep.planos} planos</span>
        <span>{duracao} de vídeo</span>
        <span>{ep.segundos_falados}s de fala</span>
        <code className="text-suave">{ep.arquivo}</code>
      </div>

      {recado ? (
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-3 text-sm ${
            TARJA[recado.tom]
          }`}
        >
          <span className="flex items-start gap-2 whitespace-pre-line">
            {recado.tom === "erro" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-erro" />
            ) : recado.tom === "aviso" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alerta" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-tenue" />
            )}
            {recado.texto}
          </span>
          {recado.forcar ? (
            <Botao variante="destrutivo" tamanho="sm" onClick={() => void montar(true)}>
              montar assim mesmo
            </Botao>
          ) : null}
          <button
            type="button"
            onClick={() => setRecado(null)}
            className="ml-auto text-xs text-tenue underline-offset-2 hover:underline"
          >
            fechar
          </button>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_minmax(380px,420px)]">
        <Card className="flex min-h-[560px] flex-col">
          <CardCabecalho className="flex-row items-center justify-between">
            <CardTitulo>Pauta</CardTitulo>
            {sujo ? <Selo tom="alerta">alterada</Selo> : null}
          </CardCabecalho>
          <CardConteudo className="flex-1">
            <textarea
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              spellCheck={false}
              className="h-full min-h-[500px] w-full resize-none rounded-md border border-borda bg-fundo p-3 font-mono text-[12.5px] leading-relaxed text-texto outline-none focus:border-roxo/60"
            />
          </CardConteudo>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardCabecalho className="flex-row items-center justify-between">
              <CardTitulo>As regras</CardTitulo>
              <div className="flex gap-1.5">
                {ep.erros > 0 ? <Selo tom="erro">{ep.erros} erro</Selo> : null}
                {ep.avisos > 0 ? <Selo tom="alerta">{ep.avisos} aviso</Selo> : null}
              </div>
            </CardCabecalho>
            <CardConteudo className="space-y-3">
              <ListaDeAchados achados={ep.achados} />

              {ep.achados.length > 0 && !proposta ? (
                <div className="space-y-2 border-t border-borda pt-3">
                  <Botao
                    variante="contorno"
                    tamanho="sm"
                    onClick={() => void corrigir("estimar-correcao")}
                    disabled={ocupadoIa !== ""}
                  >
                    {ocupadoIa === "estimando" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    Corrigir com IA
                  </Botao>
                  {estimativaIa ? (
                    <>
                      <PainelDeCusto estimativa={estimativaIa} />
                      <Botao
                        variante="primario"
                        tamanho="sm"
                        onClick={() => void corrigir("corrigir")}
                        disabled={ocupadoIa !== ""}
                      >
                        {ocupadoIa === "corrigindo" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Gerar proposta
                      </Botao>
                    </>
                  ) : null}
                </div>
              ) : null}

              {proposta ? (
                <div className="space-y-2 border-t border-borda pt-3">
                  <p className="text-xs text-suave">
                    A proposta <strong className="text-texto">não foi gravada</strong>.
                    {depois
                      ? ` Passada pelo linter: ${depois.erros} erro, ${depois.avisos} aviso.`
                      : " Não consegui passá-la pelo linter."}
                  </p>
                  {estimativaIa ? <PainelDeCusto estimativa={estimativaIa} /> : null}
                  <pre className="max-h-64 overflow-auto rounded-md bg-fundo p-2.5 font-mono text-[11px] leading-relaxed text-suave">
                    {proposta}
                  </pre>
                  <div className="flex gap-2">
                    <Botao
                      variante="primario"
                      tamanho="sm"
                      onClick={() => {
                        setYaml(proposta);
                        setProposta(null);
                        setEstimativaIa(null);
                      }}
                    >
                      usar no editor
                    </Botao>
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      onClick={() => {
                        setProposta(null);
                        setEstimativaIa(null);
                      }}
                    >
                      descartar
                    </Botao>
                  </div>
                </div>
              ) : null}
            </CardConteudo>
          </Card>

          <Card>
            <div className="flex gap-1 border-b border-borda px-2 pt-2">
              {(["fala", "linha", "fontes", "montagem", "publicação"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAba(a)}
                  className={`rounded-t-md px-3 py-2 text-xs font-medium capitalize transition-colors ${
                    aba === a
                      ? "bg-superficie-2 text-texto"
                      : "text-tenue hover:text-suave"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <CardConteudo className="max-h-[520px] overflow-y-auto pt-3">
              {aba === "fala" ? (
                <div className="space-y-3">
                  <p className="text-[11px] text-tenue">
                    É isto que você lê em voz alta — uma pausa marcada por bloco. As
                    barras da pauta somem: elas cortam a legenda, não a fala.
                  </p>
                  {ep.blocos_detalhe?.map((b) => (
                    <div key={b.n} className="rounded-md border border-borda p-2.5">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-tenue">
                        <Mic className="size-3" />
                        bloco {b.n} · ~{b.segundos}s
                        {b.fonte ? <Selo tom="roxo">{b.fonte}</Selo> : null}
                      </div>
                      {/* Um corte por linha, como teleprompter. A fala não tem
                          pontuação nos cortes — o corte é no meio da
                          respiração — e numa linha só ela vira amontoado. */}
                      {b.cortes
                        .filter((c) => c.trim())
                        .map((c, j) => (
                          <p key={j} className="text-xs leading-relaxed text-suave">
                            {c}
                          </p>
                        ))}
                    </div>
                  ))}
                </div>
              ) : null}

              {aba === "linha" ? (
                <ul className="space-y-1.5">
                  {ep.linha?.map((p, i) => (
                    <li key={i} className="flex gap-2 rounded-md border border-borda p-2 text-[11px]">
                      <span className="w-14 shrink-0 font-mono text-tenue">
                        {p.inicio.toFixed(1)}s
                      </span>
                      <span className="w-10 shrink-0 font-mono text-tenue">
                        +{p.segundos.toFixed(1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <code className="block truncate text-roxo">{p.visual}</code>
                        <span className="block truncate text-suave">
                          {p.legenda || <em className="text-tenue">sem legenda</em>}
                        </span>
                      </span>
                      {p.linhas > 2 ? (
                        <span className="shrink-0 text-tenue">{p.linhas} ln</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {aba === "fontes" ? (
                <ul className="space-y-2">
                  {ep.fontes?.length ? (
                    ep.fontes.map((f) => (
                      <li key={f.apelido} className="rounded-md border border-borda p-2.5 text-xs">
                        <div className="mb-0.5 flex items-center gap-2">
                          <Selo tom="roxo">{f.apelido}</Selo>
                        </div>
                        <p className="text-suave">{f.titulo}</p>
                        {f.onde ? <p className="mt-0.5 text-tenue">{f.onde}</p> : null}
                        {f.url ? (
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block truncate text-[11px] text-acento hover:underline"
                          >
                            {f.url}
                          </a>
                        ) : (
                          <p className="mt-1 text-[11px] text-alerta">sem url</p>
                        )}
                      </li>
                    ))
                  ) : (
                    <p className="text-xs text-tenue">nenhuma fonte declarada</p>
                  )}
                </ul>
              ) : null}

              {aba === "montagem" ? (
                <div className="space-y-3">
                  {/* Os dois botões do cabeçalho fazem coisas diferentes, e a
                      diferença custa dinheiro. Dizer isso aqui evita que
                      "Narração" e "Tempos" pareçam obrigatórios. */}
                  <p className="rounded-md border border-borda bg-superficie-2 p-2.5 text-[11px] leading-relaxed text-suave">
                    <strong className="text-texto">Entregar pronto</strong> gera a
                    narração, mede cada bloco e monta — os campos abaixo de
                    narração e tempos ficam por conta dele. Custa ~US$ 0,07 e não
                    regera o que já existe no disco.{" "}
                    <strong className="text-texto">Montar</strong> é o caminho de
                    sempre: usa a narração que você escolher aqui, e não gasta.
                  </p>

                  {audio.length === 0 ? (
                    <p className="rounded-md border border-alerta/30 bg-alerta/5 p-2.5 text-[11px] leading-relaxed text-suave">
                      Nenhuma trilha ou narração no acervo. Suba os arquivos em{" "}
                      <Link href="/youtube/acervo" className="text-acento hover:underline">
                        Acervo
                      </Link>{" "}
                      e eles aparecem aqui. Sem áudio o episódio monta mudo.
                    </p>
                  ) : null}

                  {(ep.precisa_obras || ep.precisa_ilustracoes) ? (
                    <p className="text-[11px] leading-relaxed text-tenue">
                      As obras e ilustrações saem do{" "}
                      <Link href="/youtube/acervo" className="text-acento hover:underline">
                        Acervo
                      </Link>
                      , pelo nome que a pauta declara.
                    </p>
                  ) : null}

                  <div>
                    <Rotulo htmlFor="m-trilha">Trilha</Rotulo>
                    <Selecao
                      id="m-trilha"
                      value={trilha}
                      onChange={(e) => setTrilha(e.target.value)}
                    >
                      <option value="">sem trilha</option>
                      {audio.map((a) => (
                        <option key={a.nome} value={a.nome}>
                          {a.nome}
                        </option>
                      ))}
                    </Selecao>
                  </div>
                  <div>
                    <Rotulo htmlFor="m-voz">Narração</Rotulo>
                    <Selecao id="m-voz" value={voz} onChange={(e) => setVoz(e.target.value)}>
                      <option value="">sem narração</option>
                      {audio.map((a) => (
                        <option key={a.nome} value={a.nome}>
                          {a.nome}
                        </option>
                      ))}
                    </Selecao>
                    <p className="mt-1 text-[11px] text-tenue">
                      Com narração a legenda segue o ritmo de fala; sem ela, o de
                      leitura, que é mais lento.
                    </p>
                  </div>
                  <div>
                    <Rotulo htmlFor="m-tempos">Tempos medidos (opcional)</Rotulo>
                    <Input
                      id="m-tempos"
                      value={tempos}
                      onChange={(e) => setTempos(e.target.value)}
                      placeholder="9.52,10.11,… — saída de niche sincronizar"
                    />
                  </div>

                  {log ? (
                    <pre
                      ref={fimDoLog}
                      className="max-h-56 overflow-auto rounded-md bg-fundo p-2.5 font-mono text-[11px] leading-relaxed text-suave"
                    >
                      {log}
                    </pre>
                  ) : null}
                  {estadoTrabalho && estadoTrabalho !== "rodando" ? (
                    <Selo tom={estadoTrabalho === "concluido" ? "ok" : "erro"}>
                      {estadoTrabalho}
                    </Selo>
                  ) : null}
                </div>
              ) : null}

              {aba === "publicação" ? (
                <div className="space-y-3">
                  <p className="text-[11px] leading-relaxed text-tenue">
                    Grava no bloco <code className="text-suave">publicacao:</code> da
                    própria pauta — o episódio é um arquivo só, e o que foi ao ar fica
                    junto do que foi dito. Os comentários do arquivo são preservados.
                  </p>
                  <div>
                    <Rotulo htmlFor="p-titulo">
                      Título{" "}
                      <span
                        className={
                          pTitulo.length > LIMITE_TITULO ? "text-erro" : "text-tenue"
                        }
                      >
                        {pTitulo.length}/{LIMITE_TITULO}
                      </span>
                    </Rotulo>
                    <Input
                      id="p-titulo"
                      value={pTitulo}
                      onChange={(e) => setPTitulo(e.target.value)}
                    />
                  </div>
                  <div>
                    <Rotulo htmlFor="p-descricao">
                      Descrição{" "}
                      <span
                        className={
                          pDescricao.length > LIMITE_DESCRICAO ? "text-erro" : "text-tenue"
                        }
                      >
                        {pDescricao.length}/{LIMITE_DESCRICAO}
                      </span>
                    </Rotulo>
                    <AreaTexto
                      id="p-descricao"
                      rows={6}
                      value={pDescricao}
                      onChange={(e) => setPDescricao(e.target.value)}
                      placeholder={
                        "O que o episódio afirma, e as fontes com link.\n" +
                        "Crédito da trilha vai aqui."
                      }
                    />
                    {ep.fontes?.some((f) => f.url) ? (
                      <Botao
                        variante="fantasma"
                        tamanho="sm"
                        className="mt-1"
                        onClick={() =>
                          setPDescricao((d) => {
                            // Sem o guarda, uma descrição vazia virava duas
                            // linhas em branco no topo — e o YAML gravava a
                            // descrição entre aspas com os brancos dentro.
                            const lista =
                              "Fontes:\n" +
                              ep
                                .fontes!.filter((f) => f.url && f.apelido !== "produto")
                                .map((f) => `• ${f.titulo} — ${f.url}`)
                                .join("\n");
                            const antes = d.trimEnd();
                            return antes ? `${antes}\n\n${lista}` : lista;
                          })
                        }
                      >
                        juntar as fontes da pauta
                      </Botao>
                    ) : null}
                  </div>
                  <div>
                    <Rotulo htmlFor="p-hashtags">Hashtags</Rotulo>
                    <Input
                      id="p-hashtags"
                      value={pHashtags}
                      onChange={(e) => setPHashtags(e.target.value)}
                      placeholder="#neurodivergencia #autismo #web3"
                    />
                  </div>
                  <div>
                    <Rotulo htmlFor="p-url">Link do vídeo publicado</Rotulo>
                    <Input
                      id="p-url"
                      value={pUrl}
                      onChange={(e) => setPUrl(e.target.value)}
                      placeholder="https://youtube.com/shorts/..."
                    />
                    <p className="mt-1 text-[11px] text-tenue">
                      Com o link preenchido o episódio passa a “publicada”.
                    </p>
                  </div>
                  <Botao
                    variante="primario"
                    tamanho="sm"
                    onClick={() => void salvarPublicacao()}
                    disabled={salvandoPub || pTitulo.length > LIMITE_TITULO}
                  >
                    {salvandoPub ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Youtube className="size-3.5" />
                    )}
                    Gravar na pauta
                  </Botao>
                </div>
              ) : null}
            </CardConteudo>
          </Card>

          {ep.video ? (
            <Card>
              <CardCabecalho className="flex-row items-center justify-between">
                <CardTitulo className="flex items-center gap-1.5">
                  <Film className="size-3.5" />
                  Montado
                </CardTitulo>
                <a
                  href={`/api/youtube/video/${ep.slug}`}
                  download
                  className="text-[11px] text-acento hover:underline"
                >
                  baixar
                </a>
              </CardCabecalho>
              <CardConteudo>
                <video
                  key={ep.video}
                  src={`/api/youtube/video/${ep.slug}`}
                  controls
                  className="mx-auto max-h-[460px] rounded-md border border-borda"
                />
                <p className="mt-2 text-[11px] text-tenue">{ep.video}</p>
              </CardConteudo>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
