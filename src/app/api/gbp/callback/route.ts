import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionValid, verify } from "@/lib/auth";
import { exchangeGbpCode, saveGbpConnection } from "@/lib/gbp";
import { panelUrl } from "@/lib/meta";
import { loadAccess } from "@/lib/users";

// Regreso del login con Google: valida el estado, cambia el código por el token de renovación y lo guarda cifrado para el
// cliente. Después la persona elige qué sedes conectar en Cuentas conectadas.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/panel/cuentas?${q}`, panelUrl()));
  const jar = await cookies();
  const expected = jar.get("gbp_state")?.value ?? "";
  jar.delete({ name: "gbp_state", path: "/api/gbp" });
  const userId = await sessionValid(db, jar.get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.redirect(new URL("/ingresar", panelUrl()));
  if ((await loadAccess(db, userId))?.role !== "admin") return NextResponse.redirect(new URL("/panel", panelUrl()));
  if (url.searchParams.get("error")) return back("error=google_cancelado");
  const state = url.searchParams.get("state") ?? "";
  const same = state.length === expected.length && expected.length > 0 && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  const signed = verify("gbp", state);
  const code = url.searchParams.get("code");
  if (!code || !same || !signed) return back("error=estado");
  try {
    const g = await exchangeGbpCode(code);
    await saveGbpConnection(db, Number(signed[0]), g.email, g.refreshToken);
  } catch (e) {
    console.error("google business: no se pudo conectar", (e as Error).message);
    return back("error=google");
  }
  return back("google=conectado");
}
