"use client";

import { useActionState } from "react";
import { login } from "@/actions/auth";
import { Botao } from "@/components/ui/botao";
import { Campo, Input } from "@/components/ui/campos";
import { Card, CardConteudo } from "@/components/ui/card";
import type { ActionResult } from "@/actions/_shared";
import { Zap } from "lucide-react";

export function FormularioLogin({ de }: { de: string }) {
  const [estado, acao, pendente] = useActionState<ActionResult<undefined> | null, FormData>(
    login,
    null,
  );

  return (
    <Card className="w-full max-w-sm">
      <CardConteudo className="p-6">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-acento/20 text-acento">
            <Zap className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="font-semibold">Niche Engine</p>
            <p className="text-[11px] text-tenue">acesso restrito</p>
          </div>
        </div>

        <form action={acao} className="space-y-3">
          <input type="hidden" name="de" value={de} />
          <Campo rotulo="Usuário" htmlFor="usuario">
            <Input id="usuario" name="usuario" autoComplete="username" required autoFocus />
          </Campo>
          <Campo rotulo="Senha" htmlFor="senha">
            <Input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              required
            />
          </Campo>

          {estado && !estado.ok ? (
            <p className="rounded-md border border-erro/40 bg-erro/10 px-3 py-2 text-xs text-erro">
              {estado.erro}
            </p>
          ) : null}

          <Botao type="submit" variante="primario" className="w-full" disabled={pendente}>
            {pendente ? "Entrando…" : "Entrar"}
          </Botao>
        </form>
      </CardConteudo>
    </Card>
  );
}
