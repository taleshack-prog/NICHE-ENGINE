import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const executar = promisify(execFile);

/**
 * Ponte para o pacote Python `niche`.
 *
 * POR QUE O TYPESCRIPT NÃO REIMPLEMENTA NADA: as quatro regras, a conta de
 * sílabas e a repartição da duração vivem no Python, junto da montagem. Duas
 * versões da mesma regra divergem no primeiro conserto — e aí o dashboard
 * aprovaria uma pauta que a montagem recusa. Aqui só se chama e se lê JSON.
 */

export const RAIZ = process.cwd();
export const PASTA_PAUTAS = path.join(RAIZ, "pautas");
export const PASTA_RENDERS = path.join(RAIZ, "renders");
export const PASTA_TRABALHOS = path.join(RAIZ, ".niche-jobs");

function python(): string {
  return process.env.NICHE_PYTHON ?? "python3";
}

/**
 * Nome de pauta aceito: letras, números, hífen e sublinhado.
 *
 * O slug vem da URL e vira caminho de arquivo. Sem esta checagem,
 * `/youtube/..%2f..%2fetc%2fpasswd` leria qualquer arquivo da máquina — o
 * dashboard roda local, mas "roda local" não é modelo de segurança.
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

export type FonteDaPauta = {
  apelido: string;
  titulo: string;
  onde: string;
  url: string;
};

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
  // só em `ver`
  yaml?: string;
  linha?: Plano[];
  blocos_detalhe?: BlocoDetalhe[];
};

async function niche<T>(args: string[]): Promise<T> {
  const { stdout } = await executar(python(), ["-m", "niche", ...args], {
    cwd: RAIZ,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

export async function listarEpisodios(): Promise<Episodio[]> {
  if (!existsSync(PASTA_PAUTAS)) return [];
  return niche<Episodio[]>(["listar"]);
}

export async function verEpisodio(slug: string): Promise<Episodio> {
  return niche<Episodio>(["ver", caminhoDaPauta(slug)]);
}

/** Grava a pauta e devolve a leitura nova — o linter roda no salvamento. */
export async function salvarPauta(slug: string, yaml: string): Promise<Episodio> {
  await writeFile(caminhoDaPauta(slug), yaml, "utf8");
  return verEpisodio(slug);
}

/**
 * Passa um YAML pelo linter SEM gravá-lo.
 *
 * É o que permite conferir uma proposta de IA antes de ela encostar no
 * arquivo do usuário: a proposta aparece com os achados do lado, e quem
 * decide aceitar é ele.
 */
export async function conferirYaml(yaml: string): Promise<Episodio> {
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
  return niche<Episodio>([
    "publicar", caminhoDaPauta(slug), "--dados", JSON.stringify(dados),
  ]);
}

// ── trabalhos de montagem ────────────────────────────────────────────────────

export type Trabalho = {
  id: string;
  slug: string;
  comando: string[];
  estado: "rodando" | "concluido" | "falhou";
  inicio: string;
  fim?: string;
  saida?: string;
};

/**
 * Montagem roda em processo DESTACADO, com o log em arquivo.
 *
 * O render leva uns três minutos. Segurar a requisição por esse tempo
 * significa que salvar um arquivo (e o dev server recarregando) mata a
 * montagem no meio. Processo solto + log em disco sobrevive a isso, e a tela
 * acompanha lendo o arquivo.
 */
export async function iniciarMontagem(
  slug: string,
  extras: string[] = [],
): Promise<Trabalho> {
  const arquivo = caminhoDaPauta(slug);
  await mkdir(PASTA_TRABALHOS, { recursive: true });
  await mkdir(PASTA_RENDERS, { recursive: true });

  const id = randomUUID();
  const saida = path.join(PASTA_RENDERS, `${slug}.mp4`);
  const args = ["-u", "-m", "niche", "montar", arquivo, "--saida", saida, ...extras];

  const base = path.join(PASTA_TRABALHOS, id);
  const trabalho: Trabalho = {
    id, slug, comando: [python(), ...args], estado: "rodando",
    inicio: new Date().toISOString(), saida: path.relative(RAIZ, saida),
  };
  await writeFile(`${base}.json`, JSON.stringify(trabalho, null, 2), "utf8");
  await writeFile(`${base}.log`, `$ ${python()} ${args.join(" ")}\n`, "utf8");

  // QUEM GRAVA O DESFECHO É O SHELL, não um ouvinte aqui dentro.
  //
  // Com um `filho.on("close")` o estado do trabalho dependeria do servidor
  // Next continuar vivo até o fim do render. Salvar um arquivo em dev reinicia
  // o servidor, e o trabalho ficaria "rodando" para sempre. Um arquivo `.code`
  // escrito pelo próprio shell é verdade independente de quem está no ar.
  const citar = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const linha =
    `${citar(python())} ${args.map(citar).join(" ")} >> ${citar(`${base}.log`)} 2>&1; ` +
    `echo $? > ${citar(`${base}.code`)}`;

  const filho = spawn("/bin/sh", ["-c", linha], {
    cwd: RAIZ,
    detached: true,
    stdio: "ignore",
  });
  filho.unref();
  return trabalho;
}

export async function lerTrabalho(
  id: string,
): Promise<{ trabalho: Trabalho; log: string } | null> {
  if (!/^[\w-]{10,80}$/.test(id)) return null;
  const base = path.join(PASTA_TRABALHOS, id);
  if (!existsSync(`${base}.json`)) return null;
  const trabalho = JSON.parse(await readFile(`${base}.json`, "utf8")) as Trabalho;
  const log = existsSync(`${base}.log`) ? await readFile(`${base}.log`, "utf8") : "";

  if (existsSync(`${base}.code`)) {
    const codigo = (await readFile(`${base}.code`, "utf8")).trim();
    trabalho.estado = codigo === "0" ? "concluido" : "falhou";
    if (codigo !== "0") trabalho.saida = undefined;
  }
  return { trabalho, log };
}
