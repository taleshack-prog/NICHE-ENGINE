import { defineConfig } from "prisma/config";

/**
 * Configuração do Prisma.
 *
 * Substitui a chave `prisma` do package.json, deprecada no Prisma 6 e removida
 * no Prisma 7 (era ela que imprimia o aviso em toda execução de `prisma`).
 *
 * ATENÇÃO — a pegadinha da migração: a chave do package.json carregava o `.env`
 * automaticamente. Um arquivo de config NÃO faz isso. Sem o `loadEnvFile` abaixo,
 * `prisma migrate` falha com "Environment variable not found: DATABASE_URL"
 * mesmo com o .env no lugar certo.
 *
 * Usamos `process.loadEnvFile` (nativo do Node ≥ 20.12) em vez de `dotenv` para
 * não adicionar dependência só por isto.
 */
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env ausente (CI, produção): as variáveis vêm do próprio ambiente.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
