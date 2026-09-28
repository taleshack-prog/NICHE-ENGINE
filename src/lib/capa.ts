import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { FORMATOS, type Formato } from "./domain";
import type { MidiaItem } from "./json-fields";

/**
 * Queima o `coverText` na imagem.
 *
 * POR QUE ISTO EXISTE: o prompt de copy gerava `coverText`, o Zod validava as 6
 * palavras, o editor mostrava o contador — e nada escrevia o texto na imagem. O
 * usuário terminava o ciclo inteiro no dashboard e ia para o Canva aplicar a
 * frase à mão. Com o Instagram conectado o problema continuaria: o Graph API
 * publica o arquivo que você der, e o arquivo saía sem texto.
 *
 * Quem lê "a IA gera a capa" espera receber a capa, não os ingredientes dela.
 *
 * Também padroniza a proporção. O FLUX devolve 1024×1024 ou 16:9; o Instagram
 * corta para 4:5 no feed e 9:16 no Reel. Compor no tamanho canônico faz o
 * enquadramento ser decidido aqui, com o texto já posicionado, em vez de ser
 * decidido pelo corte automático do app depois do upload.
 */

export class CapaError extends Error {
  constructor(msg: string) {
    super(`capa: ${msg}`);
    this.name = "CapaError";
  }
}

/**
 * Tamanhos canônicos do Instagram. Feed aceita até 4:5 (1080×1350) e Reel é
 * 9:16 (1080×1920) — sair desses números é entregar imagem que o app vai
 * recortar por conta própria, possivelmente cortando o texto.
 */
const DIMENSOES: Record<Formato, { largura: number; altura: number }> = {
  carrossel: { largura: 1080, altura: 1350 },
  static: { largura: 1080, altura: 1350 },
  reel: { largura: 1080, altura: 1920 },
};

const FAMILIA = "CapaNiche";

/** Acento do tema (--color-acento, oklch(0.72 0.16 225)) em sRGB. */
const ACENTO = "#3ab4ef";

const MARGEM_X = 0.08; // fração da largura
const MARGEM_INFERIOR = 0.09; // fração da altura
const LARGURA_TEXTO = 0.84; // fração da largura
const ALTURA_MAX_BLOCO = 0.4; // fração da altura
const LINHAS_MAX = 3;
const ENTRELINHA = 1.06;

let fonteRegistrada: string | null = null;

/**
 * Registra a fonte uma vez por processo.
 *
 * A fonte vai VERSIONADA em assets/fontes por um motivo prático: depender de
 * fontconfig significaria capa diferente em cada máquina — e, numa máquina sem
 * a família pedida, texto renderizado em retângulos vazios sem erro nenhum.
 * Falha silenciosa em imagem é a pior espécie: só aparece depois de publicada.
 */
