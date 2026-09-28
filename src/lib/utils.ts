import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formata número grande de forma compacta: 12400 → "12,4 mil". */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", {
    notation: n >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  // Aceita tanto 0.61 quanto 61 — as duas convenções aparecem nos insights.
  const v = n <= 1 ? n * 100 : n;
  return `${v.toFixed(0)}%`;
}

export function fmtData(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export function fmtDataHora(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Chave de dia no fuso do servidor: YYYY-MM-DD. Base da idempotência de métricas. */
export function diaRef(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Início da janela de 7 dias — a definição de "semana" do sistema inteiro.
 *
 * NÃO é semana-calendário, de propósito. A versão anterior devolvia o domingo
 * 00:00 da semana corrente, e isso quebrava exatamente onde mais importa: o
 * Workflow C gera o relatório semanal AOS DOMINGOS, o dia em que a semana-
 * calendário acabou de começar. Na prática o relatório olhava para uma janela
 * de algumas horas, não achava os 3 posts mínimos e se recusava a rodar — todo
 * domingo, em silêncio.
 *
 * Janela móvel também é o que o SQL do Workflow C já usava
 * (NOW() - INTERVAL '7 days'). Dashboard e automação agora concordam.
 */
export function inicioJanela7Dias(d: Date = new Date()): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - 7);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function truncar(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function contarPalavras(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
