import { z } from "zod";
import { exigirSessao } from "@/lib/auth";

/**
 * Contrato único de retorno das Server Actions.
 *
 * Actions nunca lançam para o cliente: um throw em Server Action chega no
 * browser como "An error occurred in the Server Components render" e o usuário
 * não descobre nada. Aqui o erro volta tipado e a UI mostra a mensagem real.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; erro: string; campos?: Record<string, string[]> };

export function sucesso(): ActionResult<undefined>;
export function sucesso<T>(data: T): ActionResult<T>;
export function sucesso<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function falha(erro: string, campos?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, erro, campos };
}

/** Converte um ZodError em mapa campo → mensagens, para exibir junto ao input. */
export function errosDeCampo(e: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of e.issues) {
    const chave = issue.path.join(".") || "_";
    (out[chave] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Envelope de toda action: exige sessão, valida a entrada com Zod e traduz
 * qualquer exceção em ActionResult. Erros inesperados vão para o log do
 * servidor com stack completo; o cliente recebe a mensagem, não o stack.
 */
export async function acao<I, O>(
  schema: z.ZodType<I>,
  entrada: unknown,
  fn: (dados: I) => Promise<O>,
): Promise<ActionResult<O>> {
  try {
    await exigirSessao();
  } catch {
    return falha("Sessão expirada. Recarregue a página e entre novamente.");
  }

  const parsed = schema.safeParse(entrada);
  if (!parsed.success) {
    return falha("Dados inválidos.", errosDeCampo(parsed.error));
  }

  try {
    return sucesso(await fn(parsed.data));
  } catch (e) {
    const err = e as Error & { bruto?: string; code?: string };
    console.error("[action]", err.name, err.message, err.bruto ? `\nbruto: ${err.bruto}` : "");

    // Violação de unique do Prisma: mensagem útil em vez de P2002.
    if (err.code === "P2002") return falha("Registro duplicado.");
    if (err.code === "P2025") return falha("Registro não encontrado.");

    return falha(err.message || "Erro inesperado.");
  }
}

/** Formulário HTML → objeto simples, tratando string vazia como ausente. */
export function doFormData(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") {
      out[k] = v.trim() === "" ? undefined : v;
    }
  }
  return out;
}

export const idSchema = z.string().min(1, "id obrigatório");