function garantirFonte(): string {
  if (fonteRegistrada) return fonteRegistrada;

  const candidatos = [
    process.env.CAPA_FONTE,
    path.join(process.cwd(), "assets", "fontes", "Poppins-Bold.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ].filter((c): c is string => Boolean(c));

  for (const caminho of candidatos) {
    if (existsSync(caminho) && GlobalFonts.registerFromPath(caminho, FAMILIA)) {
      fonteRegistrada = caminho;
      return caminho;
    }
  }

  throw new CapaError(
    `nenhuma fonte encontrada. Esperava assets/fontes/Poppins-Bold.ttf no repositório — restaure o arquivo ou aponte CAPA_FONTE no .env para um .ttf/.otf.`,
  );
}

/** MAIÚSCULAS e espaços colapsados. Capa de Reel não tem espaço para caixa mista. */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
}

/**
 * Quebra em linhas que caibam na largura. Devolve null se alguma palavra
 * sozinha não couber — sinal para o chamador tentar um corpo menor.
 */
function quebrar(ctx: SKRSContext2D, palavras: string[], maxLargura: number): string[] | null {
  const linhas: string[] = [];
  let atual = "";

  for (const palavra of palavras) {
    if (ctx.measureText(palavra).width > maxLargura) return null;
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (ctx.measureText(tentativa).width <= maxLargura) {
      atual = tentativa;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/**
 * Maior corpo de fonte em que o texto caiba em até LINHAS_MAX linhas.
 *
 * Busca de cima para baixo em vez de corpo fixo porque "SÓ 3" e "REDE PRIMEIRO,
 * CARTEIRA DEPOIS" são ambos coverText válidos: corpo fixo deixaria o primeiro
 * minúsculo na tela ou estouraria o segundo para fora da imagem.
 */
function ajustarCorpo(
  ctx: SKRSContext2D,
  texto: string,
  maxLargura: number,
  maxAltura: number,
  alturaImagem: number,
): { linhas: string[]; corpo: number } {
  const palavras = texto.split(" ");
  const maior = Math.round(alturaImagem * 0.15);
  const menor = Math.round(alturaImagem * 0.032);

  for (let corpo = maior; corpo >= menor; corpo -= 2) {
    ctx.font = `${corpo}px "${FAMILIA}"`;
    const linhas = quebrar(ctx, palavras, maxLargura);
    if (!linhas) continue;
    if (linhas.length <= LINHAS_MAX && linhas.length * corpo * ENTRELINHA <= maxAltura) {
      return { linhas, corpo };
    }
  }

  // Último recurso: palavra única gigantesca (URL, hashtag colada). Parte por
  // caractere no corpo mínimo em vez de devolver imagem sem texto.
  ctx.font = `${menor}px "${FAMILIA}"`;
  const linhas: string[] = [];
  let atual = "";
  for (const ch of texto) {
    const tentativa = atual + ch;
    if (ctx.measureText(tentativa).width > maxLargura && atual) {
      linhas.push(atual);
      atual = ch;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return { linhas: linhas.slice(0, LINHAS_MAX), corpo: menor };
}

/** Escurece a base para o texto branco ter contraste sobre qualquer imagem. */
function veu(ctx: SKRSContext2D, largura: number, altura: number, topoBloco: number): void {
  const inicio = Math.max(0, topoBloco - altura * 0.16);
  const grad = ctx.createLinearGradient(0, inicio, 0, altura);
  grad.addColorStop(0, "rgba(6,8,14,0)");
  grad.addColorStop(0.45, "rgba(6,8,14,0.55)");
  grad.addColorStop(1, "rgba(6,8,14,0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, inicio, largura, altura - inicio);
}

async function baixar(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new CapaError(`não consegui baixar a imagem base (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function bytesDaImagem(urlOuCaminho: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(urlOuCaminho)) return baixar(urlOuCaminho);

  // URL servida pelo próprio dashboard (/midia/...): lê do disco. Passar pela
  // rede exigiria saber a porta e o host do próprio processo.
  const local = path.join(process.cwd(), "public", urlOuCaminho.replace(/^\/+/, ""));
  if (!existsSync(local)) throw new CapaError(`imagem base não encontrada: ${urlOuCaminho}`);
  const { readFile } = await import("node:fs/promises");
  return readFile(local);
}

export type CapaRenderizada = {
  /** URL servida pelo dashboard, ex.: /midia/capas/abc123.jpg */
  url: string;
  /** Caminho absoluto no disco — usado pelos testes e pelo download direto. */
  arquivo: string;
  largura: number;
  altura: number;
};

/**
 * Compõe a capa e grava em public/midia/capas.
 *
 * O nome do arquivo é o hash das entradas (imagem + texto + formato): render
 * repetido com as mesmas entradas reaproveita o arquivo, e mudar o coverText
 * gera outro nome — o navegador não serve versão velha do cache.
 */
export async function renderizarCapa(args: {
  imagemUrl: string;
  texto: string;
  formato: Formato;
}): Promise<CapaRenderizada> {
  const texto = normalizar(args.texto);
  if (!texto) throw new CapaError("coverText vazio — gere a copy ou escreva o texto de capa antes");

  garantirFonte();

  const { largura, altura } = DIMENSOES[args.formato];
  const hash = createHash("sha1")
    .update(`${args.imagemUrl}\u0000${texto}\u0000${args.formato}\u0000v1`)
    .digest("hex")
    .slice(0, 12);

  const diretorio = path.join(process.cwd(), "public", "midia", "capas");
  mkdirSync(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, `${hash}.jpg`);
  const url = `/midia/capas/${hash}.jpg`;

  if (existsSync(arquivo)) return { url, arquivo, largura, altura };

  const base = await loadImage(await bytesDaImagem(args.imagemUrl));
  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext("2d");

  // cover-fit: preenche o quadro e corta o excesso, centralizado. Nunca
  // deforma — imagem esticada é o tipo de detalhe que denuncia automação.
  const escala = Math.max(largura / base.width, altura / base.height);
  const lDes = base.width * escala;
  const aDes = base.height * escala;
  ctx.drawImage(base, (largura - lDes) / 2, (altura - aDes) / 2, lDes, aDes);

  const maxLargura = largura * LARGURA_TEXTO;
  const { linhas, corpo } = ajustarCorpo(ctx, texto, maxLargura, altura * ALTURA_MAX_BLOCO, altura);

  const alturaLinha = corpo * ENTRELINHA;
  const baseY = altura - altura * MARGEM_INFERIOR;
  const topoBloco = baseY - linhas.length * alturaLinha;

  veu(ctx, largura, altura, topoBloco);

  // Barra de acento: âncora visual que dá identidade de página e separa o texto
  // da imagem sem precisar de caixa opaca atrás da frase.
  const x = largura * MARGEM_X;
  ctx.fillStyle = ACENTO;
  ctx.fillRect(x, topoBloco - corpo * 0.5, Math.round(largura * 0.07), Math.max(5, corpo * 0.075));

  ctx.font = `${corpo}px "${FAMILIA}"`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = Math.round(corpo * 0.22);
  ctx.shadowOffsetY = Math.round(corpo * 0.06);

  linhas.forEach((linha, i) => {
    ctx.fillText(linha, x, topoBloco + i * alturaLinha);
  });

  await writeFile(arquivo, await canvas.encode("jpeg", 92));
  return { url, arquivo, largura, altura };
}

export function formatoValido(f: string): Formato {
  return (FORMATOS as readonly string[]).includes(f) ? (f as Formato) : "carrossel";
}

/** Devolve um item-capa à imagem original que o originou. */
function reverterCapa(m: MidiaItem): MidiaItem {
  if (m.papel !== "capa") return m;
  const { papel: _papel, origemUrl, ...resto } = m;
  return origemUrl ? { ...resto, url: origemUrl } : resto;
}

/**
 * Coloca a capa na primeira posição e garante que exista só uma.
 *
 * A capa SUBSTITUI a imagem de origem em vez de somar a ela: num carrossel,
 * manter as duas publicaria o mesmo visual duas vezes — uma com texto e a
 * seguinte sem — que é exatamente o erro que denuncia post montado no
 * automático. A origem fica registrada no item para poder voltar atrás.
 */
export function aplicarCapa(
  lista: readonly MidiaItem[],
  origemUrl: string,
  capaUrl: string,
): MidiaItem[] {
  const base = lista.map(reverterCapa);
  const indice = base.findIndex((m) => m.url === origemUrl);
  const original = indice >= 0 ? base[indice] : undefined;

  const capa: MidiaItem = {
    tipo: "imagem",
    url: capaUrl,
    papel: "capa",
    origemUrl,
    ...(original?.promptUsado ? { promptUsado: original.promptUsado } : {}),
    criadoEm: new Date().toISOString(),
  };

  return [capa, ...base.filter((_, i) => i !== indice)];
}
