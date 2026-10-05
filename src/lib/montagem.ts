import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Montagem local com ffmpeg.
 *
 * POR QUE SUBSTITUIU A GERAÇÃO DE VÍDEO: o custo do Reel era US$ 4,20 por
 * minuto, quase tudo em clipes image-to-video de 5 segundos — a camada que
 * menos contribuía para o resultado e justamente a que foi descrita como
 * genérica. Imagem fixa com movimento de câmera programático custa centavos
 * por minuto, roda aqui, e para narração documental é a linguagem certa:
 * foto bem composta com panorâmica lenta lê como documentário; clipe de IA de
 * 5 segundos lê como automação.
 *
 * O gerativo não sai de cena — passa a ser reservado para poucos momentos de
 * impacto por vídeo, onde o movimento real vale o preço.
 */

export class MontagemError extends Error {
  constructor(msg: string) {
    super(`montagem: ${msg}`);
    this.name = "MontagemError";
  }
}

export const MOVIMENTOS = [
  "aproximar",
  "afastar",
  "esquerda",
  "direita",
  "cima",
  "baixo",
] as const;
export type MovimentoCamera = (typeof MOVIMENTOS)[number];

export type FormatoVideo = "vertical" | "horizontal";

const DIMENSOES: Record<FormatoVideo, { largura: number; altura: number }> = {
  vertical: { largura: 1080, altura: 1920 },
  horizontal: { largura: 1920, altura: 1080 },
};

const FPS = 30;

/**
 * Quanto a imagem é ampliada antes do zoompan.
 *
 * O zoompan recorta em passos inteiros de pixel; num quadro do tamanho final
 * esse passo aparece como tremor. Trabalhar acima do alvo faz o passo sumir na
 * redução. 1.5× resolve o tremor sem o custo de 2×, que dobra a área de cada
 * quadro filtrado — e o filtro, não o codificador, é o gargalo desta etapa.
 */
const SUPERAMOSTRAGEM = 1.5;

/** Fator de zoom do movimento. Acima de ~1.25 a imagem perde nitidez visível. */
const ZOOM_MAX = 1.18;
/** Zoom fixo durante as panorâmicas — é o que cria margem para deslocar. */
const ZOOM_PAN = 1.12;

export type CenaMontagem = {
  ordem: number;
  /** URL http(s) ou caminho servido pelo dashboard (/midia/...). */
  imagemUrl: string;
  duracaoMs: number;
  movimento?: MovimentoCamera;
};

export type LegendaCue = { inicioMs: number; fimMs: number; texto: string };

