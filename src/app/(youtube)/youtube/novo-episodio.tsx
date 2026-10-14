"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Botao } from "@/components/ui/botao";
import { Input, Rotulo } from "@/components/ui/campos";

/**
 * Criar episódio sem sair do navegador.
 *
 * É o que fecha o ciclo: sem isto, começar o episódio 3 ainda exigiria abrir o
 * terminal e copiar um arquivo à mão — e aí o dashboard seria só uma vitrine.
 */
export function NovoEpisodio() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setCriando(true);
    setErro(null);
    try {
      const r = await fetch("/api/youtube/pautas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo }),
      });
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.erro ?? "falha ao criar");
      router.push(`/youtube/${dados.slug}`);
    } catch (e) {
      setErro((e as Error).message);
      setCriando(false);
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
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void criar();
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div>
        <Rotulo htmlFor="titulo-novo">Título do episódio</Rotulo>
        <Input
          id="titulo-novo"
          autoFocus
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="O que a tokenização resolve"
          className="w-72"
        />
      </div>
      <Botao variante="primario" type="submit" disabled={!titulo.trim() || criando}>
        {criando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        Criar
      </Botao>
      <Botao variante="fantasma" type="button" onClick={() => setAberto(false)}>
        cancelar
      </Botao>
      {erro ? <p className="w-full text-xs text-erro">{erro}</p> : null}
    </form>
  );
}
