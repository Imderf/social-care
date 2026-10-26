import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { isValidSignature } from "@/lib/meta-signature";
import { recordMetaEvent } from "@/lib/queue";

// Verificación de la suscripción: Meta la llama al guardar la URL del webhook en la app.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (params.get("hub.mode") === "subscribe" && token && params.get("hub.verify_token") === token) {
    return new Response(params.get("hub.challenge") ?? "");
  }
  return new Response("Forbidden", { status: 403 });
}

// Eventos: valida la firma, guarda el crudo, encola y responde 200. Nada de lógica pesada aquí.
// Meta manda lotes de pocos KB: algo enorme sin firmar no se lee entero.
const MAX_BYTES = 512 * 1024;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return new Response("Too large", { status: 413 });
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > MAX_BYTES) return new Response("Too large", { status: 413 });
  if (!isValidSignature(body, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: { object?: string };
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const dedupeKey = createHash("sha256").update(body).digest("hex");
  try {
    await recordMetaEvent(db, dedupeKey, payload.object ?? null, payload);
  } catch (e) {
    // El error de mysql2 trae el SQL con los valores (el evento crudo): solo se registra el código.
    console.error("webhook: no se pudo guardar el evento", (e as { code?: string }).code ?? "error");
    return new Response("Error", { status: 500 });
  }

  return new Response("OK");
}
