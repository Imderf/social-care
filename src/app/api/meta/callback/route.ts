import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verify } from "@/lib/auth";
import { encryptToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { saveConnectedAccount } from "@/lib/data";
import { enqueueBackfill } from "@/lib/backfill";
import { exchangeCode, listPages, panelUrl, subscribePage } from "@/lib/meta";

// Regreso del diálogo de Meta: valida el estado, cambia el código por el token, guarda cada
// página y su Instagram (token cifrado, en modo prueba) y suscribe la página a los webhooks.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/panel/cuentas?${q}`, panelUrl()));
  const jar = await cookies();
  const expected = jar.get("meta_state")?.value ?? "";
  jar.delete({ name: "meta_state", path: "/api/meta" });

  if (url.searchParams.get("error")) return back("error=cancelado");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const sameState = state.length === expected.length && expected.length > 0 && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  const signed = verify("estado", state);
  if (!code || !sameState || !signed) return back("error=estado");
  const [clientId, days] = signed.map(Number);
  // Si se eligió traer el historial, se encola para cada cuenta conectada.
  const history = async (platform: string, metaId: string) => {
    if (!days) return;
    const [[a]] = await db.query<any[]>("SELECT id FROM accounts WHERE platform = ? AND meta_id = ? AND client_id = ?", [platform, metaId, clientId]);
    if (a) await enqueueBackfill(db, clientId, a.id, days);
  };

  try {
    // El token de usuario de la conexión también se guarda: Business Discovery de Instagram lo pide.
    const userToken = await exchangeCode(code);
    const userTokenEncrypted = encryptToken(userToken);
    const pages = await listPages(userToken);
    let connected = 0;
    let taken = 0;
    for (const page of pages) {
      const tokenEncrypted = encryptToken(page.access_token);
      const fb = await saveConnectedAccount(db, clientId, { platform: "fb", metaId: page.id, pageId: page.id, name: page.name, tokenEncrypted, userTokenEncrypted });
      if (fb === "otro_cliente") {
        taken++;
        continue;
      }
      await subscribePage(page.id, page.access_token);
      await history("fb", page.id);
      connected++;
      const ig = page.instagram_business_account;
      if (ig) {
        const r = await saveConnectedAccount(db, clientId, { platform: "ig", metaId: ig.id, pageId: page.id, name: ig.username ? `@${ig.username}` : `Instagram de ${page.name}`, tokenEncrypted, userTokenEncrypted });
        if (r === "ok") {
          await history("ig", ig.id);
          connected++;
        } else taken++;
      }
    }
    return back(`conectadas=${connected}${taken ? `&ocupadas=${taken}` : ""}${days ? `&historial=${days}` : ""}`);
  } catch (e) {
    console.error("conexión con Meta falló:", e instanceof Error ? e.message : e);
    return back("error=meta");
  }
}
