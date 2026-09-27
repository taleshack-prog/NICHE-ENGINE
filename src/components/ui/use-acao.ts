"use client";

import * as React from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/actions/_shared";

/**
 * Executa uma Server Action com estado de carregamento, toast e erros de campo.
 *
 * Toda ação assíncrona da UI passa por aqui — é o que garante a regra de
 * qualidade "estados de loading e erro em toda ação assíncrona" sem repetir
 * try/catch em cada componente.
 */
export function useAcao() {
  const [carregando, setCarregando] = React.useState(false);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});

  // Genérico POR CHAMADA, não por hook: o mesmo `executar` serve actions com
  // retornos diferentes (updatePost devolve {id}, deletePost devolve undefined)
  // sem forçar um T comum artificial no call site.
  const executar = React.useCallback(
    async <T,>(
      fn: () => Promise<ActionResult<T>>,
      opts: { sucesso?: string; aoConcluir?: (data: T) => void } = {},
    ): Promise<T | null> => {
      setCarregando(true);
      setCampos({});
      try {
        const r = await fn();
        if (!r.ok) {
          setCampos(r.campos ?? {});
          toast.error(r.erro);
          return null;
        }
        if (opts.sucesso) toast.success(opts.sucesso);
        opts.aoConcluir?.(r.data);
        return r.data;
      } catch (e) {
        // Só chega aqui em falha de rede/serialização: a action já trata o resto.
        toast.error((e as Error).message || "Falha de comunicação com o servidor.");
        return null;
      } finally {
        setCarregando(false);
      }
    },
    [],
  );

  return { carregando, campos, executar, limparCampos: () => setCampos({}) };
}
