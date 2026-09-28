import type { MidiaItem } from "./json-fields";

/**
 * fal.ai — imagem (FLUX) e vídeo (Kling).
 *
 * Uma única credencial (FAL_KEY) cobre os dois: o Kling roda dentro do fal.ai
 * em `fal-ai/kling-video/...`, na fila assíncrona `queue.fal.run`.
 *
 * FASE 1: sem FAL_KEY, `gerarImagens`/`gerarVideo` lançam FalIndisponivelError
 * e a UI mostra aviso — nada quebra. A implementação real abaixo já está
 * completa e entra em operação assim que a chave existir (Fase 3).
 */

export class FalIndisponivelError extends Error {
  constructor() {
    super("FAL_KEY não configurada. Preencha no .env para habilitar geração de mídia (Fase 3).");
    this.name = "FalIndisponivelError";
  }
}

export class FalError extends Error {
  constructor(msg: string) {
    super(`fal.ai: ${msg}`);
    this.name = "FalError";
  }
}

export function falDisponivel(): boolean {
  return Boolean(process.env.FAL_KEY);
}

function headers(): HeadersInit {
  const key = process.env.FAL_KEY;
  if (!key) throw new FalIndisponivelError();
  return {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  };
}

/**
 * IDs padrão dos modelos do fal — FONTE DA VERDADE ÚNICA.
 *
 * Exportado porque o gerador dos workflows n8n (`n8n/gerar-workflows.mts`) lê
 * daqui. A URL do fal estava escrita à mão dentro do JSON do Workflow A: com
 * duas cópias, trocar de modelo no dashboard deixava a automação chamando o
 * endpoint antigo, e o sintoma — produção automática parando de madrugada —
 * não apontaria para a causa.
 *
 * `kling-video/v1/standard` era o default anterior e o fal.ai o marca como
 * **deprecated, no longer supported**. Tiers `standard` custam menos por
 * segundo: `FAL_MODEL_VIDEO` é a alavanca de custo mais direta do sistema,
 * porque o vídeo é ~90% da conta de um Reel.
 */
export const MODELOS_FAL = {
  imagem: "fal-ai/flux/dev",
  video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  voz: "fal-ai/kokoro/brazilian-portuguese",
  transcricao: "fal-ai/whisper",
  montagem: "fal-ai/ffmpeg-api/compose",
  legenda: "fal-ai/auto-caption",
} as const;

const MODELO_IMAGEM = () => process.env.FAL_MODEL_IMAGEM || MODELOS_FAL.imagem;
const MODELO_VIDEO = () => process.env.FAL_MODEL_VIDEO || MODELOS_FAL.video;
const MODELO_VOZ = () => process.env.FAL_MODEL_VOZ || MODELOS_FAL.voz;
const MODELO_TRANSCRICAO = () => process.env.FAL_MODEL_TRANSCRICAO || MODELOS_FAL.transcricao;
const MODELO_MONTAGEM = () => process.env.FAL_MODEL_MONTAGEM || MODELOS_FAL.montagem;
const MODELO_LEGENDA = () => process.env.FAL_MODEL_LEGENDA || MODELOS_FAL.legenda;

/** Segundos de clipe que o Kling entrega por chamada. Ver CUSTO_CLIPE_USD. */
export const SEGUNDOS_POR_CLIPE = 5;

/**
 * Preço de um clipe de 5s no modelo padrão (v2.5-turbo/pro, tabela do fal em
 * 28/09/2026: US$ 0,35 por 5s + US$ 0,07 por segundo extra).
 *
 * Fica aqui, e não escondido numa action, porque é o número que decide se o
 * usuário aperta o botão. Estimativa exibida antes de gastar vale mais que
 * relatório de gasto depois.
 */
export const CUSTO_CLIPE_USD = Number(process.env.FAL_CUSTO_CLIPE_USD || "0.35");

type FalImagemResposta = { images?: Array<{ url?: string }> };

