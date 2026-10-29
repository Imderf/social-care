import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionValid, verify } from "@/lib/auth";
import { encryptToken } from "@/lib/crypto";
import { exchangeGoogleCode } from "@/lib/google";
import { panelUrl } from "@/lib/meta";

// Regreso del login con Google: valida el estado, cambia el código por el token de renovación y lo
// guarda cifrado para el cliente. Si cambió la cuenta, la Hoja elegida se borra (el permiso
// drive.file es de la cuenta que la eligió).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/panel/hoja?${q}`, panelUrl()));
  const jar = await cookies();
  const expected = jar.get("google_state")?.value ?? "";
  jar.delete({ name: "google_state", path: "/api/google" });
  if (!(await sessionValid(db, jar.get(SESSION_COOKIE)?.value))) return NextResponse.redirect(new URL("/ingresar", panelUrl()));
  if (url.searchParams.get("error")) return back("error=cancelado");
  const state = url.searchParams.get("state") ?? "";
  const same = state.length === expected.length && expected.length > 0 && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  const signed = verify("google", state);
  const code = url.searchParams.get("code");
  if (!code || !same || !signed) return back("error=estado");
  const clientId = Number(signed[0]);
  try {
    const g = await exchangeGoogleCode(code);
    await db.query(
      `INSERT INTO google_connections (client_id, email, refresh_token_encrypted) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE spreadsheet_id = IF(google_connections.email = VALUES(email), google_connections.spreadsheet_id, NULL),
         spreadsheet_name = IF(google_connections.email = VALUES(email), google_connections.spreadsheet_name, NULL),
         email = VALUES(email), refresh_token_encrypted = VALUES(refresh_token_encrypted), connected_at = CURRENT_TIMESTAMP(3)`,
      [clientId, g.email, encryptToken(g.refreshToken)],
    );
  } catch (e) {
    console.error("google: no se pudo conectar", (e as Error).message);
    return back("error=google");
  }
  return back("conectado=1");
}