export async function ffmpegDisponivel(): Promise<boolean> {
  try {
    await exec("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function exigirFfmpeg(): Promise<void> {
  if (await ffmpegDisponivel()) return;
  throw new MontagemError(
    "ffmpeg não encontrado. Instale com `sudo apt install ffmpeg` (Ubuntu/Debian) ou `brew install ffmpeg` (macOS) e reinicie o servidor.",
  );
}

/**
 * Alterna o movimento quando a cena não declara um.
 *
 * Determinístico pela ordem, e não aleatório, para a mesma lista de cenas
 * montar igual duas vezes — sem isso, comparar duas tentativas de montagem
 * misturaria a mudança que você fez com a sorte do sorteio.
 */
export function movimentoPadrao(ordem: number): MovimentoCamera {
  const ciclo: MovimentoCamera[] = ["aproximar", "esquerda", "afastar", "direita", "cima", "baixo"];
  return ciclo[(ordem - 1) % ciclo.length] ?? "aproximar";
}

/**
 * Expressão de zoompan para um movimento.
 *
 * `on` é o índice do quadro de SAÍDA; com `d=1` o filtro devolve um quadro por
 * quadro de entrada, então `on` percorre 0..quadros-1 e serve de linha do tempo.
 *
 * A imagem entra ampliada 2× (ver `filtroCena`): o zoompan recorta em passos
 * inteiros de pixel, e num quadro do tamanho final esse passo aparece como
 * tremor. Com o dobro da resolução, o mesmo passo some na redução.
 */
export function expressaoZoompan(
  movimento: MovimentoCamera,
  quadros: number,
): { z: string; x: string; y: string } {
  const t = `on/${Math.max(1, quadros - 1)}`;
  const centroX = "(iw-iw/zoom)/2";
  const centroY = "(ih-ih/zoom)/2";

  switch (movimento) {
    case "aproximar":
      return { z: `1+${(ZOOM_MAX - 1).toFixed(3)}*${t}`, x: centroX, y: centroY };
    case "afastar":
      return { z: `${ZOOM_MAX}-${(ZOOM_MAX - 1).toFixed(3)}*${t}`, x: centroX, y: centroY };
    case "esquerda":
      return { z: `${ZOOM_PAN}`, x: `(iw-iw/zoom)*(1-${t})`, y: centroY };
    case "direita":
      return { z: `${ZOOM_PAN}`, x: `(iw-iw/zoom)*${t}`, y: centroY };
    case "cima":
      return { z: `${ZOOM_PAN}`, x: centroX, y: `(ih-ih/zoom)*(1-${t})` };
    case "baixo":
      return { z: `${ZOOM_PAN}`, x: centroX, y: `(ih-ih/zoom)*${t}` };
  }
}

export function filtroCena(
  movimento: MovimentoCamera,
  quadros: number,
  largura: number,
  altura: number,
): string {
  const { z, x, y } = expressaoZoompan(movimento, quadros);
  // Par: libx264 recusa dimensão ímpar em yuv420p.
  const l2 = Math.round((largura * SUPERAMOSTRAGEM) / 2) * 2;
  const a2 = Math.round((altura * SUPERAMOSTRAGEM) / 2) * 2;
  return [
    `scale=${l2}:${a2}:force_original_aspect_ratio=increase`,
    `crop=${l2}:${a2}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${largura}x${altura}:fps=${FPS}`,
    "format=yuv420p",
  ].join(",");
}

// ─────────────────────────────────────────────
// Legenda
// ─────────────────────────────────────────────

function tempoAss(ms: number): string {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Escapa o que o ASS trata como marcação. Chave é o caractere de override. */
function escaparAss(texto: string): string {
  return texto.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
}

export type EstiloLegenda = {
  fonte?: string;
  corpo?: number;
  /** Distância da base, em pixels do vídeo. */
  margemInferior?: number;
  cor?: string;
  contorno?: number;
};

/**
 * Arquivo ASS para o libass.
 *
 * ASS em vez do auto-caption do fal por controle: fonte própria (a mesma da
 * capa, então o post inteiro fala a mesma tipografia), contorno, sombra,
 * posição exata e quebra de linha decidida aqui. O serviço pago oferecia um
 * punhado de fontes e um tamanho que eu só podia acertar por tentativa.
 */
export function construirAss(
  cues: readonly LegendaCue[],
  largura: number,
  altura: number,
  estilo: EstiloLegenda = {},
): string {
  const fonte = estilo.fonte ?? "Poppins";
  const corpo = estilo.corpo ?? Math.round(altura * 0.042);
  const margem = estilo.margemInferior ?? Math.round(altura * 0.16);
  const contorno = estilo.contorno ?? Math.max(2, Math.round(corpo * 0.09));

  // &HAABBGGRR — ASS usa BGR com alfa invertido (00 = opaco).
  const branco = "&H00FFFFFF";
  const preto = "&H00000000";
  const sombra = "&H80000000";

  const cabecalho = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${largura}`,
    `PlayResY: ${altura}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Narracao,${fonte},${corpo},${branco},${branco},${preto},${sombra},-1,0,0,0,100,100,0,0,1,${contorno},${Math.round(contorno / 2)},2,${Math.round(largura * 0.08)},${Math.round(largura * 0.08)},${margem},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const linhas = cues
    .filter((c) => c.fimMs > c.inicioMs && c.texto.trim())
    .map(
      (c) =>
        `Dialogue: 0,${tempoAss(c.inicioMs)},${tempoAss(c.fimMs)},Narracao,,0,0,0,,${escaparAss(c.texto.trim().toLocaleUpperCase("pt-BR"))}`,
    );

  return [...cabecalho, ...linhas, ""].join("\n");
}

export type PalavraFalada = { inicioMs: number; fimMs: number; texto: string };

/**
 * Agrupa palavras em linhas curtas de legenda.
 *
 * Legenda de vídeo vertical cabe em 2 a 4 palavras por tela. Mandar a frase
 * inteira força o libass a quebrar em três linhas e o bloco cobre metade do
 * quadro — foi o que aconteceu com o tamanho fixo do serviço anterior.
 */
export function agruparCues(
  palavras: readonly PalavraFalada[],
  opts: { maxPalavras?: number; maxMs?: number; maxCaracteres?: number } = {},
): LegendaCue[] {
  const maxPalavras = opts.maxPalavras ?? 4;
  const maxMs = opts.maxMs ?? 2200;
  const maxCaracteres = opts.maxCaracteres ?? 26;

  const cues: LegendaCue[] = [];
  let atual: PalavraFalada[] = [];

  const fechar = () => {
    if (atual.length === 0) return;
    const primeira = atual[0];
    const ultima = atual[atual.length - 1];
    if (!primeira || !ultima) return;
    cues.push({
      inicioMs: primeira.inicioMs,
      fimMs: ultima.fimMs,
      texto: atual.map((p) => p.texto).join(" "),
    });
    atual = [];
  };

  for (const palavra of palavras) {
    const primeira = atual[0];
    const textoAtual = [...atual, palavra].map((p) => p.texto).join(" ");
    const estouraTempo = primeira ? palavra.fimMs - primeira.inicioMs > maxMs : false;

    // `atual.length >= 1` nas duas primeiras condições e `>= 2` no tempo: uma
    // linha de UMA palavra só se justifica quando a palavra seguinte não cabe,
    // nunca por estourar o relógio — fala pausada geraria uma tela por palavra.
    if (
      atual.length >= maxPalavras ||
      (atual.length >= 1 && textoAtual.length > maxCaracteres) ||
      (atual.length >= 2 && estouraTempo)
    ) {
      fechar();
    }
    atual.push(palavra);

    // Pontuação forte fecha a linha: quebrar no ponto é onde o olho já para.
    if (/[.!?…]$/.test(palavra.texto)) fechar();
  }
  fechar();

  return cues;
}

// ─────────────────────────────────────────────
// Montagem
// ─────────────────────────────────────────────

async function baixarPara(destino: string, origem: string): Promise<void> {
  if (/^https?:\/\//i.test(origem)) {
    const res = await fetch(origem);
    if (!res.ok) throw new MontagemError(`baixar ${origem}: HTTP ${res.status}`);
    await writeFile(destino, Buffer.from(await res.arrayBuffer()));
    return;
  }
  const local = path.join(process.cwd(), "public", origem.replace(/^\/+/, ""));
  if (!existsSync(local)) throw new MontagemError(`arquivo não encontrado: ${origem}`);
  await writeFile(destino, await readFile(local));
}

export type ResultadoMontagem = {
  /** URL servida pelo dashboard. */
  url: string;
  arquivo: string;
  duracaoSeg: number;
  cenas: number;
};

export async function montarVideoLocal(args: {
  cenas: readonly CenaMontagem[];
  audioUrl: string;
  legendas?: readonly LegendaCue[];
  formato?: FormatoVideo;
  estiloLegenda?: EstiloLegenda;
  /** Base do nome do arquivo final. Mesma entrada, mesmo nome. */
  chave: string;
}): Promise<ResultadoMontagem> {
  await exigirFfmpeg();
  if (args.cenas.length === 0) throw new MontagemError("nenhuma cena");

  const { largura, altura } = DIMENSOES[args.formato ?? "vertical"];
  const hash = createHash("sha1")
    .update(
      JSON.stringify({
        k: args.chave,
        c: args.cenas.map((c) => [c.imagemUrl, c.duracaoMs, c.movimento]),
        a: args.audioUrl,
        l: args.legendas?.length ?? 0,
        e: args.estiloLegenda ?? {},
        v: 1,
      }),
    )
    .digest("hex")
    .slice(0, 12);

  const destino = path.join(process.cwd(), "public", "midia", "videos");
  mkdirSync(destino, { recursive: true });
  const arquivo = path.join(destino, `${hash}.mp4`);
  const url = `/midia/videos/${hash}.mp4`;

  const tmp = await mkdtemp(path.join(os.tmpdir(), "niche-montagem-"));
  try {
    // 1. Um clipe por cena, com o movimento de câmera.
    //
    // Em paralelo porque as cenas são independentes e o zoompan é o gargalo:
    // em série, a etapa roda em tempo real (6 s de render por 6 s de tela), e
    // um vídeo de 10 minutos levaria 10 minutos só aqui. O teto é o número de
    // núcleos — acima disso as tarefas só disputam CPU entre si.
    const ordenadas = [...args.cenas].sort((a, b) => a.ordem - b.ordem);
    const partes: string[] = new Array<string>(ordenadas.length);
    const paralelas = Math.max(1, Math.min(os.cpus().length, 6));

    const renderizar = async (indice: number): Promise<void> => {
      const cena = ordenadas[indice];
      if (!cena) return;
      const img = path.join(tmp, `cena-${indice}.img`);
      await baixarPara(img, cena.imagemUrl);

      const segundos = Math.max(0.5, cena.duracaoMs / 1000);
      const quadros = Math.max(2, Math.round(segundos * FPS));
      const movimento = cena.movimento ?? movimentoPadrao(cena.ordem);
      const saida = path.join(tmp, `cena-${indice}.mp4`);

      await exec("ffmpeg", [
        "-y",
        "-loop", "1",
        "-framerate", String(FPS),
        "-t", segundos.toFixed(3),
        "-i", img,
        "-vf", filtroCena(movimento, quadros, largura, altura),
        "-frames:v", String(quadros),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        // Uma thread por processo: o paralelismo é entre cenas. Sem isto, cada
        // ffmpeg abre threads para todos os núcleos e eles brigam entre si.
        "-threads", "1",
        saida,
      ]);
      partes[indice] = saida;
    };

    let proxima = 0;
    await Promise.all(
      Array.from({ length: Math.min(paralelas, ordenadas.length) }, async () => {
        for (let i = proxima++; i < ordenadas.length; i = proxima++) {
          await renderizar(i);
        }
      }),
    );

    // 2. Emenda sem recodificar: todas as partes saíram do mesmo codec e
    //    tamanho, então o concat demuxer só costura os pacotes.
    const lista = path.join(tmp, "partes.txt");
    await writeFile(
      lista,
      partes
        .filter((p): p is string => Boolean(p))
        .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        .join("\n"),
    );
    const bruto = path.join(tmp, "bruto.mp4");
    await exec("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", bruto]);

    // 3. Áudio + legenda queimada numa passada só.
    const audio = path.join(tmp, "narracao.audio");
    await baixarPara(audio, args.audioUrl);

    const args3 = ["-y", "-i", bruto, "-i", audio];
    if (args.legendas && args.legendas.length > 0) {
      const ass = path.join(tmp, "legenda.ass");
      await writeFile(ass, construirAss(args.legendas, largura, altura, args.estiloLegenda));
      const fontes = path.join(process.cwd(), "assets", "fontes");
      args3.push(
        "-vf",
        `ass=${ass.replace(/([:\\])/g, "\\$1")}:fontsdir=${fontes.replace(/([:\\])/g, "\\$1")}`,
      );
    }
    args3.push(
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      // O vídeo é cortado pelo áudio ou o contrário, o que acabar primeiro:
      // sem isto, uma narração mais curta deixaria segundos mudos no fim.
      "-shortest",
      "-movflags", "+faststart",
      arquivo,
    );
    await exec("ffmpeg", args3, { maxBuffer: 32 * 1024 * 1024 });

    const duracaoMs = ordenadas.reduce((a, c) => a + c.duracaoMs, 0);
    return { url, arquivo, duracaoSeg: Math.round(duracaoMs / 1000), cenas: ordenadas.length };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