/** Geração síncrona de imagens (FLUX). Retorna itens prontos para midiaPaths. */
export async function gerarImagens(
  prompt: string,
  opts: { quantidade?: number; aspecto?: "square_hd" | "portrait_4_3" | "portrait_16_9" } = {},
): Promise<MidiaItem[]> {
  const res = await fetch(`https://fal.run/${MODELO_IMAGEM()}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt,
      image_size: opts.aspecto ?? "portrait_16_9",
      num_images: opts.quantidade ?? 3,
    }),
  });

  if (!res.ok) throw new FalError(`imagem HTTP ${res.status} — ${await res.text()}`);

  const data = (await res.json()) as FalImagemResposta;
  const urls = (data.images ?? []).map((i) => i.url).filter((u): u is string => Boolean(u));
  if (urls.length === 0) throw new FalError("resposta sem imagens");

  return urls.map((url) => ({
    tipo: "imagem" as const,
    url,
    promptUsado: prompt,
    criadoEm: new Date().toISOString(),
  }));
}

type FalFilaResposta = {
  status_url?: string;
  response_url?: string;
  status?: string;
};

/**
 * Executa um modelo pela fila assíncrona e devolve o payload final.
 *
 * O polling tem teto explícito. Sem teto, um job travado deixa a Server Action
 * pendurada até o timeout da plataforma — foi exatamente o risco apontado nos
 * Workflows A e B do n8n. Cada etapa da cadeia de Reel passa por aqui, então o
 * teto é por etapa e não pela cadeia inteira.
 */
async function naFila<T>(
  modelo: string,
  corpo: unknown,
  opts: { tentativasMax?: number; intervaloMs?: number; rotulo?: string } = {},
): Promise<T> {
  const rotulo = opts.rotulo ?? modelo;
  const submit = await fetch(`https://queue.fal.run/${modelo}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(corpo),
  });

  if (!submit.ok) {
    throw new FalError(`${rotulo}: submit HTTP ${submit.status} — ${await submit.text()}`);
  }

  const fila = (await submit.json()) as FalFilaResposta;
  const statusUrl = fila.status_url;
  if (!statusUrl) throw new FalError(`${rotulo}: submit sem status_url`);

  const tentativasMax = opts.tentativasMax ?? 20;
  const intervaloMs = opts.intervaloMs ?? 15_000;

  for (let tentativa = 1; tentativa <= tentativasMax; tentativa++) {
    await new Promise((r) => setTimeout(r, intervaloMs));

    const poll = await fetch(statusUrl, { headers: headers() });
    if (!poll.ok) throw new FalError(`${rotulo}: poll HTTP ${poll.status}`);
    const estado = (await poll.json()) as FalFilaResposta;

    if (estado.status === "COMPLETED") {
      const alvo = estado.response_url ?? statusUrl;
      const final = await fetch(alvo, { headers: headers() });
      if (!final.ok) throw new FalError(`${rotulo}: resultado HTTP ${final.status}`);
      return (await final.json()) as T;
    }

    if (estado.status === "FAILED" || estado.status === "ERROR") {
      throw new FalError(`${rotulo}: job falhou (${estado.status})`);
    }
  }

  throw new FalError(
    `${rotulo}: não concluiu em ${tentativasMax} tentativas (~${Math.round((tentativasMax * intervaloMs) / 60000)} min). O job pode ainda terminar; consulte a fila do fal.ai.`,
  );
}

