import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const selo = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
  {
    variants: {
      tom: {
        neutro: "border-borda bg-superficie-2 text-suave",
        acento: "border-acento/40 bg-acento/15 text-acento",
        ok: "border-ok/40 bg-ok/15 text-ok",
        alerta: "border-alerta/40 bg-alerta/15 text-alerta",
        erro: "border-erro/40 bg-erro/15 text-erro",
        roxo: "border-roxo/40 bg-roxo/15 text-roxo",
      },
    },
    defaultVariants: { tom: "neutro" },
  },
);

export type SeloTom = NonNullable<VariantProps<typeof selo>["tom"]>;

export function Selo({
  className,
  tom,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof selo>) {
  return <span className={cn(selo({ tom }), className)} {...props} />;
}

/** Cor por status de post — mesma paleta no kanban, no calendário e na home. */
export const TOM_STATUS: Record<string, SeloTom> = {
  rascunho: "neutro",
  produzindo: "alerta",
  pronto: "acento",
  agendado: "roxo",
  publicado: "ok",
};

export const TOM_NICHO_STATUS: Record<string, SeloTom> = {
  candidato: "alerta",
  ativo: "ok",
  descartado: "neutro",
};
