import { logout } from "@/actions/auth";
import { Navegacao } from "@/components/layout/navegacao";
import { Botao } from "@/components/ui/botao";
import { Selo } from "@/components/ui/selo";
import { authDesabilitada } from "@/lib/auth";
import { LogOut, Zap } from "lucide-react";

/**
 * Casca do app: barra lateral no desktop, barra horizontal no mobile.
 * Server Component — a navegação em si é cliente (precisa do pathname).
 */
export function Casca({
  children,
  usuario,
}: {
  children: React.ReactNode;
  usuario: string;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-borda bg-superficie lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid size-7 place-items-center rounded-md bg-acento/20 text-acento">
            <Zap className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Niche Engine</p>
            <p className="text-[10px] uppercase tracking-wide text-tenue">operação faceless</p>
          </div>
        </div>

        <div className="px-2 pb-3 lg:px-2">
          <Navegacao />
        </div>

        <div className="hidden border-t border-borda px-4 py-3 lg:block">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-suave">{usuario}</span>
            {authDesabilitada() ? <Selo tom="alerta">auth off</Selo> : null}
          </div>
          {!authDesabilitada() ? (
            <form action={logout}>
              <Botao variante="fantasma" tamanho="sm" className="w-full justify-start">
                <LogOut className="size-3.5" />
                Sair
              </Botao>
            </form>
          ) : null}
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}

export function TituloPagina({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        {descricao ? <p className="mt-1 text-sm text-tenue">{descricao}</p> : null}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </header>
  );
}
