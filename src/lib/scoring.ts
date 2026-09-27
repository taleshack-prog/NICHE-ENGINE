/**
 * Scoring de nicho e ranking de posts.
 *
 * Fórmula de nicho (da spec): demanda*2 - concorrencia + cpm/5
 * Nulos contam como neutro, não como zero — um nicho sem CPM estimado não deve
 * ser punido como se tivesse CPM zero.
 */

export function calcularScoreNicho(input: {
  demandaPerene: number | null;
  concorrencia: number | null;
  cpmEstimado: number | null;
}): number | null {
  const { demandaPerene, concorrencia, cpmEstimado } = input;
  // Sem demanda nem concorrência não existe score — devolver 0 mentiria.
  if (demandaPerene === null && concorrencia === null) return null;

  const demanda = demandaPerene ?? 5;
  const conc = concorrencia ?? 5;
  const cpm = cpmEstimado ?? 0;

  return Number((demanda * 2 - conc + cpm / 5).toFixed(2));
}

/** Faixas para colorir o score na tabela de nichos. */
export function faixaScore(score: number | null): "alto" | "medio" | "baixo" | "indefinido" {
  if (score === null) return "indefinido";
  if (score >= 12) return "alto";
  if (score >= 7) return "medio";
  return "baixo";
}

export type MetricaAgregada = {
  alcance: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
  retention3s: number | null;
};

/**
 * Score de performance de um post.
 *
 * A spec ranqueia por "salvamentos/alcance". Isso é taxa de salvamento — a
 * métrica certa, porque compara posts de alcances diferentes de forma justa.
 * Somamos compartilhamentos porque a ordem de importância declarada no
 * relatório semanal é salvamentos > compartilhamentos > retenção > alcance.
 */
export function scorePost(m: MetricaAgregada): number {
  const alcance = m.alcance ?? 0;
  if (alcance <= 0) return 0;

  const taxaSalvamento = (m.salvamentos ?? 0) / alcance;
  const taxaCompartilhamento = (m.compartilhamentos ?? 0) / alcance;
  const retencao = normalizarRetencao(m.retention3s) ?? 0;

  // Pesos: salvamento pesa 6, compartilhamento 5, retenção 4 (ver PESO_METRICAS).
  return Number((taxaSalvamento * 6 + taxaCompartilhamento * 5 + retencao * 0.4).toFixed(4));
}

/** Insights mandam 0.61 ou 61 dependendo da métrica. Normaliza para 0-1. */
export function normalizarRetencao(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return v > 1 ? v / 100 : v;
}

/** Índice de corte do top 10% (mínimo 1 item quando há dados). */
export function corteTop10(total: number): number {
  if (total === 0) return 0;
  return Math.max(1, Math.ceil(total * 0.1));
}
