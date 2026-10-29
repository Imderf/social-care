import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClient } from "@/lib/data";
import { SESSION_COOKIE, sessionValid, sign } from "@/lib/auth";
import { googleLoginUrl, missingGoogleConfig } from "@/lib/google";
import { panelUrl } from "@/lib/meta";
import { loadAccess } from "@/lib/users";

// «Conectar con Google» en Hoja de casos: para el cliente en el que está la persona del panel. El
// panel y esta ruta son locales (mismo dominio): la sesión viaja y se revisa aquí. El estado va
// firmado y en una cookie de 10 minutos.
export async function GET() {
  const back = (q: string) => NextResponse.redirect(new URL(`/panel/hoja?${q}`, panelUrl()));
  const jar = await cookies();
  const userId = await sessionValid(db, jar.get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.redirect(new URL("/ingresar?volver=%2Fpanel%2Fhoja", panelUrl()));
  // Conectar Google es configuración: solo administradores.
  if ((await loadAccess(db, userId))?.role !== "admin") return NextResponse.redirect(new URL("/panel", panelUrl()));
  if (missingGoogleConfig().length) return back("error=config");
  const client = await getClient(db, Number(jar.get("cliente")?.value));
  if (!client) return back("error=cliente");
  const state = sign("google", [client.id, randomBytes(16).toString("hex")], 600);
  jar.set("google_state", state, { httpOnly: true, sameSite: "lax", secure: panelUrl().startsWith("https"), path: "/api/google", maxAge: 600 });
  return NextResponse.redirect(googleLoginUrl(state));
}