/** Chamada síncrona (fal.run). Só para modelos rápidos: voz e transcrição. */
async function direto<T>(modelo: string, corpo: unknown, rotulo: string): Promise<T> {
  const res = await fetch(`https://fal.run/${modelo}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new FalError(`${rotulo}: HTTP ${res.status} — ${await res.text()}`);
  return (await res.json()) as T;
}

/** Image-to-video (Kling) via fila assíncrona. */
export async function gerarVideo(
  imagemUrl: string,
  promptMovimento: string,
  opts: { tentativasMax?: number; intervaloMs?: number; segundos?: 5 | 10 } = {},
): Promise<MidiaItem> {
  const payload = await naFila<{ video?: { url?: string } }>(
    MODELO_VIDEO(),
    {
      image_url: imagemUrl,
      prompt: promptMovimento,
      duration: String(opts.segundos ?? SEGUNDOS_POR_CLIPE),
    },
    { ...opts, rotulo: "vídeo" },
  );

  const url = payload.video?.url;
  if (!url) throw new FalError("vídeo: job concluído sem video.url");
  return {
    tipo: "video",
    url,
    promptUsado: promptMovimento,
    criadoEm: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// Cadeia de Reel: voz → tempos → montagem → legenda
// ─────────────────────────────────────────────

export const VOZES_PT_BR = ["pf_dora", "pm_alex", "pm_santa"] as const;
export type VozPtBr = (typeof VOZES_PT_BR)[number];

/**
 * Narração em pt-BR (Kokoro).
 *
 * A voz é o que separa um Reel faceless de uma sequência de imagens bonitas: o
 * algoritmo mede retenção, e retenção sem áudio depende de o espectador ler a
 * tela inteira por conta própria.
 */
export async function gerarNarracao(
  texto: string,
  opts: { voz?: VozPtBr; velocidade?: number } = {},
): Promise<{ url: string }> {
  const r = await direto<{ audio?: { url?: string } }>(
    MODELO_VOZ(),
    {
      prompt: texto,
      voice: opts.voz ?? "pf_dora",
      // 1.1 porque narração de Reel é mais rápida que fala natural; acima de
      // 1.25 o Kokoro começa a comer sílabas em português.
      speed: opts.velocidade ?? 1.1,
    },
    "narração",
  );
  const url = r.audio?.url;
  if (!url) throw new FalError("narração: resposta sem audio.url");
  return { url };
}

export type TrechoFalado = { inicioMs: number; fimMs: number; texto: string };

/**
 * Transcreve a narração para saber ONDE cada frase cai no tempo.
 *
 * Parece redundante — o texto já é nosso. Não é: só a transcrição sabe quanto
 * tempo a voz levou para dizer cada trecho, e é isso que decide quantos clipes
 * o vídeo precisa e quando cada um entra. Estimar por contagem de palavras
 * dessincroniza em poucos segundos e o corte passa a cair no meio da frase.
 */
export async function transcrever(audioUrl: string): Promise<TrechoFalado[]> {
  const r = await direto<{
    chunks?: Array<{ timestamp?: [number | null, number | null]; text?: string }>;
  }>(
    MODELO_TRANSCRICAO(),
    { audio_url: audioUrl, task: "transcribe", language: "pt", chunk_level: "segment" },
    "transcrição",
  );

  const trechos = (r.chunks ?? [])
    .map((c) => ({
      inicioMs: Math.round((c.timestamp?.[0] ?? 0) * 1000),
      fimMs: Math.round((c.timestamp?.[1] ?? 0) * 1000),
      texto: (c.text ?? "").trim(),
    }))
    .filter((t) => t.fimMs > t.inicioMs);

  if (trechos.length === 0) throw new FalError("transcrição: nenhum trecho com tempo válido");
  return trechos;
}

export type ClipeNaLinha = { url: string; inicioMs: number; duracaoMs: number };

/**
 * Junta clipes e narração num único mp4 (ffmpeg-api/compose).
 *
 * `timestamp` e `duration` são em MILISSEGUNDOS na API do fal — trocar por
 * segundos não dá erro, monta um vídeo de milissegundos e devolve um arquivo
 * aparentemente válido. É o tipo de defeito que só aparece assistindo.
 */
export async function montarVideo(args: {
  clipes: ClipeNaLinha[];
  audioUrl: string;
  duracaoTotalMs: number;
}): Promise<{ videoUrl: string; thumbnailUrl: string | null }> {
  if (args.clipes.length === 0) throw new FalError("montagem: nenhum clipe");

  const payload = await naFila<{ video_url?: string; thumbnail_url?: string }>(
    MODELO_MONTAGEM(),
    {
      tracks: [
        {
          id: "video",
          type: "video",
          keyframes: args.clipes.map((c) => ({
            url: c.url,
            timestamp: c.inicioMs,
            duration: c.duracaoMs,
          })),
        },
        {
          id: "narracao",
          type: "audio",
          keyframes: [{ url: args.audioUrl, timestamp: 0, duration: args.duracaoTotalMs }],
        },
      ],
    },
    { rotulo: "montagem", intervaloMs: 10_000, tentativasMax: 30 },
  );

  const videoUrl = payload.video_url;
  if (!videoUrl) throw new FalError("montagem: resposta sem video_url");
  return { videoUrl, thumbnailUrl: payload.thumbnail_url ?? null };
}

/**
 * Queima a legenda sincronizada no vídeo (auto-caption).
 *
 * Reel sem legenda queimada perde a maioria dos espectadores, que assistem com
 * o som desligado. Os defaults do modelo são de vídeo horizontal: corpo 24 num
 * quadro de 1080×1920 sai ilegível no celular.
 */
export async function legendarVideo(
  videoUrl: string,
  opts: { corpo?: number; cor?: string; alturaRelativa?: number } = {},
): Promise<{ videoUrl: string }> {
  const payload = await naFila<{ video_url?: string }>(
    MODELO_LEGENDA(),
    {
      video_url: videoUrl,
      txt_color: opts.cor ?? "white",
      txt_font: "Arial",
      font_size: opts.corpo ?? 64,
      stroke_width: 3,
      left_align: "center",
      // 0.62 e não "center": legenda no meio exato disputa espaço com o
      // assunto do b-roll; mais abaixo que isso some atrás da UI do app.
      top_align: opts.alturaRelativa ?? 0.62,
      refresh_interval: 1.2,
      text_case: "upper",
    },
    { rotulo: "legenda", intervaloMs: 10_000, tentativasMax: 30 },
  );

  const url = payload.video_url;
  if (!url) throw new FalError("legenda: resposta sem video_url");
  return { videoUrl: url };
}

/**
 * Repetido em todo prompt de imagem. O modelo de imagem não vê as regras do
 * prompt de texto: sem isto, volta a desenhar rostos e a inventar letras.
 */
export const RESTRICOES_VISUAIS =
  "No people, no faces, no hands. No text, no letters, no numbers, no logos, no watermarks. " +
  "Clean empty negative space across the bottom third. Photographic realism, no illustration.";

/**
 * Deriva um prompt visual do roteiro. b-roll precisa de cena, não de tese.
 *
 * As três restrições abaixo saíram de defeitos observados, não de estilo:
 *
 * 1. "no people, no faces" — roteiro abstrato ("escolha a rede antes da
 *    carteira") não dá ao FLUX nenhum objeto para desenhar, e o vazio ele
 *    preenche com o lugar-comum do dataset: pessoa de camisa social olhando
 *    para um laptop. É a estética de banco de imagem que denuncia conteúdo
 *    automatizado à primeira olhada.
 * 2. "no text" reforçado três vezes — o FLUX escreve letras deformadas quando
 *    o prompt tem palavras entre aspas. Como o coverText é aplicado depois em
 *    src/lib/capa.ts, qualquer texto que o modelo inventar vira sujeira por
 *    baixo da frase de verdade.
 * 3. espaço negativo embaixo — a capa escreve no terço inferior. Sem pedir
 *    isso, o assunto cai bem onde o texto vai entrar e um tapa o outro.
 */
export function promptVisualDeRoteiro(tema: string, corpo: string): string {
  return [
    "Cinematic b-roll still photograph for a vertical social video.",
    `Subject: a concrete physical object or environment that represents: ${tema}.`,
    `Context: ${corpo.slice(0, 220)}`,
    "Show objects, tools, surfaces, textures or architecture — no people, no faces, no hands, no crowds.",
    "Absolutely no text, no letters, no numbers, no logos, no watermarks, no UI screenshots.",
    "Composition: subject in the upper two thirds, clean uncluttered negative space across the bottom third.",
    "Moody directional lighting, shallow depth of field, rich color, photographic realism, no illustration.",
  ].join(" ");
}
