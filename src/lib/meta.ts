import { getGraphVersion, getIgUserId, getMetaToken } from "./config-store";
import type { MidiaItem } from "./json-fields";

/**
 * Meta Graph API — Instagram Content Publishing.
 *
 * FASE 1: stub. `publicarNoInstagram` lança MetaIndisponivelError quando falta
 * token/IG_USER_ID, e a Server Action `publicarPost` trata isso como aviso.
 * A implementação real (Fase 5) está escrita aqui e espelha o Workflow B, para
 * que dashboard e n8n tenham o mesmo comportamento.
 *
 * Pré-requisitos que não são código:
 *  - conta Instagram Business vinculada a uma página do Facebook;
 *  - app aprovado com a permissão instagram_content_publish;
 *  - publicação de teste validada no Graph API Explorer ANTES de automatizar.
 */

export class MetaIndisponivelError extends Error {
  constructor(faltando: string) {
    super(
      `Publicação automática indisponível: ${faltando}. Configure na Fase 5 — até lá, agende manualmente pelo Meta Business Suite.`,
    );
    this.name = "MetaIndisponivelError";
  }
}

export class MetaError extends Error {
  constructor(msg: string) {
    super(`Graph API: ${msg}`);
    this.name = "MetaError";
  }
}

export async function metaDisponivel(): Promise<boolean> {
  return Boolean((await getMetaToken()) && (await getIgUserId()));
}

type Credenciais = { token: string; igUserId: string; versao: string };

async function credenciais(): Promise<Credenciais> {
  const token = await getMetaToken();
  if (!token) throw new MetaIndisponivelError("token de longa duração ausente na tabela `config`");
  const igUserId = await getIgUserId();
  if (!igUserId) throw new MetaIndisponivelError("IG_USER_ID ausente");
  return { token, igUserId, versao: await getGraphVersion() };
}

async function graphPost(
  c: Credenciais,
  caminho: string,
  body: Record<string, string | boolean>,
): Promise<{ id: string }> {
  const url = new URL(`https://graph.facebook.com/${c.versao}/${caminho}`);
  url.searchParams.set("access_token", c.token);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string; code?: number } };

  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    // 190 = token inválido/expirado: o sintoma exato da rotação esquecida.
    const dica =
      data.error?.code === 190
        ? " — token expirado; rode o Workflow D ou atualize a chave meta_long_lived_token na tabela config"
        : "";
    throw new MetaError(`${caminho}: ${msg}${dica}`);
  }
  if (!data.id) throw new MetaError(`${caminho}: resposta sem id`);
  return { id: data.id };
}

