import { prisma } from "./db";
import { lerHashtags, lerMidia } from "./json-fields";
import { corteTop10, scorePost } from "./scoring";
import { inicioJanela7Dias } from "./utils";

/**
 * Leituras do dashboard. Concentradas aqui para que as páginas fiquem finas e
 * para que nenhuma tela invente sua própria definição de "semana" ou de
 * "melhor post".
 */

export type PostCard = {
  id: string;
  titulo: string;
  formato: string;
  status: string;
  agendadoPara: Date | null;
  publicadoEm: Date | null;
  nicho: string;
  padrao: string | null;
  temRoteiro: boolean;
  temLegenda: boolean;
  qtdMidia: number;
  erroPublicacao: string | null;
};

function paraCard(p: {
  id: string;
  titulo: string;
  formato: string;
  status: string;
  agendadoPara: Date | null;
  publicadoEm: Date | null;
  roteiro: string | null;
  legenda: string | null;
  midiaPaths: string | null;
  erroPublicacao: string | null;
  nicho: { nome: string };
  template: { padrao: string } | null;
}): PostCard {
  return {
    id: p.id,
    titulo: p.titulo,
    formato: p.formato,
    status: p.status,
    agendadoPara: p.agendadoPara,
    publicadoEm: p.publicadoEm,
    nicho: p.nicho.nome,
    padrao: p.template?.padrao ?? null,
    temRoteiro: Boolean(p.roteiro?.trim()),
    temLegenda: Boolean(p.legenda?.trim()),
    qtdMidia: lerMidia(p.midiaPaths).length,
    erroPublicacao: p.erroPublicacao,
  };
}

const INCLUDE_CARD = {
  nicho: { select: { nome: true } },
  template: { select: { padrao: true } },
} as const;

export async function listarPostsKanban(): Promise<PostCard[]> {
  const posts = await prisma.post.findMany({
    include: INCLUDE_CARD,
    orderBy: [{ agendadoPara: "asc" }, { atualizadoEm: "desc" }],
  });
  return posts.map(paraCard);
}

export async function listarPostsAgendaveis(): Promise<PostCard[]> {
  const posts = await prisma.post.findMany({
    where: { status: { in: ["pronto", "agendado", "publicado"] } },
    include: INCLUDE_CARD,
    orderBy: [{ agendadoPara: "asc" }],
  });
  return posts.map(paraCard);
}

export type PostProducao = PostCard & {
  nichoId: string;
  templateId: string | null;
  roteiro: string | null;
  legenda: string | null;
  coverText: string | null;
  hashtagsLista: string[];
  midiaLista: ReturnType<typeof lerMidia>;
  igPostId: string | null;
};

/**
 * Carga completa dos posts para o kanban.
 *
 * Manda o post inteiro (roteiro, legenda, mídia) de uma vez em vez de buscar
 * ao abrir o editor: single-tenant com dezenas de posts, o payload é pequeno e
 * abrir o card fica instantâneo.
 */
export async function listarPostsProducao(): Promise<PostProducao[]> {
  const posts = await prisma.post.findMany({
    include: INCLUDE_CARD,
    orderBy: [{ agendadoPara: "asc" }, { atualizadoEm: "desc" }],
  });

  return posts.map((p) => ({
    ...paraCard(p),
    nichoId: p.nichoId,
    templateId: p.templateId,
    roteiro: p.roteiro,
    legenda: p.legenda,
    coverText: p.coverText,
    hashtagsLista: lerHashtags(p.hashtags),
    midiaLista: lerMidia(p.midiaPaths),
    igPostId: p.igPostId,
  }));
}

export async function obterPostCompleto(id: string) {
  const p = await prisma.post.findUnique({
    where: { id },
    include: {
      nicho: { select: { id: true, nome: true, subNicho: true, persona: true } },
      template: { select: { id: true, padrao: true, gancho: true } },
      metricas: { orderBy: { dataColeta: "desc" } },
    },
  });
  if (!p) return null;
  return {
    ...p,
    hashtagsLista: lerHashtags(p.hashtags),
    midiaLista: lerMidia(p.midiaPaths),
  };
}

