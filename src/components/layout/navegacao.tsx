"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  KanbanSquare,
  LayoutDashboard,
  Layers,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITENS = [
  { href: "/", rotulo: "Visão geral", Icone: LayoutDashboard },
  { href: "/nichos", rotulo: "Nichos", Icone: Target },
  { href: "/swipe", rotulo: "Swipe file", Icone: Layers },
  { href: "/producao", rotulo: "Produção", Icone: KanbanSquare },
  { href: "/calendario", rotulo: "Calendário", Icone: CalendarDays },
  { href: "/analytics", rotulo: "Analytics", Icone: BarChart3 },
] as const;

export function Navegacao() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {ITENS.map(({ href, rotulo, Icone }) => {
        const ativo = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              ativo
                ? "bg-acento/15 font-medium text-acento"
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
