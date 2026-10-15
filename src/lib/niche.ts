import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const executar = promisify(execFile);

/**
 * Ponte para o pacote Python `niche`, em dois modos.
 *
 * LOCAL: chama `python3 -m niche` como subprocesso, contra as pastas do
 * repositório. É como roda na sua máquina, e é o que permite trabalhar sem
 * serviço nenhum no ar.
 *
 * REMOTO: fala HTTP com o serviço do Railway, quando NICHE_API_URL existe. A
 * Vercel não tem Python com pillow, não tem ffmpeg e tem disco somente
 * leitura — as três coisas de que o dashboard precisa.
 *
 * Os dois modos atendem à MESMA interface, e nenhum deles reimplementa regra:
 * de um lado e do outro quem decide é o mesmo código Python.
 */

export const RAIZ = process.cwd();
export const PASTA_PAUTAS = path.join(RAIZ, "pautas");
export const PASTA_RENDERS = path.join(RAIZ, "renders");
export const PASTA_TRABALHOS = path.join(RAIZ, ".niche-jobs");
const PASTA_ACERVO = path.join(RAIZ, "acervo");

export function remoto(): string | null {
  const url = process.env.NICHE_API_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

function python(): string {
  return process.env.NICHE_PYTHON ?? "python3";
}

/**
 * Nome de pauta aceito: letras, números, hífen e sublinhado.
 *
 * O slug vem da URL e vira caminho de arquivo. Sem esta checagem,
 * `/youtube/..%2f..%2fetc%2fpasswd` leria qualquer arquivo da máquina — e
 * "roda local" não é modelo de segurança.
 */
export function caminhoDaPauta(slug: string): string {
  if (!/^[\w-]{1,80}$/.test(slug)) throw new Error(`nome de pauta inválido: ${slug}`);
  const arquivo = path.join(PASTA_PAUTAS, `${slug}.yml`);
  if (path.dirname(arquivo) !== PASTA_PAUTAS) throw new Error("caminho fora de pautas/");
  return arquivo;
}

export type Achado = {
  grau: "erro" | "aviso";
  regra: string;
  onde: string;
  texto: string;
};

export type FonteDaPauta = { apelido: string; titulo: string; onde: string; url: string };

export type Plano = {
  bloco: number;
  inicio: number;
  segundos: number;
  visual: string;
  legenda: string;
  linhas: number;
};

export type BlocoDetalhe = {
  n: number;
  fala: string;
  fonte: string | null;
  segundos: number;
  cortes: string[];
};

export type Episodio = {
  slug: string;
  arquivo: string;
  titulo: string;
  angulo?: string;
  estado: "rascunho" | "pronta" | "montada" | "publicada" | "quebrada";
  defeito?: string;
  blocos?: number;
  planos?: number;
  segundos?: number;
  segundos_falados?: number;
  fontes?: FonteDaPauta[];
  achados: Achado[];
  erros: number;
  avisos: number;
  publicacao?: Record<string, unknown>;
  video?: string | null;
  precisa_obras?: boolean;
  precisa_ilustracoes?: boolean;
  yaml?: string;
  linha?: Plano[];
  blocos_detalhe?: BlocoDetalhe[];
};

export type Trabalho = {
  id: string;
  slug: string;
  estado: "rodando" | "concluido" | "falhou";
  inicio: string;
  fim?: string;
  saida?: string | null;
};

export type ItemDoAcervo = { nome: string; bytes: number };
export type Acervo = { obras: ItemDoAcervo[]; ilustra: ItemDoAcervo[]; audio: ItemDoAcervo[] };

export type OpcoesDeMontagem = {
  voz?: string;
  trilha?: string;
  tempos?: string;
  forcar?: boolean;
};

// ── remoto ───────────────────────────────────────────────────────────────────

/**
 * Erro do serviço com o código HTTP preservado.
 *
 * Sem isto o chamador só recebia uma string e precisava procurar número no
 * meio da frase para distinguir "já existe" (409, que tem conserto óbvio) de
 * uma falha de verdade.
 */
export class ServicoError extends Error {
  readonly status: number;
  constructor(status: number, motivo: string) {
    super(`serviço respondeu ${status}: ${motivo}`);
    this.name = "ServicoError";
    this.status = status;
  }
}

/**
 * O slug que aparece numa mensagem de "já existe".
 *
 * O serviço devolve o caminho do arquivo (`/dados/pautas/<slug>.yml`) e o
 * modo local devolve o do repositório; o que interessa nos dois é o nome,
 * para a tela poder oferecer "abrir o episódio" em vez de só reclamar.
 */
export function slugDaMensagem(mensagem: string): string | null {
  return /([A-Za-z0-9][A-Za-z0-9-]*)\.ya?ml/.exec(mensagem)?.[1] ?? null;
}

/**
 * O slug, quando o erro de criação foi "esse episódio já existe".
 *
 * Vale para as duas pontas: o serviço devolve 409, e o `niche novo` local
 * falha com FileExistsError. Devolve null quando a falha é outra.
 */
export function pautaExistente(e: unknown): string | null {
  const msg = (e as Error)?.message ?? "";
  const eh409 = e instanceof ServicoError ? e.status === 409 : /já existe|FileExists/i.test(msg);
  return eh409 ? slugDaMensagem(msg) : null;
}

async function chamar<T>(
  rota: string,
  init: RequestInit = {},
  base = remoto()!,
): Promise<T> {
  const r = await fetch(`${base}${rota}`, {
    ...init,
    cache: "no-store",
    headers: {
      // .trim(): colar o token arrasta espaço ou quebra de linha com
      // frequência, e o resultado é um 401 que parece token errado.
      Authorization: `Bearer ${(process.env.NICHE_TOKEN ?? "").trim()}`,
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    // O detail do FastAPI é onde está a frase útil; sem isto a tela mostraria
    // "500" e o motivo ficaria no log do Railway, onde ninguém olha.
    const corpo = await r.text();
    let motivo = corpo.slice(0, 300);
    try {
      motivo = (JSON.parse(corpo).detail ?? motivo) as string;
    } catch {
      /* resposta não-JSON: fica o texto cru */
    }
    throw new ServicoError(r.status, motivo);
  }
  return (await r.json()) as T;
}

// ── local ────────────────────────────────────────────────────────────────────

async function niche<T>(args: string[]): Promise<T> {
  const { stdout } = await executar(python(), ["-m", "niche", ...args], {
    cwd: RAIZ,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

function comAcervo(args: string[], ep: Episodio): string[] {
  const extras: string[] = [];
  if (ep.precisa_obras) extras.push("--obras", path.join(PASTA_ACERVO, "obras"));
  if (ep.precisa_ilustracoes) extras.push("--ilustra", path.join(PASTA_ACERVO, "ilustra"));
  return [...args, ...extras];
}

// ── a interface ──────────────────────────────────────────────────────────────

export async function listarEpisodios(): Promise<Episodio[]> {
  if (remoto()) return chamar<Episodio[]>("/pautas");
  if (!existsSync(PASTA_PAUTAS)) return [];
  return niche<Episodio[]>(["listar"]);
}

export async function verEpisodio(slug: string): Promise<Episodio> {
  if (remoto()) return chamar<Episodio>(`/pautas/${slug}`);
  return niche<Episodio>(["ver", caminhoDaPauta(slug)]);
}

/** Grava a pauta e devolve a leitura nova — o linter roda no salvamento. */
export async function salvarPauta(slug: string, yaml: string): Promise<Episodio> {
  if (remoto()) {
    return chamar<Episodio>(`/pautas/${slug}`, {
      method: "PUT",
      body: JSON.stringify({ yaml }),
    });
  }
  await writeFile(caminhoDaPauta(slug), yaml, "utf8");
  return verEpisodio(slug);
}

export async function criarPauta(titulo: string, slug?: string): Promise<Episodio> {
  if (remoto()) {
    return chamar<Episodio>("/pautas", {
      method: "POST",
      body: JSON.stringify({ titulo, slug }),
    });
  }
  const args = ["novo", titulo, "--json"];
  if (slug) args.push("--slug", slug);
  return niche<Episodio>(args);
}

export async function apagarPauta(slug: string): Promise<void> {
  if (remoto()) {
    await chamar(`/pautas/${slug}`, { method: "DELETE" });
    return;
  }
  await unlink(caminhoDaPauta(slug));
}

/**
 * Passa um YAML pelo linter SEM gravá-lo.
 *
 * É o que permite conferir uma proposta de IA antes de ela encostar no
 * arquivo: a proposta aparece com os achados do lado, e quem decide é o autor.
 */
export async function conferirYaml(yaml: string): Promise<Episodio> {
  if (remoto()) {
    return chamar<Episodio>("/conferir", { method: "POST", body: JSON.stringify({ yaml }) });
  }
  const filho = spawn(python(), ["-m", "niche", "ver", "-"], { cwd: RAIZ });
  filho.stdin.write(yaml);
  filho.stdin.end();
  const partes: string[] = [];
  const erros: string[] = [];
  filho.stdout.on("data", (d) => partes.push(String(d)));
  filho.stderr.on("data", (d) => erros.push(String(d)));
  const codigo: number = await new Promise((ok) => filho.on("close", (c) => ok(c ?? 1)));
  if (codigo !== 0) throw new Error(erros.join("").trim() || "pauta ilegível");
  return JSON.parse(partes.join("")) as Episodio;
}

/** Grava o bloco `publicacao:` preservando comentários e formatação. */
export async function gravarPublicacao(
  slug: string,
  dados: Record<string, unknown>,
): Promise<Episodio> {
  if (remoto()) {
    return chamar<Episodio>(`/pautas/${slug}/publicar`, {
      method: "POST",
      body: JSON.stringify(dados),
    });
  }
  return niche<Episodio>([
    "publicar", caminhoDaPauta(slug), "--dados", JSON.stringify(dados),
  ]);
}

// ── montagem ─────────────────────────────────────────────────────────────────

/**
 * O render leva minutos: roda destacado, com o log em arquivo.
 *
 * Quem grava o desfecho é o shell, num arquivo `.code`, e não um ouvinte no
 * Node: salvar qualquer arquivo em dev reinicia o servidor, e o trabalho
 * ficaria "rodando" para sempre.
 */
export async function iniciarMontagem(
  slug: string,
  opcoes: OpcoesDeMontagem = {},
): Promise<Trabalho> {
  if (remoto()) {
    return chamar<Trabalho>(`/pautas/${slug}/montar`, {
      method: "POST",
      body: JSON.stringify(opcoes),
    });
  }

  const ep = await verEpisodio(slug);
  if (ep.erros > 0 && !opcoes.forcar) {
    throw new Error(`a pauta tem ${ep.erros} erro(s) de linter`);
  }
  await mkdir(PASTA_TRABALHOS, { recursive: true });
  await mkdir(PASTA_RENDERS, { recursive: true });

  const id = randomUUID();
  const saida = path.join(PASTA_RENDERS, `${slug}.mp4`);
  let args = ["-u", "-m", "niche", "montar", caminhoDaPauta(slug), "--saida", saida];
  args = comAcervo(args, ep);
  for (const [bandeira, nome] of [["--voz", opcoes.voz], ["--trilha", opcoes.trilha]] as const) {
    if (!nome) continue;
    const alvo = path.join(PASTA_ACERVO, "audio", path.basename(nome));
    if (!existsSync(alvo)) throw new Error(`não achei ${bandeira} ${nome}`);
    args.push(bandeira, alvo);
  }
  if (opcoes.tempos) args.push("--tempos", opcoes.tempos);
  if (opcoes.forcar) args.push("--forcar");

  const base = path.join(PASTA_TRABALHOS, id);
  const trabalho: Trabalho = {
    id, slug, estado: "rodando", inicio: new Date().toISOString(),
    saida: path.relative(RAIZ, saida),
  };
  await writeFile(`${base}.json`, JSON.stringify(trabalho, null, 2), "utf8");
  await writeFile(`${base}.log`, `$ ${python()} ${args.join(" ")}\n`, "utf8");

  const citar = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const linha =
    `${citar(python())} ${args.map(citar).join(" ")} >> ${citar(`${base}.log`)} 2>&1; ` +
    `echo $? > ${citar(`${base}.code`)}`;
  const filho = spawn("/bin/sh", ["-c", linha], {
    cwd: RAIZ, detached: true, stdio: "ignore",
  });
  filho.unref();
  return trabalho;
}

export async function lerTrabalho(
  id: string,
): Promise<{ trabalho: Trabalho; log: string } | null> {
  if (remoto()) {
    try {
      return await chamar<{ trabalho: Trabalho; log: string }>(`/trabalhos/${id}`);
    } catch {
      return null;
    }
  }
  if (!/^[\w-]{10,80}$/.test(id)) return null;
  const base = path.join(PASTA_TRABALHOS, id);
  if (!existsSync(`${base}.json`)) return null;
  const trabalho = JSON.parse(await readFile(`${base}.json`, "utf8")) as Trabalho;
  const log = existsSync(`${base}.log`) ? await readFile(`${base}.log`, "utf8") : "";
  if (existsSync(`${base}.code`)) {
    const codigo = (await readFile(`${base}.code`, "utf8")).trim();
    trabalho.estado = codigo === "0" ? "concluido" : "falhou";
    if (codigo !== "0") trabalho.saida = null;
  }
  return { trabalho, log };
}

// ── acervo ───────────────────────────────────────────────────────────────────

export async function lerAcervo(): Promise<Acervo> {
  if (remoto()) return chamar<Acervo>("/acervo");
  const { readdir, stat } = await import("node:fs/promises");
  const saida: Acervo = { obras: [], ilustra: [], audio: [] };
  for (const tipo of ["obras", "ilustra", "audio"] as const) {
    const pasta = path.join(PASTA_ACERVO, tipo);
    await mkdir(pasta, { recursive: true });
    const nomes = await readdir(pasta);
    saida[tipo] = await Promise.all(
      nomes.sort().map(async (nome) => ({
        nome,
        bytes: (await stat(path.join(pasta, nome))).size,
      })),
    );
  }
  return saida;
}

export async function enviarAoAcervo(
  tipo: "obras" | "ilustra" | "audio",
  nome: string,
  dados: ArrayBuffer,
): Promise<ItemDoAcervo> {
  if (remoto()) {
    const forma = new FormData();
    forma.append("arquivo", new Blob([dados]), nome);
    return chamar<ItemDoAcervo>(`/acervo/${tipo}`, { method: "POST", body: forma });
  }
  const pasta = path.join(PASTA_ACERVO, tipo);
  await mkdir(pasta, { recursive: true });
  const limpo = path.basename(nome);
  await writeFile(path.join(pasta, limpo), Buffer.from(dados));
  return { nome: limpo, bytes: dados.byteLength };
}

export async function removerDoAcervo(
  tipo: "obras" | "ilustra" | "audio",
  nome: string,
): Promise<void> {
  if (remoto()) {
    await chamar(`/acervo/${tipo}/${encodeURIComponent(nome)}`, { method: "DELETE" });
    return;
  }
  await unlink(path.join(PASTA_ACERVO, tipo, path.basename(nome)));
}

/** URL do mp4 para o <video>, no serviço ou na rota local. */
export async function buscarVideo(slug: string, range: string | null): Promise<Response> {
  const base = remoto();
  if (!base) throw new Error("sem serviço remoto");
  return fetch(`${base}/renders/${slug}.mp4`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${(process.env.NICHE_TOKEN ?? "").trim()}`,
      ...(range ? { Range: range } : {}),
    },
  });
}
