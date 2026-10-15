"use client";

import { Coins } from "lucide-react";

export type Estimativa = {
  uso: { entrada: number; saida: number; modelo: string; usd: number | null };
  precoConfigurado: boolean;
  real?: boolean;
  achados?: number;
};

const fmt = new Intl.NumberFormat("pt-BR");

/**
 * A conta, antes e depois.
 *
 * O número em TOKENS é exato e não depende de tabela nenhuma. O dólar só
 * aparece se o preço estiver no .env — cravar uma tabela de preço no código
 * seria exibir, com cara de número oficial, um valor que envelhece sozinho e
 * que pode nem ser o do seu contrato.
 */
export function PainelDeCusto({ estimativa }: { estimativa: Estimativa }) {
  const { uso, precoConfigurado, real } = estimativa;
  const total = uso.entrada + uso.saida;

  return (
    <div className="rounded-md border border-roxo/30 bg-roxo/5 p-3 text-xs">
      <p className="mb-1.5 flex items-center gap-1.5 font-medium text-roxo">
        <Coins className="size-3.5" />
        {real ? "Custou" : "Vai custar, aproximadamente"}
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-suave">
        <span>
          entrada <strong className="text-texto">{fmt.format(uso.entrada)}</strong> tokens
        </span>
        <span>
          saída <strong className="text-texto">{fmt.format(uso.saida)}</strong> tokens
        </span>
        <span>
          total <strong className="text-texto">{fmt.format(total)}</strong>
        </span>
      </div>
      <p className="mt-1.5 text-tenue">
        modelo <code className="text-suave">{uso.modelo}</code>
        {uso.usd !== null ? (
          <>
            {" · "}
            <strong className="text-texto">
              US$ {uso.usd < 0.01 ? uso.usd.toFixed(4) : uso.usd.toFixed(3)}
            </strong>
          </>
        ) : null}
      </p>
      {!precoConfigurado ? (
        <p className="mt-1.5 leading-relaxed text-tenue">
          Para ver em dólar, defina <code className="text-suave">ANTHROPIC_PRECO_ENTRADA_USD</code>{" "}
          e <code className="text-suave">ANTHROPIC_PRECO_SAIDA_USD</code> no{" "}
          <code className="text-suave">.env</code> (preço por milhão de tokens). Os
          valores correntes estão em{" "}
          <a
            className="text-acento hover:underline"
            href="https://platform.claude.com/docs/en/about-claude/pricing"
            target="_blank"
            rel="noreferrer"
          >
            platform.claude.com
          </a>
          . Não embuti tabela de preço no código porque ela envelhece sem avisar.
        </p>
      ) : null}
      {!real ? (
        <p className="mt-1.5 text-tenue">
          Estimativa por contagem de caracteres (~4 por token); erra uns 15% para mais
          ou para menos. O número real aparece depois da chamada.
        </p>
      ) : null}
    </div>
  );
}
