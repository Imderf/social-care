import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClient } from "@/lib/data";
import { SESSION_COOKIE, sessionValid, sign } from "@/lib/auth";
import { gbpLoginUrl, missingGbpConfig } from "@/lib/gbp";
import { panelUrl } from "@/lib/meta";
import { loadAccess } from "@/lib/users";

// «Conectar con Google» en Cuentas conectadas: para el cliente en el que está la persona del panel. Solo administradores.
// La persona inicia sesión en Google, acepta el permiso y la plataforma detecta sola sus fichas. El estado va firmado y en
// una cookie de 10 minutos.
export async function GET() {
  const back = (q: string) => NextResponse.redirect(new URL(`/panel/cuentas?${q}`, panelUrl()));
  const jar = await cookies();
  const userId = await sessionValid(db, jar.get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.redirect(new URL("/ingresar?volver=%2Fpanel%2Fcuentas", panelUrl()));
  if ((await loadAccess(db, userId))?.role !== "admin") return NextResponse.redirect(new URL("/panel", panelUrl()));
  if (missingGbpConfig().length) return back("error=google_config");
  const client = await getClient(db, Number(jar.get("cliente")?.value));
  if (!client) return back("error=cliente");
  const state = sign("gbp", [client.id, randomBytes(16).toString("hex")], 600);
  jar.set("gbp_state", state, { httpOnly: true, sameSite: "lax", secure: panelUrl().startsWith("https"), path: "/api/gbp", maxAge: 600 });
  return NextResponse.redirect(gbpLoginUrl(state));
}