export type KpisSemana = {
  postsPublicados: number;
  alcance: number;
  salvamentos: number;
  compartilhamentos: number;
  follows: number;
  melhorPost: { id: string; titulo: string; score: number } | null;
  filaHoje: PostCard[];
  agendadosAtrasados: PostCard[];
};

export async function kpisSemana(): Promise<KpisSemana> {
  const inicio = inicioJanela7Dias();
  const agora = new Date();
  const fimDoDia = new Date(agora);
  fimDoDia.setHours(23, 59, 59, 999);

  const publicados = await prisma.post.findMany({
    where: { publicadoEm: { gte: inicio } },
    include: { metricas: { orderBy: { dataColeta: "desc" }, take: 1 } },
  });

  let alcance = 0;
  let salvamentos = 0;
  let compartilhamentos = 0;
  let follows = 0;
  let melhorPost: KpisSemana["melhorPost"] = null;

  for (const p of publicados) {
    const m = p.metricas[0];
    if (!m) continue;
    alcance += m.alcance ?? 0;
    salvamentos += m.salvamentos ?? 0;
    compartilhamentos += m.compartilhamentos ?? 0;
    follows += m.followsGanhos ?? 0;

    const s = scorePost({
      alcance: m.alcance,
      salvamentos: m.salvamentos,
      compartilhamentos: m.compartilhamentos,
      retention3s: m.retention3s,
    });
    if (!melhorPost || s > melhorPost.score) {
      melhorPost = { id: p.id, titulo: p.titulo, score: s };
    }
  }

  const [filaHoje, atrasados] = await Promise.all([
    prisma.post.findMany({
      where: { status: "agendado", agendadoPara: { gte: agora, lte: fimDoDia } },
      include: INCLUDE_CARD,
      orderBy: { agendadoPara: "asc" },
    }),
    // Agendado e já venceu: o Workflow B deveria ter publicado. Se aparece
    // aqui, a automação está parada ou o token expirou — é o alerta mais útil
    // da tela inicial.
    prisma.post.findMany({
      where: { status: "agendado", agendadoPara: { lt: agora } },
      include: INCLUDE_CARD,
      orderBy: { agendadoPara: "asc" },
      take: 10,
    }),
  ]);

  return {
    postsPublicados: publicados.length,
    alcance,
    salvamentos,
    compartilhamentos,
    follows,
    melhorPost,
    filaHoje: filaHoje.map(paraCard),
    agendadosAtrasados: atrasados.map(paraCard),
  };
}

/** Série de crescimento: soma diária de follows ganhos nos últimos 30 dias. */
export async function serieCrescimento(): Promise<Array<{ dia: string; follows: number; alcance: number }>> {
  const desde = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
  desde.setHours(0, 0, 0, 0);

  const metricas = await prisma.metrica.findMany({
    where: { dataColeta: { gte: desde } },
    select: { dataRef: true, followsGanhos: true, alcance: true },
    orderBy: { dataRef: "asc" },
  });

  const mapa = new Map<string, { follows: number; alcance: number }>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(desde);
    d.setDate(d.getDate() + i);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    mapa.set(chave, { follows: 0, alcance: 0 });
  }

  for (const m of metricas) {
    const atual = mapa.get(m.dataRef);
    if (!atual) continue;
    atual.follows += m.followsGanhos ?? 0;
    atual.alcance += m.alcance ?? 0;
  }

  let acumulado = 0;
  return [...mapa.entries()].map(([dia, v]) => {
    acumulado += v.follows;
    return { dia: dia.slice(5), follows: acumulado, alcance: v.alcance };
  });
}

export async function listarNichos() {
  return prisma.nicho.findMany({
    orderBy: [{ status: "asc" }, { score: "desc" }],
    include: { _count: { select: { posts: true, templates: true } } },
  });
}

export async function listarNichosSimples() {
  return prisma.nicho.findMany({
    where: { status: { not: "descartado" } },
    select: { id: true, nome: true, subNicho: true },
    orderBy: { nome: "asc" },
  });
}

