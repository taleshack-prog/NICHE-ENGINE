import Link from "next/link";
import { ArrowLeftRight, Clapperboard } from "lucide-react";
import { logout } from "@/actions/auth";
import { NavegacaoYoutube } from "@/components/layout/navegacao-youtube";
import { Botao } from "@/components/ui/botao";
import { Selo } from "@/components/ui/selo";
import { authDesabilitada } from "@/lib/auth";
import { LogOut } from "lucide-react";

/**
 * Casca do dashboard do canal — separada da do Instagram de propósito.
 *
 * São duas operações diferentes: lá é página faceless no Instagram, com
 * nichos, swipe file e fila de publicação; aqui é episódio de Shorts, que
 * nasce de uma pauta em arquivo e termina num mp4. Misturar as navegações
 * faria o usuário procurar "Nichos" quando quer "Episódios". O acento roxo
 * existe para não haver dúvida de em qual dos dois se está.
 */
export function CascaYoutube({
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
          <span className="grid size-7 place-items-center rounded-md bg-roxo/20 text-roxo">
            <Clapperboard className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Canal</p>
            <p className="text-[10px] uppercase tracking-wide text-tenue">
              episódios de shorts
            </p>
          </div>
        </div>

        <div className="px-2 pb-3">
          <NavegacaoYoutube />
        </div>

        <div className="border-t border-borda px-2 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-tenue transition-colors hover:bg-superficie-2 hover:text-suave"
          >
            <ArrowLeftRight className="size-3.5" />
            Dashboard do Instagram
          </Link>
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
