import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Niche Engine",
  description: "Operação de conteúdo — Instagram faceless e canal de Shorts",
};

export const viewport: Viewport = {
  themeColor: "#12151f",
};

/**
 * Layout raiz: só o documento e o Toaster.
 *
 * A casca de cada dashboard mora no layout do seu grupo — (instagram) e
 * (youtube) — porque são operações distintas, com navegação distinta. O
 * /login fica fora dos dois, sem casca nenhuma.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
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