export async function listarTemplates(filtro?: { nichoId?: string; padrao?: string }) {
  return prisma.templateViral.findMany({
    where: {
      ...(filtro?.nichoId && { nichoId: filtro.nichoId }),
      ...(filtro?.padrao && { padrao: { contains: filtro.padrao } }),
    },
    include: { nicho: { select: { nome: true } }, _count: { select: { posts: true } } },
    orderBy: [{ performance: "desc" }, { criadoEm: "desc" }],
  });
}

export async function listarPadroes(): Promise<string[]> {
  const rows = await prisma.templateViral.findMany({
    select: { padrao: true },
    distinct: ["padrao"],
    orderBy: { padrao: "asc" },
  });
  return rows.map((r) => r.padrao);
}

export type LinhaAnalytics = {
  id: string;
  titulo: string;
  nicho: string;
  formato: string;
  padrao: string | null;
  publicadoEm: Date | null;
  alcance: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
  comentarios: number | null;
  follows: number | null;
  retention3s: number | null;
  score: number;
  top10: boolean;
};

export async function tabelaAnalytics(): Promise<LinhaAnalytics[]> {
  const posts = await prisma.post.findMany({
    where: { status: "publicado" },
    include: {
      nicho: { select: { nome: true } },
      template: { select: { padrao: true } },
      metricas: { orderBy: { dataColeta: "desc" }, take: 1 },
    },
    orderBy: { publicadoEm: "desc" },
  });

  const linhas = posts.map((p) => {
    const m = p.metricas[0];
    return {
      id: p.id,
      titulo: p.titulo,
      nicho: p.nicho.nome,
      formato: p.formato,
      padrao: p.template?.padrao ?? null,
      publicadoEm: p.publicadoEm,
      alcance: m?.alcance ?? null,
      salvamentos: m?.salvamentos ?? null,
      compartilhamentos: m?.compartilhamentos ?? null,
      comentarios: m?.comentarios ?? null,
      follows: m?.followsGanhos ?? null,
      retention3s: m?.retention3s ?? null,
      score: scorePost({
        alcance: m?.alcance ?? null,
        salvamentos: m?.salvamentos ?? null,
        compartilhamentos: m?.compartilhamentos ?? null,
        retention3s: m?.retention3s ?? null,
      }),
      top10: false,
    };
  });

  // Top 10% por score, não por alcance: alcance premia sorte de distribuição.
  const ordenados = [...linhas].sort((a, b) => b.score - a.score);
  const corte = corteTop10(ordenados.filter((l) => l.score > 0).length);
  const idsTop = new Set(ordenados.slice(0, corte).filter((l) => l.score > 0).map((l) => l.id));

  return linhas.map((l) => ({ ...l, top10: idsTop.has(l.id) }));
}

export async function listarTopicos() {
  return prisma.topico.findMany({
    where: { status: { not: "concluido" } },
    include: { nicho: { select: { nome: true } } },
    orderBy: [{ prioridade: "desc" }, { criadoEm: "asc" }],
    take: 20,
  });
}

export async function listarGanchos() {
  return prisma.gancho.findMany({ orderBy: [{ vitorias: "desc" }, { usos: "desc" }], take: 30 });
}

/** Estado das integrações — a home avisa o que ainda falta configurar. */
export async function statusIntegracoes() {
  const tokenMeta = await prisma.config.findUnique({
    where: { chave: "meta_long_lived_token" },
  });
  const tokenValido =
    Boolean(tokenMeta?.valor) && tokenMeta?.valor !== "SEU_TOKEN_INICIAL_AQUI";

  return {
    ia: Boolean(process.env.ANTHROPIC_API_KEY),
    fal: Boolean(process.env.FAL_KEY),
    meta: tokenValido && Boolean(process.env.IG_USER_ID || (await igUserIdConfig())),
    tokenAtualizadoEm: tokenMeta?.atualizadoEm ?? null,
  };
}

async function igUserIdConfig(): Promise<string | null> {
  const r = await prisma.config.findUnique({ where: { chave: "ig_user_id" } });
  return r?.valor || null;
}
