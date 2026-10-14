"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  Loader2,
  Mic,
  Play,
  Save,
  TriangleAlert,
} from "lucide-react";
import { Botao } from "@/components/ui/botao";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";
import { Input, Rotulo } from "@/components/ui/campos";
import { Selo, type SeloTom } from "@/components/ui/selo";
import type { Achado, Episodio } from "@/lib/niche";

const TOM: Record<Episodio["estado"], SeloTom> = {
  quebrada: "erro", rascunho: "alerta", pronta: "acento",
  montada: "roxo", publicada: "ok",
};

type Aba = "fala" | "linha" | "fontes" | "montagem";

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

export function EditorEpisodio({ inicial }: { inicial: Episodio }) {
  const [ep, setEp] = useState(inicial);
  const [yaml, setYaml] = useState(inicial.yaml ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("fala");

  const [obras, setObras] = useLembrado("niche.obras");
  const [ilustra, setIlustra] = useLembrado("niche.ilustra");
  const [voz, setVoz] = useState("");
  const [trilha, setTrilha] = useLembrado("niche.trilha");
  const [tempos, setTempos] = useState("");

  const [trabalho, setTrabalho] = useState<string | null>(null);
  const [estadoTrabalho, setEstadoTrabalho] = useState<string>("");
  const [log, setLog] = useState("");
  const fimDoLog = useRef<HTMLPreElement>(null);

  const sujo = yaml !== (ep.yaml ?? "");
  const montando = estadoTrabalho === "rodando";

  async function salvar() {
    setSalvando(true);
    setErroSalvar(null);
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
      setErroSalvar((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function montar(forcar = false) {
    setErroSalvar(null);
    setLog("");
    const r = await fetch("/api/youtube/montar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: ep.slug, obras, ilustra, voz, trilha, tempos, forcar,
      }),
    });
    const dados = await r.json();
    if (!r.ok) {
      setErroSalvar(dados.erro ?? "falha ao iniciar");
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
            variante="primario"
            onClick={() => void montar(false)}
            disabled={montando || sujo || ep.erros > 0}
            title={
              ep.erros > 0
                ? "o linter recusou: corrija os erros"
                : sujo ? "salve antes de montar" : undefined
            }
          >
            {montando ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Montar
          </Botao>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-tenue">
        <span>{ep.blocos} blocos · {ep.planos} planos</span>
        <span>{duracao} de vídeo</span>
        <span>{ep.segundos_falados}s de fala</span>
        <code className="text-suave">{ep.arquivo}</code>
      </div>

      {erroSalvar ? (
        <p className="rounded-md border border-erro/40 bg-erro/10 p-3 text-sm text-texto">
          {erroSalvar}
          {ep.erros > 0 ? (
            <Botao
              variante="destrutivo"
              tamanho="sm"
              className="ml-3"
              onClick={() => void montar(true)}
            >
              montar assim mesmo
            </Botao>
          ) : null}
        </p>
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
              <CardTitulo>As quatro regras</CardTitulo>
              <div className="flex gap-1.5">
                {ep.erros > 0 ? <Selo tom="erro">{ep.erros} erro</Selo> : null}
                {ep.avisos > 0 ? <Selo tom="alerta">{ep.avisos} aviso</Selo> : null}
              </div>
            </CardCabecalho>
            <CardConteudo>
              <ListaDeAchados achados={ep.achados} />
            </CardConteudo>
          </Card>

          <Card>
            <div className="flex gap-1 border-b border-borda px-2 pt-2">
              {(["fala", "linha", "fontes", "montagem"] as const).map((a) => (
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
                  {ep.precisa_obras ? (
                    <div>
                      <Rotulo>Pasta das obras</Rotulo>
                      <Input
                        value={obras}
                        onChange={(e) => setObras(e.target.value)}
                        placeholder="/home/você/obras"
                      />
                    </div>
                  ) : null}
                  {ep.precisa_ilustracoes ? (
                    <div>
                      <Rotulo>Pasta das ilustrações</Rotulo>
                      <Input
                        value={ilustra}
                        onChange={(e) => setIlustra(e.target.value)}
                        placeholder="/home/você/ilustra"
                      />
                    </div>
                  ) : null}
                  <div>
                    <Rotulo>Trilha (opcional)</Rotulo>
                    <Input
                      value={trilha}
                      onChange={(e) => setTrilha(e.target.value)}
                      placeholder="/home/você/trilha.mp3"
                    />
                  </div>
                  <div>
                    <Rotulo>Narração (opcional)</Rotulo>
                    <Input
                      value={voz}
                      onChange={(e) => setVoz(e.target.value)}
                      placeholder="/home/você/narracao.ogg"
                    />
                  </div>
                  <div>
                    <Rotulo>Tempos medidos (opcional)</Rotulo>
                    <Input
                      value={tempos}
                      onChange={(e) => setTempos(e.target.value)}
                      placeholder="9.52,10.11,… — saída de niche sincronizar"
                    />
                    <p className="mt-1 text-[11px] text-tenue">
                      Sem narração a legenda é cronometrada pelo ritmo de leitura.
                    </p>
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
