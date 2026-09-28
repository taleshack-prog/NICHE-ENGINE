/**
 * Ranking por métrica para o relatório semanal.
 *
 * Vive em lib e não na action porque um arquivo "use server" só pode exportar
 * funções async — e função pura que não pode ser exportada não pode ser testada.
 */

export type LinhaPayload = {
  post: string;
  alcance: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
  comentarios: number | null;
  retention3s: number | null;
  follows: number | null;
};

/**
 * Ranking por métrica, calculado em código e entregue pronto ao prompt.
 *
 * POR QUE NÃO DEIXAR A IA ORDENAR: num teste real o relatório afirmou que o post
 * com 12.400 de alcance tinha "o menor alcance da semana", quando outro tinha
 * 8.200. Nove dos dez números do relatório estavam certos; o que errou foi
 * justamente a única comparação feita sem citar os dois valores — e o erro
 * FORTALECIA a narrativa ("guardou muito apesar de alcançar pouco"), que é como
 * esse tipo de deslize passa por revisão humana.
 *
 * Ordenar três números é trabalho de código. Pedir isso ao modelo é criar uma
 * chance de erro sem ganho nenhum.
 */
export function rankingPorMetrica(linhas: LinhaPayload[]): string {
  const fmt = new Intl.NumberFormat("pt-BR");
  const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

  const metricas: Array<{
    rotulo: string;
    valor: (l: LinhaPayload) => number | null;
    exibir: (v: number) => string;
  }> = [
    { rotulo: "salvamentos", valor: (l) => l.salvamentos, exibir: (v) => fmt.format(v) },
    {
      rotulo: "taxa de salvamento (salvamentos/alcance)",
      valor: (l) => (l.salvamentos !== null && l.alcance ? l.salvamentos / l.alcance : null),
      exibir: pct,
    },
    {
      rotulo: "compartilhamentos",
      valor: (l) => l.compartilhamentos,
      exibir: (v) => fmt.format(v),
    },
    {
      rotulo: "taxa de compartilhamento (compart./alcance)",
      valor: (l) => (l.compartilhamentos !== null && l.alcance ? l.compartilhamentos / l.alcance : null),
      exibir: pct,
    },
    { rotulo: "retenção 3s", valor: (l) => l.retention3s, exibir: pct },
    { rotulo: "alcance", valor: (l) => l.alcance, exibir: (v) => fmt.format(v) },
    { rotulo: "follows ganhos", valor: (l) => l.follows, exibir: (v) => fmt.format(v) },
    { rotulo: "comentários", valor: (l) => l.comentarios, exibir: (v) => fmt.format(v) },
  ];

  return metricas
    .map(({ rotulo, valor, exibir }) => {
      const comDado = linhas
        .map((l) => ({ post: l.post, v: valor(l) }))
        .filter((x): x is { post: string; v: number } => x.v !== null)
        .sort((a, b) => b.v - a.v);

      const semDado = linhas.filter((l) => valor(l) === null).map((l) => l.post);

      if (comDado.length === 0) return `${rotulo}: sem dado em nenhum post`;

      const ordenado = comDado.map((x) => `${x.post} (${exibir(x.v)})`).join(" > ");
      const faltando = semDado.length ? ` · SEM DADO: ${semDado.join(", ")}` : "";
      return `${rotulo}: ${ordenado}${faltando}`;
    })
    .join("\n");
}
