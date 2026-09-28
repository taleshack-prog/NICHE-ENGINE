import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Raiz explícita do Turbopack. Sem isto o Next sobe a árvore de diretórios
// procurando um lockfile e encontra o de ~/Downloads, imprimindo
// "ignored package-lock.json ... outside the current Git repository" a cada dev.
const raiz = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: raiz,
  },
  typescript: {
    // Erros de tipo devem quebrar o build. Nunca ligar ignoreBuildErrors.
    ignoreBuildErrors: false,
  },
  experimental: {
    // Server Actions do dashboard manipulam payloads de roteiro/legenda longos.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // Prisma Client e @napi-rs/canvas carregam binários nativos (.node) por require
  // dinâmico. Empacotá-los quebra a resolução do binário em runtime.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@napi-rs/canvas"],
};

export default nextConfig;
