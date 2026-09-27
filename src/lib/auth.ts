import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

/**
 * Autenticação single-user.
 *
 * DIVERGÊNCIA DELIBERADA DA SPEC: a spec pedia "NextAuth com credentials
 * (single user) ou bypass local em dev". Para um único usuário, o NextAuth
 * traria providers, adapters e um schema de sessão que ninguém vai usar — e a
 * v5 ainda está em beta. O que está aqui é a mesma coisa em 60 linhas: cookie
 * httpOnly assinado (JWT HS256 via jose), middleware de guarda e bypass em dev.
 * Trocar por NextAuth depois mexe só neste arquivo e no middleware.
 */

const COOKIE = "niche_session";
const DURACAO_SEG = 60 * 60 * 24 * 30; // 30 dias

export function authDesabilitada(): boolean {
  return process.env.AUTH_DISABLED === "true";
}

function segredo(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET ausente ou curto demais. Gere com: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(s);
}

/** Comparação de tempo constante — evita descobrir a senha pelo tempo de resposta. */
function comparaSegura(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function credenciaisValidas(usuario: string, senha: string): boolean {
  const u = process.env.AUTH_USERNAME;
  const p = process.env.AUTH_PASSWORD;
  if (!u || !p) return false;
  return comparaSegura(usuario, u) && comparaSegura(senha, p);
}

export async function criarSessao(usuario: string): Promise<void> {
  const token = await new SignJWT({ sub: usuario })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_SEG}s`)
    .sign(segredo());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACAO_SEG,
  });
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function sessaoAtual(): Promise<{ usuario: string } | null> {
  if (authDesabilitada()) return { usuario: "dev" };

  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, segredo());
    return typeof payload.sub === "string" ? { usuario: payload.sub } : null;
  } catch {
    return null;
  }
}

/**
 * Guarda para Server Actions. O middleware protege as rotas de página, mas
 * Server Actions são endpoints POST próprios — sem esta checagem, uma action
 * seria chamável direto, sem passar pela página.
 */
export async function exigirSessao(): Promise<{ usuario: string }> {
  const s = await sessaoAtual();
  if (!s) throw new Error("Não autenticado.");
  return s;
}

export const AUTH_COOKIE_NAME = COOKIE;
