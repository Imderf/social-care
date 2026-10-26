import type { Pool, RowDataPacket } from "mysql2/promise";
import { cancelPending, enqueuePublish } from "./publish.ts";
import { forbiddenError } from "./forbidden.ts";

// Bandeja: lo que atiende una persona. La IA sugiere el mensaje; la persona lo edita y lo envía
// desde aquí (o lo oculta, o lo da por resuelto). Publicar sigue pasando por `actions` y el trabajo
// "publish", con los mismos segundos para deshacer. Todo filtra por el cliente.

type Row = RowDataPacket & Record<string, any>;

async function load(db: Pool, clientId: number, escalationId: number) {
  const [[e]] = await db.query<Row[]>(
    `SELECT e.id, e.interaction_id, i.kind, i.analysis_only, i.window_expires_at, a.mode, p.origin AS post_origin
     FROM escalations e JOIN interactions i ON i.id = e.interaction_id AND i.client_id = e.client_id JOIN accounts a ON a.id = i.account_id
     LEFT JOIN posts p ON p.account_id = i.account_id AND p.meta_id = i.post_id
     WHERE e.id = ? AND e.client_id = ? AND e.resolved_at IS NULL`,
    [escalationId, clientId],
  );
  return e ?? null;
}

// Por qué no se puede enviar desde la plataforma, o null si se puede.
export function cannotSend(e: { mode: string; analysis_only: number | boolean; kind: string; window_expires_at: Date | null; post_origin?: string | null }) {
  if (e.post_origin === "anuncio" || e.post_origin === "pautada") {
    return `Es un comentario en ${e.post_origin === "anuncio" ? "un anuncio" : "una publicación pautada"}: no se responde desde la plataforma. Respóndelo desde Meta Business Suite o el Administrador de anuncios.`;
  }
  if (e.mode !== "en_vivo") return "La cuenta está en modo prueba: se responde desde Meta. Para responder desde aquí, pásala a asistido en Cuentas conectadas.";
  if (e.analysis_only) return "Es un mensaje antiguo del historial: ya no se responde.";
  if (e.kind === "dm" && (!e.window_expires_at || new Date(e.window_expires_at).getTime() < Date.now())) {
    return "Pasaron las 24 h desde el último mensaje: Meta solo deja responder desde Meta Business Suite, como agente humano.";
  }
  return null;
}

export async function sendFromInbox(db: Pool, clientId: number, escalationId: number, r: { text?: string | null; hide?: boolean }) {
  const e = await load(db, clientId, escalationId);
  if (!e) return { ok: false, error: "El caso ya no está abierto." };
  const blocked = cannotSend(e as any);
  if (blocked) return { ok: false, error: blocked };
  if (r.hide) {
    if (e.kind === "dm") return { ok: false, error: "Un DM no se puede ocultar." };
    return { ok: await enqueuePublish(db, clientId, e.interaction_id, "ocultar", null, "persona", "equipo") };
  }
  const text = (r.text ?? "").trim();
  if (!text) return { ok: false, error: "Escribe la respuesta antes de enviarla." };
  const banned = await forbiddenError(db, clientId, text);
  if (banned) return { ok: false, error: banned };
  return { ok: await enqueuePublish(db, clientId, e.interaction_id, e.kind === "dm" ? "dm" : "responder", text, "persona", "equipo") };
}

// Atendido por fuera (una llamada, Meta, otra área): se cierra sin publicar nada.
export async function resolveWithoutReply(db: Pool, clientId: number, escalationId: number) {
  await db.query("UPDATE escalations SET resolved_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND client_id = ? AND resolved_at IS NULL", [escalationId, clientId]);
}

export async function undoInboxSend(db: Pool, clientId: number, escalationId: number) {
  const e = await load(db, clientId, escalationId);
  return e ? cancelPending(db, clientId, e.interaction_id) : "ninguna";
}
