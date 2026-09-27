import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const botaoVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variante: {
        primario: "bg-acento text-fundo hover:bg-acento-forte",
        secundario: "bg-superficie-2 text-texto hover:bg-borda",
        contorno: "border border-borda bg-transparent text-texto hover:bg-superficie-2",
        fantasma: "bg-transparent text-suave hover:bg-superficie-2 hover:text-texto",
        destrutivo: "bg-erro/15 text-erro border border-erro/40 hover:bg-erro/25",
      },
      tamanho: {
        sm: "h-8 px-2.5 text-xs",
        md: "h-9 px-3.5",
        lg: "h-10 px-5",
        icone: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variante: "secundario", tamanho: "md" },
  },
);

export interface BotaoProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof botaoVariants> {
  asChild?: boolean;
}

export function Botao({
  className,
  variante,
  tamanho,
  asChild = false,
  ...props
}: BotaoProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(botaoVariants({ variante, tamanho }), className)} {...props} />;
}

export { botaoVariants };
