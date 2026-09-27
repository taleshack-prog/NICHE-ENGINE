import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Casca } from "@/components/layout/casca";
import { sessaoAtual } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Niche Engine",
  description: "Operação de páginas de nicho faceless no Instagram",
};

export const viewport: Viewport = {
  themeColor: "#12151f",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessao = await sessaoAtual();

  return (
    <html lang="pt-BR">
      <body>
        {/* Sem sessão o middleware já redirecionou; aqui é a rota /login,
            que precisa renderizar sem a casca do app. */}
        {sessao ? <Casca usuario={sessao.usuario}>{children}</Casca> : children}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "var(--color-superficie-2)",
              border: "1px solid var(--color-borda)",
              color: "var(--color-texto)",
            },
          }}
        />
      </body>
    </html>
  );
}
