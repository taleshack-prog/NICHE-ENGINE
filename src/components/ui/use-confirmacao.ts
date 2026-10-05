"use client";

import * as React from "react";
import { toast } from "sonner";

/**
 * Confirmação de dois cliques, no lugar de `window.confirm`.
 *
 * POR QUE NÃO O DIÁLOGO DO NAVEGADOR: depois de alguns avisos seguidos, o
 * Firefox (e o Chrome) oferece "impedir que esta página crie mais caixas de
 * diálogo". Marcada a opção, TODO `confirm` passa a devolver false sem
 * aparecer — e o código sai calado. O sintoma é o pior possível: clicar no
 * botão principal e não acontecer absolutamente nada, sem erro para
 * investigar. Aconteceu em produção, no botão mais caro do sistema.
 *
 * O primeiro clique arma e avisa; o segundo executa. Desarma sozinho em 8s
 * para um clique esquecido não virar confirmação acidental minutos depois.
 */
export function useConfirmacao(desarmarMs = 8000) {
  const [armado, setArmado] = React.useState<string | null>(null);

  const confirmar = React.useCallback(
    (chave: string, aviso: string): boolean => {
      if (armado === chave) {
        setArmado(null);
        return true;
      }
      setArmado(chave);
      toast.warning(`${aviso} Clique de novo para confirmar.`);
      window.setTimeout(() => setArmado((a) => (a === chave ? null : a)), desarmarMs);
      return false;
    },
    [armado, desarmarMs],
  );

  return { armado, confirmar };
}
