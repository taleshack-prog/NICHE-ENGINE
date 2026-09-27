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

const MODELO_IMAGEM = () => process.env.FAL_MODEL_IMAGEM || "fal-ai/flux/dev";
const MODELO_VIDEO = () =>
  process.env.FAL_MODEL_VIDEO || "fal-ai/kling-video/v1/standard/image-to-video";

type FalImagemResposta = { images?: Array<{ url?: string }> };

/** Geração síncrona de imagens (FLUX). Retorna itens prontos para midiaPaths. */
export async function gerarImagens(
  prompt: string,
  opts: { quantidade?: number; aspecto?: "square_hd" | "portrait_16_9" } = {},
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
  video?: { url?: string };
};

/**
 * Image-to-video (Kling) via fila assíncrona.
 *
 * O polling tem teto explícito. Sem teto, um job travado deixa a Server Action
 * pendurada até o timeout da plataforma — foi exatamente o risco apontado nos
 * Workflows A e B do n8n.
 */
export async function gerarVideo(
  imagemUrl: string,
  promptMovimento: string,
  opts: { tentativasMax?: number; intervaloMs?: number } = {},
): Promise<MidiaItem> {
  const submit = await fetch(`https://queue.fal.run/${MODELO_VIDEO()}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ image_url: imagemUrl, prompt: promptMovimento }),
  });

  if (!submit.ok) throw new FalError(`submit HTTP ${submit.status} — ${await submit.text()}`);

  const fila = (await submit.json()) as FalFilaResposta;
  const statusUrl = fila.status_url;
  if (!statusUrl) throw new FalError("submit sem status_url");

  const tentativasMax = opts.tentativasMax ?? 20;
  const intervaloMs = opts.intervaloMs ?? 15_000;

  for (let tentativa = 1; tentativa <= tentativasMax; tentativa++) {
    await new Promise((r) => setTimeout(r, intervaloMs));

    const poll = await fetch(statusUrl, { headers: headers() });
    if (!poll.ok) throw new FalError(`poll HTTP ${poll.status}`);
    const estado = (await poll.json()) as FalFilaResposta;

    if (estado.status === "COMPLETED") {
      const alvo = estado.response_url ?? statusUrl;
      const final = await fetch(alvo, { headers: headers() });
      const payload = (await final.json()) as FalFilaResposta;
      const url = payload.video?.url;
      if (!url) throw new FalError("job concluído sem video.url");
      return {
        tipo: "video",
        url,
        promptUsado: promptMovimento,
        criadoEm: new Date().toISOString(),
      };
    }

    if (estado.status === "FAILED" || estado.status === "ERROR") {
      throw new FalError(`job falhou (${estado.status})`);
    }
  }

  throw new FalError(
    `vídeo não concluiu em ${tentativasMax} tentativas (~${Math.round((tentativasMax * intervaloMs) / 60000)} min). O job pode ainda terminar; consulte a fila do fal.ai.`,
  );
}

/** Deriva um prompt visual do roteiro. b-roll precisa de cena, não de tese. */
export function promptVisualDeRoteiro(tema: string, corpo: string): string {
  return [
    "Cinematic b-roll still for a short vertical social video.",
    `Subject: ${tema}.`,
    `Scene cues: ${corpo.slice(0, 280)}`,
    "No text, no logos, no watermarks, no readable letters.",
    "Moody natural lighting, shallow depth of field, photographic realism.",
  ].join(" ");
}
