/**
 * Domínio do Niche Engine: constantes e tipos que a UI, as Server Actions e os
 * prompts compartilham. Manter isto num único lugar impede a deriva clássica
 * entre a coluna `status` (String livre no banco) e as colunas do kanban.
 */

export const POST_STATUS = [
  "rascunho",
  "produzindo",
  "pronto",
  "agendado",
  "publicado",
] as const;
export type PostStatus = (typeof POST_STATUS)[number];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  rascunho: "Rascunho",
  produzindo: "Produzindo",
  pronto: "Pronto",
  agendado: "Agendado",
  publicado: "Publicado",
};

export const FORMATOS = ["carrossel", "reel", "static"] as const;
export type Formato = (typeof FORMATOS)[number];

export const FORMATO_LABEL: Record<Formato, string> = {
  carrossel: "Carrossel",
  reel: "Reel",
  static: "Imagem única",
};

export const NICHO_STATUS = ["candidato", "ativo", "descartado"] as const;
export type NichoStatus = (typeof NICHO_STATUS)[number];

export const NICHO_STATUS_LABEL: Record<NichoStatus, string> = {
  candidato: "Candidato",
  ativo: "Ativo",
  descartado: "Descartado",
};

/** Categorias de gancho — espelham o enum do prompt de decomposição viral. */
export const CATEGORIAS_GANCHO = [
  "pergunta",
  "negacao",
  "numero",
  "story",
  "contraste",
] as const;
export type CategoriaGancho = (typeof CATEGORIAS_GANCHO)[number];

export const TOPICO_STATUS = ["pendente", "em_producao", "concluido"] as const;
export type TopicoStatus = (typeof TOPICO_STATUS)[number];

/** Tipos de mídia anexável a um post. */
export const TIPOS_MIDIA = ["imagem", "video"] as const;
export type TipoMidia = (typeof TIPOS_MIDIA)[number];

/**
 * Ordem de importância das métricas para o algoritmo do Instagram.
 * Usada no ranking e repetida no prompt do relatório semanal — se mudar aqui,
 * mude no prompt.
 */
export const PESO_METRICAS = {
  salvamentos: 6,
  compartilhamentos: 5,
  retention3s: 4,
  alcance: 3,
  comentarios: 2,
} as const;

/** Chaves conhecidas da tabela `config`. */
export const CONFIG_KEYS = {
  metaLongLivedToken: "meta_long_lived_token",
  igUserId: "ig_user_id",
  metaGraphVersion: "meta_graph_version",
} as const;
