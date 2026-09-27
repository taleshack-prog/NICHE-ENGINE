import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md border border-borda bg-superficie-2 px-3 py-2 text-sm text-texto placeholder:text-tenue disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(base, "h-9", className)} {...props} />;
}

export function AreaTexto({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(base, "min-h-20 resize-y leading-relaxed", className)} {...props} />;
}

export function Selecao({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(base, "h-9 appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Rotulo({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1 block text-xs font-medium text-suave", className)}
      {...props}
    />
  );
}

export function Campo({
  rotulo,
  erro,
  dica,
  children,
  htmlFor,
}: {
  rotulo: string;
  erro?: string[] | undefined;
  dica?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <Rotulo htmlFor={htmlFor}>{rotulo}</Rotulo>
      {children}
      {dica && !erro?.length ? <p className="mt-1 text-[11px] text-tenue">{dica}</p> : null}
      {erro?.length ? <p className="mt-1 text-[11px] text-erro">{erro.join(" · ")}</p> : null}
    </div>
  );
}
