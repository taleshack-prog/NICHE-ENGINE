import { z } from "zod";
import { TIPOS_MIDIA } from "./domain";

/**
 * Campos guardados como TEXT contendo JSON (`hashtags`, `midia_paths`,
 * `estrutura`). Ver o comentário no topo de prisma/schema.prisma para o porquê.
 *
 * Toda leitura passa por aqui: um campo corrompido devolve o fallback em vez de
 * derrubar a página. Toda escrita também, para nunca gravar `[object Object]`.
 */

export const midiaItemSchema = z.object({
  tipo: z.enum(TIPOS_MIDIA),
  url: z.string().min(1),
  promptUsado: z.string().optional(),
  criadoEm: z.string().optional(),
});
export type MidiaItem = z.infer<typeof midiaItemSchema>;

export const estruturaSchema = z.object({
  hook: z.string().optional(),
  retention: z.string().optional(),
  loop: z.string().optional(),
  cta: z.string().optional(),
});
export type Estrutura = z.infer<typeof estruturaSchema>;

function parseOr<T>(raw: string | null | undefined, schema: z.ZodType<T>, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function lerMidia(raw: string | null | undefined): MidiaItem[] {
  return parseOr(raw, z.array(midiaItemSchema), []);
}

export function gravarMidia(itens: MidiaItem[]): string {
  return JSON.stringify(z.array(midiaItemSchema).parse(itens));
}

export function lerHashtags(raw: string | null | undefined): string[] {
  // Tolerante de propósito: o Workflow A gravou '[]' e um humano pode ter
  // colado "#a #b #c" direto no editor. Aceita os dois.
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return parseOr(trimmed, z.array(z.string()), []);
  }
  return trimmed
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
}

export function gravarHashtags(tags: string[]): string {
  const normalizadas = tags
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  return JSON.stringify(normalizadas);
}

export function lerEstrutura(raw: string | null | undefined): Estrutura {
  return parseOr(raw, estruturaSchema, {});
}

export function gravarEstrutura(e: Estrutura): string {
  return JSON.stringify(estruturaSchema.parse(e));
}
