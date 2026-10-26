import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClient } from "@/lib/data";
import { sign, verify } from "@/lib/auth";
import { loginUrl, missingMetaConfig, panelUrl } from "@/lib/meta";

// Inicio del "Conectar con Facebook": guarda un estado anti-CSRF atado al cliente elegido y
// manda al diálogo de inicio de sesión para empresas. El panel llega con ?cliente=, porque corre
// en otro dominio (local) y su cookie de cliente no viaja hasta aquí.
// La sesión del panel tampoco viaja: el panel firma un permiso (ticket) para ese cliente, que vence en 10 min.
// El estado también va firmado: una cookie plantada desde otro subdominio no ata páginas a otro cliente.
export async function GET(request: Request) {
  const back = (q: string) => NextResponse.redirect(new URL(`/panel/cuentas?${q}`, panelUrl()));
  if (missingMetaConfig().length) return back("error=config");
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("cliente"));
  // Historial elegido en el panel: 0 (solo lo nuevo) o 30 días. Viaja en el estado hasta el regreso.
  const days = url.searchParams.get("historial") === "30" ? 30 : 0;
  const client = id ? await getClient(db, id) : undefined;
  if (!client || client.id !== id) return back("error=cliente");
  if (Number(verify("conectar", url.searchParams.get("ticket"))?.[0]) !== id) return back("error=ticket");

  const state = sign("estado", [client.id, days, randomBytes(16).toString("hex")], 600);
  (await cookies()).set("meta_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_BASE_URL!.startsWith("https"),
    path: "/api/meta",
    maxAge: 600,
  });
  return NextResponse.redirect(loginUrl(state));
}
