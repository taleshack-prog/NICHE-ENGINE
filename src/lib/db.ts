import { PrismaClient } from "@prisma/client";

/**
 * Singleton do Prisma.
 *
 * Em dev o Next recompila a cada edição e cada recompilação criaria um novo
 * PrismaClient — o pool de conexões estoura em poucos minutos. Guardar a
 * instância no globalThis resolve; em produção o módulo carrega uma vez só.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Falha cedo e com instrução quando a DATABASE_URL não é PostgreSQL.
 *
 * Sem isto o sintoma é um erro do Prisma de 15 linhas ("the URL must start with
 * the protocol postgresql://") disparado DENTRO do render de uma página, com
 * stack de chunk do Turbopack no meio — não parece erro de configuração.
 *
 * Nunca imprime a URL inteira: ela carrega a senha do banco. Só o esquema.
 */
function conferirDatabaseUrl(): void {
  const url = process.env.DATABASE_URL;
  // Ausente: deixa o Prisma reclamar: a mensagem dele para isso já é clara.
  if (!url) return;
  if (/^postgres(ql)?:\/\//.test(url)) return;

  // Só o esquema (o trecho antes do primeiro ":"). Note que "file:./dev.db" NÃO
  // tem "://" — daí o corte ser no ":" e não em "://".
  const corte = url.indexOf(":");
  const esquema = corte > 0 ? `${url.slice(0, corte)}:…` : "(valor sem esquema)";
  throw new Error(
    [
      `DATABASE_URL não é uma URL PostgreSQL (recebido: ${esquema}).`,
      "Este projeto usa PostgreSQL em dev e em prod — ver o comentário do datasource",
      "em prisma/schema.prisma. Suba o banco e corrija o .env:",
      "",
      "  npm run db:up",
      '  DATABASE_URL="postgresql://niche:niche@localhost:5433/niche?schema=public"',
      "",
      'Se você rodou o projeto antes da migração para PostgreSQL, o valor antigo "file:./dev.db"',
      "ainda está no seu .env.",
    ].join("\n"),
  );
}

conferirDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
