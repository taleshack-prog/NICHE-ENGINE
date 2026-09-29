import type { TrechoFalado } from "./fal";

/**
 * Linha do tempo do Reel: como a narração vira blocos, e cada bloco vira cena.
 *
 * Separado das Server Actions porque é lógica pura — e porque um arquivo
 * "use server" só pode exportar funções assíncronas, o que impediria testar
 * estas três de fora.
 */

export type Bloco = { ordem: number; inicioMs: number; duracaoMs: number; texto: string };

/**
 * Texto corrido para a narração.
 *
 * O roteiro é guardado em blocos separados por linha em branco (gancho, corpo,
 * loop, CTA). Entregues com as quebras, o Kokoro lê cada bloco como frase
 * independente e some com a pontuação final — a narração sai sem respiro entre
 * as ideias.
 */
export function textoNarravel(roteiro: string): string {
  return (
    roteiro
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      // Toda linha termina em pontuação forte. Sem ponto final, o sintetizador
      // emenda o fim de um bloco no começo do outro e a frase não fecha.
      .map((l) => (/[.!?…]$/.test(l) ? l : `${l.replace(/[:,;]$/, "")}.`))
      // Parágrafo, não espaço. Juntar os quatro blocos do roteiro com " "
      // entregava um texto corrido ao Kokoro, que lê sem respiro entre gancho,
      // corpo, loop e CTA — a narração soava como quem está sem tempo de
      // terminar. A quebra dupla é o que vira pausa na fala.
      .join("\n\n")
  );
}

/**
 * Corta a linha do tempo em blocos de duração igual, um por clipe.
 *
 * Distribui `total/n` em vez de fatiar de 5 em 5 segundos de propósito: o corte
 * fixo deixa um resto de fração de segundo no fim, e um clipe de 300 ms no
 * encerramento é lido como falha de renderização, não como corte.
 *
 * O texto de cada bloco é o que a voz diz NAQUELE intervalo — é ele que o
 * diretor de cena recebe. Sem isso a imagem ilustraria o tema geral do vídeo e
 * todas as cenas ficariam intercambiáveis.
 */
export function blocosDaNarracao(trechos: readonly TrechoFalado[], passoMs: number): Bloco[] {
  const total = Math.max(...trechos.map((t) => t.fimMs));
  const n = Math.max(1, Math.ceil(total / passoMs));
  const passo = Math.ceil(total / n);

  return Array.from({ length: n }, (_, i) => {
    const inicioMs = i * passo;
    const duracaoMs = Math.min(passo, total - inicioMs);
    const texto = trechos
      .filter((t) => t.fimMs > inicioMs && t.inicioMs < inicioMs + duracaoMs)
      .map((t) => t.texto)
      .join(" ")
      .trim();
    return { ordem: i + 1, inicioMs, duracaoMs, texto: texto || "(sem fala neste trecho)" };
  }).filter((b) => b.duracaoMs > 0);
}

export function blocosParaPrompt(blocos: readonly Bloco[]): string {
  const s = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");
  return blocos
    .map((b) => `  ${b.ordem}. (${s(b.inicioMs)}s-${s(b.inicioMs + b.duracaoMs)}s) "${b.texto}"`)
    .join("\n");
}

