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
