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
  /**
   * "capa" = imagem com o texto de capa queimado. Só uma por post, e sempre na
   * primeira posição: no carrossel é o slide que o feed mostra, no Reel vai
   * como `cover_url` do container.
   * "slide" = demais telas de um carrossel gerado, com texto próprio.
   *
   * Etapas intermediárias do Reel, guardadas para a geração ser RETOMÁVEL:
   * "narracao" (áudio), "cena" (imagem de uma cena), "clipe" (vídeo de uma
   * cena) e "final" (vídeo montado e legendado). Um Reel leva minutos e várias
   * chamadas pagas; sem marcar o que já ficou pronto, cada nova tentativa
   * pagaria tudo de novo desde a voz.
   */
  papel: z.enum(["capa", "slide", "narracao", "cena", "clipe", "final"]).optional(),
  /** Posição no carrossel ou na linha do tempo do Reel (1 = primeira). */
  ordem: z.number().int().min(1).max(20).optional(),
  /** Início na linha do tempo do Reel, em ms. Só nas cenas e clipes. */
  inicioMs: z.number().int().min(0).optional(),
  /** Duração na linha do tempo do Reel, em ms. */
  duracaoMs: z.number().int().min(1).optional(),
  /** Texto queimado nesta imagem — permite re-renderizar sem chamar a IA de novo. */
  texto: z.string().max(300).optional(),
  /**
   * Imagem original que gerou a capa. Guardar isso é o que permite trocar o
   * coverText e renderizar de novo sem ter que pagar outra geração no fal.
   */
  origemUrl: z.string().optional(),
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