/** Aguarda o container sair de IN_PROGRESS. Vídeo leva 2-5 min; teto obrigatório. */
async function aguardarContainer(
  c: Credenciais,
  containerId: string,
  tentativasMax = 12,
  intervaloMs = 20_000,
): Promise<void> {
  for (let i = 1; i <= tentativasMax; i++) {
    const url = new URL(`https://graph.facebook.com/${c.versao}/${containerId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", c.token);

    const res = await fetch(url);
    const data = (await res.json()) as { status_code?: string; status?: string };

    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new MetaError(`container ${containerId}: ${data.status_code} — ${data.status ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  throw new MetaError(
    `container ${containerId} não finalizou em ${tentativasMax} tentativas — verifique se a URL da mídia é pública e não expirou`,
  );
}

/**
 * Absolutiza a URL da mídia para o Graph API.
 *
 * O Meta BAIXA o arquivo do lado dele: quem precisa alcançar a URL é o
 * servidor da Meta, não o seu navegador. A capa gerada em src/lib/capa.ts
 * mora em `/midia/capas/...`, servida pelo próprio dashboard — que, em
 * localhost, não existe para o mundo externo.
 *
 * Falhar aqui, com o nome da variável, é melhor que deixar o container
 * pendurado em IN_PROGRESS por 4 minutos até estourar o teto de polling com
 * uma mensagem genérica.
 */
function urlPublica(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;

  const base = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    throw new MetaError(
      `a mídia "${u}" é um arquivo local do dashboard e o Meta precisa baixá-la pela internet. Defina APP_PUBLIC_URL no .env com um endereço público (deploy ou túnel, ex.: cloudflared/ngrok) — ou publique este post manualmente.`,
    );
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(base)) {
    throw new MetaError(
      `APP_PUBLIC_URL está apontando para ${base}, que só existe nesta máquina. O Meta baixa a mídia do lado dele e não alcança localhost.`,
    );
  }
  return `${base}/${u.replace(/^\/+/, "")}`;
}

export type ResultadoPublicacao = { igPostId: string };

export async function publicarNoInstagram(args: {
  formato: string;
  legenda: string;
  midia: MidiaItem[];
}): Promise<ResultadoPublicacao> {
  const c = await credenciais();
  const { formato, legenda, midia } = args;

  let containerId: string;

  if (formato === "carrossel") {
    // Ordem explícita quando existe: um carrossel fora de ordem conta a história
    // ao contrário, e a ordem do array já foi mexida por edições de capa.
    // Exclui as cenas do Reel: são imagens, mas são matéria-prima do vídeo.
    // Publicá-las como slides mandaria ao ar o storyboard em vez do post.
    const imagens = midia
      .filter((m) => m.tipo === "imagem" && m.papel !== "cena")
      .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
    if (imagens.length < 2) {
      throw new MetaError(`carrossel exige no mínimo 2 imagens (recebeu ${imagens.length})`);
    }
    if (imagens.length > 10) {
      throw new MetaError(`carrossel aceita no máximo 10 imagens (recebeu ${imagens.length})`);
    }

    const filhos: string[] = [];
    for (const img of imagens) {
      const filho = await graphPost(c, `${c.igUserId}/media`, {
        image_url: urlPublica(img.url),
        is_carousel_item: true,
      });
      filhos.push(filho.id);
    }

    const pai = await graphPost(c, `${c.igUserId}/media`, {
      media_type: "CAROUSEL",
      children: filhos.join(","),
      caption: legenda,
    });
    containerId = pai.id;
  } else if (formato === "reel") {
    // `final` primeiro: a lista também guarda os clipes de cada cena, e pegar
    // o primeiro vídeo publicaria 5 segundos de b-roll mudo no lugar do Reel.
    const video =
      midia.find((m) => m.papel === "final" && m.tipo === "video") ??
      midia.find((m) => m.tipo === "video");
    if (!video) throw new MetaError("Reel exige um item de mídia do tipo vídeo");

    // A capa entra como `cover_url`, não como primeiro quadro: é ela que o feed
    // e a aba Reels exibem antes do play. Sem isto o Instagram escolhe um frame
    // qualquer do vídeo e o coverText não aparece em lugar nenhum.
    const capa = midia.find((m) => m.papel === "capa");

    const container = await graphPost(c, `${c.igUserId}/media`, {
      media_type: "REELS",
      video_url: urlPublica(video.url),
      caption: legenda,
      share_to_feed: true,
      ...(capa ? { cover_url: urlPublica(capa.url) } : {}),
    });
    containerId = container.id;
  } else {
    const imagem = midia.find((m) => m.tipo === "imagem");
    if (!imagem) throw new MetaError("post estático exige uma imagem");

    const container = await graphPost(c, `${c.igUserId}/media`, {
      image_url: urlPublica(imagem.url),
      caption: legenda,
    });
    containerId = container.id;
  }

  await aguardarContainer(c, containerId);

  const publicado = await graphPost(c, `${c.igUserId}/media_publish`, {
    creation_id: containerId,
  });
  return { igPostId: publicado.id };
}

type InsightsResposta = {
  data?: Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }>;
  error?: { message?: string };
};

export type InsightsPost = {
  alcance: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
  comentarios: number | null;
  interacoes: number | null;
};

/** Coleta insights de um post publicado. Espelha o Workflow C. */
export async function coletarInsights(igPostId: string): Promise<InsightsPost> {
  const c = await credenciais();
  const url = new URL(`https://graph.facebook.com/${c.versao}/${igPostId}/insights`);
  url.searchParams.set("metric", "reach,saved,shares,comments,total_interactions");
  url.searchParams.set("access_token", c.token);

  const res = await fetch(url);
  const data = (await res.json()) as InsightsResposta;
  if (!res.ok || data.error) {
    throw new MetaError(`insights ${igPostId}: ${data.error?.message ?? `HTTP ${res.status}`}`);
  }

  // A API alterna entre `values[0].value` e `total_value.value` conforme a
  // métrica e a versão — aceitar os dois evita null silencioso.
  const pegar = (nome: string): number | null => {
    const m = data.data?.find((x) => x.name === nome);
    return m?.values?.[0]?.value ?? m?.total_value?.value ?? null;
  };

  return {
    alcance: pegar("reach"),
    salvamentos: pegar("saved"),
    compartilhamentos: pegar("shares"),
    comentarios: pegar("comments"),
    interacoes: pegar("total_interactions"),
  };
}

/**
 * Troca o token atual por um novo de longa duração (o que o Workflow D faz).
 * Exposto aqui para poder ser disparado do dashboard em emergência.
 */
export async function renovarToken(): Promise<string> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new MetaIndisponivelError("META_APP_ID/META_APP_SECRET ausentes");

  const atual = await getMetaToken();
  if (!atual) throw new MetaIndisponivelError("não há token atual para trocar");

  const versao = await getGraphVersion();
  const url = new URL(`https://graph.facebook.com/${versao}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", atual);

  const res = await fetch(url);
  const data = (await res.json()) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !data.access_token) {
    throw new MetaError(`renovação falhou: ${data.error?.message ?? `HTTP ${res.status}`}`);
  }
  return data.access_token;
}
