"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function GraficoCrescimento({
  dados,
}: {
  dados: Array<{ dia: string; follows: number; alcance: number }>;
}) {
  const temDado = dados.some((d) => d.follows > 0 || d.alcance > 0);

  if (!temDado) {
    return (
      <div className="grid h-56 place-items-center text-center text-xs text-tenue">
        Sem métricas nos últimos 30 dias.
        <br />
        Registre métricas em Analytics para a curva aparecer.
      </div>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-borda)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="dia"
            tick={{ fill: "var(--color-tenue)", fontSize: 10 }}
            stroke="var(--color-borda)"
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: "var(--color-tenue)", fontSize: 10 }}
            stroke="var(--color-borda)"
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-superficie-2)",
              border: "1px solid var(--color-borda)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--color-suave)" }}
            formatter={(v: number, nome: string) => [
              new Intl.NumberFormat("pt-BR").format(v),
              nome === "follows" ? "Seguidores (acum.)" : "Alcance do dia",
            ]}
          />
          <Line
            type="monotone"
            dataKey="follows"
            stroke="var(--color-acento)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="alcance"
            stroke="var(--color-roxo)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
