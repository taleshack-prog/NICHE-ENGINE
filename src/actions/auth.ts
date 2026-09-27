"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { credenciaisValidas, criarSessao, encerrarSessao } from "@/lib/auth";
import { falha, type ActionResult } from "./_shared";

const loginSchema = z.object({
  usuario: z.string().min(1, "Informe o usuário"),
  senha: z.string().min(1, "Informe a senha"),
  de: z.string().optional(),
});

export async function login(
  _anterior: ActionResult<undefined> | null,
  fd: FormData,
): Promise<ActionResult<undefined>> {
  const parsed = loginSchema.safeParse({
    usuario: fd.get("usuario"),
    senha: fd.get("senha"),
    de: fd.get("de") ?? undefined,
  });
  if (!parsed.success) return falha("Preencha usuário e senha.");

  const { usuario, senha, de } = parsed.data;

  if (!process.env.AUTH_USERNAME || !process.env.AUTH_PASSWORD) {
    return falha(
      "AUTH_USERNAME/AUTH_PASSWORD não configurados no .env. Em dev, use AUTH_DISABLED=true.",
    );
  }
  if (!credenciaisValidas(usuario, senha)) {
    // Mensagem única de propósito: não revelar se o usuário existe.
    return falha("Credenciais inválidas.");
  }

  await criarSessao(usuario);
  revalidatePath("/", "layout");
  redirect(de && de.startsWith("/") ? de : "/");
}

export async function logout(): Promise<void> {
  await encerrarSessao();
  revalidatePath("/", "layout");
  redirect("/login");
}
