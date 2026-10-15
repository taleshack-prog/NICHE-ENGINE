"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ListVideo, Images } from "lucide-react";
import { cn } from "@/lib/utils";

const ITENS = [
  { href: "/youtube", rotulo: "Episódios", Icone: ListVideo, exato: true },
  { href: "/youtube/acervo", rotulo: "Acervo", Icone: Images, exato: false },
  { href: "/youtube/manual", rotulo: "Como funciona", Icone: BookOpen, exato: false },
] as const;

export function NavegacaoYoutube() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {ITENS.map(({ href, rotulo, Icone, exato }) => {
        const ativo = exato ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              ativo
                ? "bg-roxo/15 font-medium text-roxo"
                : "text-suave hover:bg-superficie-2 hover:text-texto",
            )}
          >
            <Icone className="size-4" />
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
