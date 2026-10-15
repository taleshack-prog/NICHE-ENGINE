"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { Botao } from "@/components/ui/botao";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";
import { AreaTexto, Input, Rotulo } from "@/components/ui/campos";
import { PainelDeCusto, type Estimativa } from "./painel-custo";

/**
 * Criar episódio sem sair do navegador — em branco ou rascunhado por IA.
 *
 * É o que fecha o ciclo: sem isto, começar um episódio ainda exigiria abrir o
 * terminal. O caminho com IA é o único do dashboard que gasta crédito, e por
 * isso tem botão próprio e a conta na tela antes de gastar.
 */
export function NovoEpisodio() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [comIa, setComIa] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [tema, setTema] = useState("");
  const [fontes, setFontes] = useState("");
  const [segundos, setSegundos] = useState(70);
  const [estimativa, setEstimativa] = useState<Estimativa | null>(null);
  const [ocupado, setOcupado] = useState<"" | "estimando" | "criando">("");
  const [erro, setErro] = useState<string | null>(null);
  // Quando o título bate com um episódio que já existe, o slug dele vira um
  // botão: reclamar sem oferecer a saída obriga a procurar na lista.
  const [jaExiste, setJaExiste] = useState<string | null>(null);

  async function emBranco() {
    setOcupado("criando");
    setErro(null);
    setJaExiste(null);
    try {
      const r = await fetch("/api/youtube/pautas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.slug) setJaExiste(d.slug as string);
        throw new Error(d.erro ?? "falha ao criar");
      }
      // refresh antes do push: a lista da página é renderizada no servidor e
      // sem isto o episódio novo só apareceria num recarregamento manual.
      router.refresh();
      router.push(`/youtube/${d.slug}`);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado("");
    }
  }

  async function chamarIa(acao: "estimar-rascunho" | "rascunhar") {
    setOcupado(acao === "rascunhar" ? "criando" : "estimando");
    setErro(null);
    setJaExiste(null);
    try {
      const r = await fetch("/api/youtube/ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, titulo, tema, fontes, segundos }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.slug) setJaExiste(d.slug as string);
        throw new Error(d.erro ?? "falha na chamada");
      }
      if (acao === "estimar-rascunho") {
        setEstimativa({ ...d, real: false });
        setOcupado("");
        return;
      }
      router.refresh();
      router.push(`/youtube/${d.episodio.slug}${d.aviso ? "?aviso=1" : ""}`);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado("");
    }
  }

  if (!aberto) {
    return (
      <Botao variante="primario" onClick={() => setAberto(true)}>
        <Plus className="size-4" />
        Novo episódio
      </Botao>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardCabecalho className="flex-row items-center justify-between">
        <CardTitulo>Novo episódio</CardTitulo>
        <Botao variante="fantasma" tamanho="sm" onClick={() => setAberto(false)}>
          fechar
        </Botao>
      </CardCabecalho>
      <CardConteudo className="space-y-3">
        <div>
          <Rotulo htmlFor="titulo-novo">Título</Rotulo>
          <Input
            id="titulo-novo"
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="O que a etiqueta de estado mental significa"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-suave">
          <input
            type="checkbox"
            checked={comIa}
            onChange={(e) => {
              setComIa(e.target.checked);
              setEstimativa(null);
            }}
            className="size-3.5 accent-[var(--color-roxo)]"
          />
          rascunhar a pauta com IA
          <span className="text-tenue">— é a única ação paga daqui</span>
        </label>

        {comIa ? (
          <>
            <div>
              <Rotulo htmlFor="tema">Tema e ângulo pretendido</Rotulo>
              <AreaTexto
                id="tema"
                rows={3}
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                placeholder="O que o episódio tem que AFIRMAR, não só o assunto. Ex.: a etiqueta não é decoração — ela registra o estado em que a obra foi pintada, e é o que diferencia o catálogo."
              />
            </div>
            <div>
              <Rotulo htmlFor="fontes">Material e fontes</Rotulo>
              <AreaTexto
                id="fontes"
                rows={5}
                value={fontes}
                onChange={(e) => setFontes(e.target.value)}
                placeholder={
                  "Cole aqui o que sustenta o episódio: estudos, números do projeto, links.\n" +
                  "O que não estiver aqui não pode virar número na fala."
                }
              />
              <p className="mt-1 text-[11px] text-tenue">
                Sem material, o rascunho sai sem número nenhum — por construção, não
                por acaso.
              </p>
            </div>
            <div className="flex items-end gap-3">
              <div className="w-32">
                <Rotulo htmlFor="segundos">Segundos de fala</Rotulo>
                <Input
                  id="segundos"
                  type="number"
                  min={20}
                  max={180}
                  value={segundos}
                  onChange={(e) => setSegundos(Number(e.target.value))}
                />
              </div>
              <Botao
                variante="contorno"
                onClick={() => void chamarIa("estimar-rascunho")}
                disabled={!titulo.trim() || ocupado !== ""}
              >
                {ocupado === "estimando" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Quanto vai custar
              </Botao>
            </div>

            {estimativa ? <PainelDeCusto estimativa={estimativa} /> : null}
          </>
        ) : null}

        {/* whitespace-pre-line: o diagnóstico da chave vem em linhas, e sem
            isto vira um parágrafo único difícil de ler. */}
        {erro ? (
          <div className="space-y-2">
            <p className="whitespace-pre-line text-xs leading-relaxed text-erro">{erro}</p>
            {jaExiste ? (
              <Botao
                variante="contorno"
                tamanho="sm"
                onClick={() => router.push(`/youtube/${jaExiste}`)}
              >
                Abrir {jaExiste}
              </Botao>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          {comIa ? (
            <Botao
              variante="primario"
              onClick={() => void chamarIa("rascunhar")}
              disabled={!titulo.trim() || ocupado !== "" || !estimativa}
              title={!estimativa ? "veja a conta antes de gastar" : undefined}
            >
              {ocupado === "criando" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Rascunhar
            </Botao>
          ) : (
            <Botao
              variante="primario"
              onClick={() => void emBranco()}
              disabled={!titulo.trim() || ocupado !== ""}
            >
              {ocupado === "criando" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Criar em branco
            </Botao>
          )}
        </div>
      </CardConteudo>
    </Card>
  );
}
