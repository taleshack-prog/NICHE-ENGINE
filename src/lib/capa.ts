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
const ENTRELINHA = 1.06;
// Altura máxima do bloco e número de linhas variam por papel — ver LAYOUT.

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

/** Espaços colapsados; caixa alta só onde o layout pede (ver LAYOUT). */
function normalizar(texto: string, caixaAlta: boolean): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return caixaAlta ? limpo.toLocaleUpperCase("pt-BR") : limpo;
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
 * Papel do slide no carrossel. Não é só tamanho de fonte: cada papel tem um
 * trabalho diferente na tela, e layout igual para os três faria o CTA parecer
 * mais uma informação em vez de um pedido.
 */
export type PapelSlide = "capa" | "conteudo" | "cta";

type Layout = {
  /** Frações da altura da imagem — a capa de Reel é mais alta que a de feed. */
  corpoMax: number;
  corpoMin: number;
  linhasMax: number;
  blocoMax: number;
  alinhamento: "left" | "center";
  /** Capa é lida em miniatura: caixa alta. Frase de 10 palavras em caixa alta cansa. */
  caixaAlta: boolean;
};

const LAYOUT: Record<PapelSlide, Layout> = {
  capa: {
    corpoMax: 0.15,
    corpoMin: 0.032,
    linhasMax: 3,
    blocoMax: 0.4,
    alinhamento: "left",
    caixaAlta: true,
  },
  conteudo: {
    corpoMax: 0.075,
    corpoMin: 0.026,
    linhasMax: 4,
    blocoMax: 0.36,
    alinhamento: "left",
    caixaAlta: false,
  },
  cta: {
    corpoMax: 0.095,
    corpoMin: 0.03,
    linhasMax: 3,
    blocoMax: 0.4,
    alinhamento: "center",
    caixaAlta: false,
  },
};

/**
 * Maior corpo de fonte em que o texto caiba nas linhas permitidas.
 *
 * Busca de cima para baixo em vez de corpo fixo porque "SÓ 3" e "REDE PRIMEIRO,
 * CARTEIRA DEPOIS" são ambos coverText válidos: corpo fixo deixaria o primeiro
 * minúsculo na tela ou estouraria o segundo para fora da imagem.
 */
function ajustarCorpo(
  ctx: SKRSContext2D,
  texto: string,
  maxLargura: number,
  alturaImagem: number,
  layout: Layout,
): { linhas: string[]; corpo: number } {
  const palavras = texto.split(" ");
  const maior = Math.round(alturaImagem * layout.corpoMax);
  const menor = Math.round(alturaImagem * layout.corpoMin);
  const maxAltura = alturaImagem * layout.blocoMax;

  for (let corpo = maior; corpo >= menor; corpo -= 2) {
    ctx.font = `${corpo}px "${FAMILIA}"`;
    const linhas = quebrar(ctx, palavras, maxLargura);
    if (!linhas) continue;
    if (linhas.length <= layout.linhasMax && linhas.length * corpo * ENTRELINHA <= maxAltura) {
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
  return { linhas: linhas.slice(0, layout.linhasMax), corpo: menor };
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
 * Compõe um slide e grava em public/midia/capas.
 *
 * O nome do arquivo é o hash das entradas: render repetido com as mesmas
 * entradas reaproveita o arquivo, e mudar o texto gera outro nome — o navegador
 * não serve versão velha do cache.
 */
export async function renderizarSlide(args: {
  imagemUrl: string;
  texto: string;
  formato: Formato;
  papel?: PapelSlide;
  /** Posição no carrossel, para o contador discreto. Omitir em post único. */
  ordem?: number;
  total?: number;
}): Promise<CapaRenderizada> {
  const papel = args.papel ?? "capa";
  const layout = LAYOUT[papel];
  const texto = normalizar(args.texto, layout.caixaAlta);
  if (!texto) throw new CapaError("texto vazio — não há o que escrever no slide");

  garantirFonte();

  const { largura, altura } = DIMENSOES[args.formato];
  const hash = createHash("sha1")
    .update(
      [args.imagemUrl, texto, args.formato, papel, args.ordem ?? 0, args.total ?? 0, "v2"].join(
        "\u0000",
      ),
    )
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
  const { linhas, corpo } = ajustarCorpo(ctx, texto, maxLargura, altura, layout);
  const alturaLinha = corpo * ENTRELINHA;

  if (papel === "cta") {
    // O último slide é um pedido, não uma informação: escurece a imagem inteira
    // para virar cartão. Deixá-lo igual aos do meio faz o CTA passar batido.
    ctx.fillStyle = "rgba(6,8,14,0.62)";
    ctx.fillRect(0, 0, largura, altura);
  }

  const centralizado = layout.alinhamento === "center";
  const baseY = centralizado
    ? altura / 2 + (linhas.length * alturaLinha) / 2
    : altura - altura * MARGEM_INFERIOR;
  const topoBloco = baseY - linhas.length * alturaLinha;

  if (papel !== "cta") veu(ctx, largura, altura, topoBloco);

  const x = centralizado ? largura / 2 : largura * MARGEM_X;

  // Âncora de acento: identidade de página sem caixa opaca atrás da frase.
  // Barra horizontal acima do texto na capa e no CTA (peças "de abertura e
  // fechamento"); filete vertical à esquerda nos slides de conteúdo, que é o
  // que faz o meio do carrossel parecer uma sequência e não telas soltas.
  ctx.fillStyle = ACENTO;
  if (papel === "conteudo") {
    const l = Math.max(5, Math.round(corpo * 0.12));
    ctx.fillRect(x - l * 3, topoBloco, l, linhas.length * alturaLinha - corpo * 0.18);
  } else {
    const l = Math.round(largura * 0.07);
    const a = Math.max(5, corpo * 0.075);
    ctx.fillRect(centralizado ? x - l / 2 : x, topoBloco - corpo * 0.5, l, a);
  }

  ctx.font = `${corpo}px "${FAMILIA}"`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = centralizado ? "center" : "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = Math.round(corpo * 0.22);
  ctx.shadowOffsetY = Math.round(corpo * 0.06);

  linhas.forEach((linha, i) => {
    ctx.fillText(linha, x, topoBloco + i * alturaLinha);
  });

  // Contador discreto: sinaliza que há mais slides. O Instagram mostra
  // bolinhas, mas elas somem no vídeo de preview e em repost.
  if (args.ordem && args.total && args.total > 1 && papel !== "cta") {
    const c = Math.round(altura * 0.022);
    ctx.font = `${c}px "${FAMILIA}"`;
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.textAlign = "right";
    ctx.shadowBlur = Math.round(c * 0.4);
    ctx.fillText(`${args.ordem}/${args.total}`, largura - largura * MARGEM_X, altura * 0.05);
  }

  await writeFile(arquivo, await canvas.encode("jpeg", 92));
  return { url, arquivo, largura, altura };
}

/** Atalho histórico: capa de post único. */
export async function renderizarCapa(args: {
  imagemUrl: string;
  texto: string;
  formato: Formato;
}): Promise<CapaRenderizada> {
  return renderizarSlide({ ...args, papel: "capa" });
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
