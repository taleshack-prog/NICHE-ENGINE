import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-xl border border-borda bg-superficie", className)}
      {...props}
    />
  );
}

export function CardCabecalho({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
}

export function CardTitulo({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3 className={cn("text-sm font-semibold tracking-tight text-texto", className)} {...props} />
  );
}

export function CardDescricao({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-tenue", className)} {...props} />;
}

export function CardConteudo({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}

export function CardRodape({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-borda p-3", className)}
      {...props}
    />
  );
}
