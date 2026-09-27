import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  // O Prisma Client usa require dinâmico do engine: mantém fora do bundle do server.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
