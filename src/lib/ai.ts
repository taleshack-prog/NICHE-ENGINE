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

/**
 * TEMPERATURA: não enviada por padrão.
 *
 * Houve uma tentativa de ajustar temperatura por tarefa (baixa para
 * classificação, alta para geração). A API recusou: "Temperature is deprecated
 * for this model" — o Sonnet 5 não aceita o parâmetro. Enviar quebrava as
 * QUATRO chamadas de uma vez.
 *
 * O campo segue disponível em `opts.temperature` para quem fixar, via
 * ANTHROPIC_MODEL_*, um modelo mais antigo que ainda o aceite. Só é enviado
 * quando explicitamente informado.
 *
 * A preocupação que motivou o ajuste continua válida — decomposição é
 * classificação e variação ali fragmenta o vocabulário do swipe file. A defesa
 * contra isso não é temperatura, é a canonização em src/lib/padroes.ts, que
 * funciona independente do modelo.
 */

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

/**
 * Quantas vezes tentar antes de devolver erro ao usuário.
 *
 * Saída fora do formato é ruído estatístico, não defeito permanente: o modelo
 * erra a vírgula, estoura uma contagem de palavras, devolve 7 hashtags em vez
 * de 8. Mostrar isso ao usuário como falha é transferir para ele um problema
 * que a própria chamada resolve — a segunda tentativa recebe o erro EXATO da
 * validação e quase sempre acerta. Duas tentativas, não mais: se errar de novo,
 * o problema é o prompt, e aí o erro precisa aparecer mesmo.
 */
const TENTATIVAS = 2;

export async function callClaudeStructured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: { tarefa: TarefaIA; maxTokens?: number; temperature?: number } = {
    tarefa: "roteiro",
  },
): Promise<T> {
  const mensagens: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let ultimoErro: IAFormatoInvalidoError | null = null;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const resposta = await cliente().messages.create({
      model: modeloPara(opts.tarefa),
      max_tokens: opts.maxTokens ?? 4096,
      // Omitido quando não informado: ver a nota sobre temperatura acima.
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      messages: mensagens,
    });

    const texto = resposta.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!texto) {
      // Sem texto não há o que corrigir: repete a mesma pergunta.
      ultimoErro = new IAFormatoInvalidoError(
        "resposta sem bloco de texto",
        JSON.stringify(resposta).slice(0, 1500),
      );
      continue;
    }

    try {
      const cru: unknown = JSON.parse(extrairJson(texto));
      const validado = schema.safeParse(cru);
      if (validado.success) return validado.data;

      const problemas = validado.error.issues
        .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
        .join("; ");
      ultimoErro = new IAFormatoInvalidoError(problemas, texto.slice(0, 1500));
    } catch (e) {
      ultimoErro = new IAFormatoInvalidoError(
        `JSON não parseável (${(e as Error).message})`,
        texto.slice(0, 1500),
      );
    }

    if (tentativa < TENTATIVAS) {
      // A correção vai como turno de conversa, com o erro literal da validação.
      // Repetir o prompt inteiro perderia o contexto do que exatamente falhou.
      mensagens.push({ role: "assistant", content: texto });
      mensagens.push({
        role: "user",
        content: [
          `Sua resposta foi REJEITADA pela validação: ${ultimoErro.message}`,
          "",
          "Responda de novo corrigindo exatamente esse problema.",
          "APENAS o JSON válido no formato pedido — sem markdown, sem comentários, sem explicação.",
        ].join("\n"),
      });
    }
  }

  throw ultimoErro ?? new IAFormatoInvalidoError("falha desconhecida", "");
}
