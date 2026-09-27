// ─────────────────────────────────────────────────────────────────────────────
// ESLint 9 (flat config).
//
// `next lint` foi REMOVIDO no Next.js 16 — o script `npm run lint` chama o
// ESLint diretamente. Sem este arquivo o ESLint 9 aborta com
// "couldn't find an eslint.config file".
// ─────────────────────────────────────────────────────────────────────────────

import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "prisma/migrations/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Regra de qualidade da spec: proibido `any`.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Server Actions passam funções para componentes cliente de propósito.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
];

export default config;
