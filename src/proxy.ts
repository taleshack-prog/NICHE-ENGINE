import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Guarda de rotas.
 *
 * Arquivo `proxy.ts` (não `middleware.ts`): o Next.js 16 renomeou a convenção —
 * `middleware` ainda funciona, mas emite aviso de deprecação no build.
 *
 * Roda no Edge Runtime, então não pode importar src/lib/auth (que usa
 * node:crypto). A verificação do JWT é feita aqui com jose, que é isomórfico.
 */

const COOKIE = "niche_session";
const PUBLICAS = ["/login", "/api/auth"];

export default async function proxy(req: NextRequest) {
  if (process.env.AUTH_DISABLED === "true") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLICAS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  const segredo = process.env.AUTH_SECRET;

  if (token && segredo) {
    try {
      await jwtVerify(token, new TextEncoder().encode(segredo));
      return NextResponse.next();
    } catch {
      // token inválido ou expirado → cai no redirect
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("de", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|midia).*)"],
};
