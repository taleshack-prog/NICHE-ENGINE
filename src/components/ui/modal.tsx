"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Modal = DialogPrimitive.Root;
export const ModalGatilho = DialogPrimitive.Trigger;
export const ModalFechar = DialogPrimitive.Close;

export function ModalConteudo({
  className,
  children,
  titulo,
  descricao,
  largura = "md",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  titulo: string;
  descricao?: string;
  largura?: "sm" | "md" | "lg";
}) {
  const larguras = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
          "max-h-[88vh] overflow-y-auto rounded-xl border border-borda bg-superficie p-5 shadow-2xl",
          larguras[largura],
          className,
        )}
        {...props}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold text-texto">
              {titulo}
            </DialogPrimitive.Title>
            {descricao ? (
              <DialogPrimitive.Description className="mt-1 text-xs text-tenue">
                {descricao}
              </DialogPrimitive.Description>
            ) : (
              /* Radix avisa no console sem Description; mantém acessível e silencioso. */
              <DialogPrimitive.Description className="sr-only">
                {titulo}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="rounded-md p-1 text-tenue transition-colors hover:bg-superficie-2 hover:text-texto"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
