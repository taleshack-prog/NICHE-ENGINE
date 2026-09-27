import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Chamada estruturada ao Claude.
 *
 * Diferenças em relação ao helper esboçado na spec (fetch cru):
 *  - usa o SDK oficial → retry/backoff e tipagem dos blocos de conteúdo;
 *  - `data.content[0].text` não existe quando a resposta é um erro ou quando o
 *    primeiro bloco é de outro tipo (thinking, tool_use). Aqui concatenamos
 *    apenas os blocos de texto;
 *  - max_tokens de 2000 truncava 3 variações de roteiro no meio do JSON —
 *    o default subiu para 4096 e é configurável por chamada;
 *  - a falha é ruidosa e carrega o texto bruto, que é o que se precisa
 *    para debugar prompt.
 */

export type TarefaIA = "roteiro" | "copy" | "decomposicao" | "relatorio";

/**
 * Modelo por tarefa. Sobrescrevível por env (ANTHROPIC_MODEL_*).
 *
 * POR QUE NÃO OS MODELOS DA SPEC: ela fixava claude-sonnet-4-5 e
 * claude-haiku-4-5. Os dois continuam ATIVOS, mas as datas de aposentadoria
 * publicadas por Anthropic são "não antes de 29/09/2026" (Sonnet 4.5) e
 * "não antes de 15/10/2026" (Haiku 4.5) — ou seja, semanas, não anos. Um alias
 * aposentado vira 404 no meio de um roteiro, às 06h, dentro do Workflow A, onde
 * ninguém está olhando.
 *
 * Sonnet 5 é o modelo corrente e não tem data anunciada.
 *
 * Se quiser o custo menor do Haiku na decomposição (a tarefa mais simples das
 * quatro: extrair estrutura de uma transcrição), use o snapshot datado, não o
 * alias flutuante:
 *   ANTHROPIC_MODEL_DECOMPOSICAO="claude-haiku-4-5-20251001"
 *
 * Lista corrente: https://platform.claude.com/docs/en/models/overview
 */
export const MODELO_PADRAO: Record<TarefaIA, string> = {
  roteiro: "claude-sonnet-5",
  copy: "claude-sonnet-5",
  decomposicao: "claude-sonnet-5",
  relatorio: "claude-sonnet-5",
};

const ENV_MODELO: Record<TarefaIA, string> = {
  roteiro: "ANTHROPIC_MODEL_ROTEIRO",
  copy: "ANTHROPIC_MODEL_COPY",
  decomposicao: "ANTHROPIC_MODEL_DECOMPOSICAO",
  relatorio: "ANTHROPIC_MODEL_RELATORIO",
};

export class IAIndisponivelError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY não configurada. Preencha no .env para habilitar as ações de IA (Fase 2).",
    );
    this.name = "IAIndisponivelError";
  }
}

export class IAFormatoInvalidoError extends Error {
  readonly bruto: string;
  constructor(detalhe: string, bruto: string) {
    super(`A IA respondeu fora do formato esperado: ${detalhe}`);
    this.name = "IAFormatoInvalidoError";
    this.bruto = bruto;
  }
}

export function iaDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function modeloPara(tarefa: TarefaIA): string {
  return process.env[ENV_MODELO[tarefa]] || MODELO_PADRAO[tarefa];
}

let clienteCache: Anthropic | null = null;
function cliente(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new IAIndisponivelError();
  clienteCache ??= new Anthropic({ apiKey, maxRetries: 2 });
  return clienteCache;
}

/** Remove cercas de markdown e recorta o primeiro objeto/array JSON do texto. */
function extrairJson(texto: string): string {
  const semFences = texto.replace(/```(?:json)?/gi, "").trim();
  const inicio = semFences.search(/[[{]/);
  if (inicio === -1) return semFences;
  const abre = semFences[inicio];
  const fecha = abre === "{" ? "}" : "]";
  const fim = semFences.lastIndexOf(fecha);
  if (fim <= inicio) return semFences.slice(inicio);
  return semFences.slice(inicio, fim + 1);
}

export async function callClaudeStructured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: { tarefa: TarefaIA; maxTokens?: number; temperature?: number } = {
    tarefa: "roteiro",
  },
): Promise<T> {
  const resposta = await cliente().messages.create({
    model: modeloPara(opts.tarefa),
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 1,
    messages: [{ role: "user", content: prompt }],
  });

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!texto) {
    throw new IAFormatoInvalidoError("resposta sem bloco de texto", JSON.stringify(resposta));
  }

  let cru: unknown;
  try {
    cru = JSON.parse(extrairJson(texto));
  } catch (e) {
    throw new IAFormatoInvalidoError(
      `JSON não parseável (${(e as Error).message})`,
      texto.slice(0, 1500),
    );
  }

  const validado = schema.safeParse(cru);
  if (!validado.success) {
    const problemas = validado.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    throw new IAFormatoInvalidoError(problemas, texto.slice(0, 1500));
  }
  return validado.data;
}
