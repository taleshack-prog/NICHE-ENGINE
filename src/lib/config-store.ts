import { prisma } from "./db";
import { CONFIG_KEYS } from "./domain";

/**
 * Acesso à tabela `config` — o ponto de integração mais crítico do sistema.
 *
 * O token de longa duração do Meta expira em ~60 dias e é rotacionado pelo
 * Workflow D. Se o dashboard ou os workflows lessem de $env, a automação
 * morreria silenciosamente na primeira rotação: o .env continuaria com o token
 * antigo e todo POST no Graph API voltaria 190. Por isso a fonte da verdade é
 * o banco; a env só semeia o valor inicial.
 */

export async function getConfig(chave: string): Promise<string | null> {
  const linha = await prisma.config.findUnique({ where: { chave } });
  return linha?.valor ?? null;
}

export async function setConfig(chave: string, valor: string): Promise<void> {
  await prisma.config.upsert({
    where: { chave },
    create: { chave, valor },
    update: { valor },
  });
}

/**
 * Token do Meta, com fallback de semeadura: se a tabela estiver vazia e a env
 * tiver valor, grava e devolve. A partir daí o banco manda.
 */
export async function getMetaToken(): Promise<string | null> {
  const doBanco = await getConfig(CONFIG_KEYS.metaLongLivedToken);
  if (doBanco && doBanco !== "SEU_TOKEN_INICIAL_AQUI") return doBanco;

  const daEnv = process.env.META_LONG_LIVED_TOKEN;
  if (daEnv) {
    await setConfig(CONFIG_KEYS.metaLongLivedToken, daEnv);
    return daEnv;
  }
  return null;
}

export async function getIgUserId(): Promise<string | null> {
  return (await getConfig(CONFIG_KEYS.igUserId)) ?? process.env.IG_USER_ID ?? null;
}

export async function getGraphVersion(): Promise<string> {
  return (
    (await getConfig(CONFIG_KEYS.metaGraphVersion)) ??
    process.env.META_GRAPH_VERSION ??
    "v21.0"
  );
}
