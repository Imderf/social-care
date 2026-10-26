import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { decryptToken } from "./crypto.ts";
import { MetaError, hideComment, replyToComment, sendMessage } from "./meta.ts";

// Publicar en Meta. Toda publicación pasa por aquí como una fila de `actions` y un trabajo
// "publish", nunca directo desde la IA ni desde el panel. Solo se encola si la cuenta está en
// asistido (en_vivo): en modo prueba no se publica nada.

type Row = RowDataPacket & Record<string, any>;
export type ActionType = "responder" | "ocultar" | "dm";
export const META = { replyToComment, hideComment, sendMessage };
// Lo que aprueba una persona espera unos segundos antes de salir, para poder deshacerlo.
export const UNDO_SECONDS = 15;

// Crea la acción y su trabajo. Devuelve false si la cuenta no publica o si ya existía.
// by = "equipo": lo escribió una persona desde la bandeja; cuenta como respuesta del equipo.
export async function enqueuePublish(db: Pool, clientId: number, interactionId: number, type: ActionType, text: string | null, actor: "ia" | "persona", by: "ia" | "equipo" = "ia") {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO actions (client_id, interaction_id, type, payload, actor)
     SELECT i.client_id, i.id, ?, JSON_OBJECT('text', ?, 'by', ?), ? FROM interactions i JOIN accounts a ON a.id = i.account_id
     WHERE i.id = ? AND i.client_id = ? AND a.mode = 'en_vivo'`,
    [type, text, by, actor, interactionId, clientId],
  );
  if (!res.affectedRows) return false;
  await db.query("INSERT INTO jobs (type, payload, run_at) VALUES ('publish', JSON_OBJECT('action_id', ?), NOW(3) + INTERVAL ? SECOND)", [
    res.insertId,
    actor === "persona" ? UNDO_SECONDS : 0,
  ]);
  return true;
}

// Ejecuta una acción. Si Meta responde con error, queda "fallida" y el trabajo se reintenta. Antes de
// llamar a Meta queda "enviando": si el worker se cae o Meta no contesta, no se sabe si salió, y no se
// reintenta solo (una respuesta pública duplicada es peor que una persona revisando). Si ya está
// hecha, no repite nada. `meta` se cambia en las pruebas.
export async function publishAction(db: Pool, actionId: number, meta = META) {
  const [[a]] = await db.query<Row[]>(
    `SELECT x.id, x.type, x.status, x.payload, i.id AS interaction_id, i.meta_id, i.kind, ac.platform, ac.meta_id AS account_meta_id,
            ac.page_id, ac.token_encrypted, ac.mode, c.meta_user_id
     FROM actions x JOIN interactions i ON i.id = x.interaction_id JOIN accounts ac ON ac.id = i.account_id
     LEFT JOIN contacts c ON c.id = i.contact_id WHERE x.id = ?`,
    [actionId],
  );
  if (!a || a.status === "hecha") return null;
  if (a.mode !== "en_vivo" || !a.token_encrypted) throw new Error("La cuenta no está en asistido o no tiene token");

  const token = decryptToken(a.token_encrypted);
  const text = a.payload?.text ?? "";
  const [claim] = await db.query<ResultSetHeader>("UPDATE actions SET status = 'enviando' WHERE id = ? AND status IN ('pendiente', 'fallida')", [a.id]);
  if (!claim.affectedRows) return null;
  try {
    const metaId =
      a.type === "ocultar" ? await meta.hideComment(a.platform, a.meta_id, token)
      : a.kind === "dm" || a.type === "dm" ? await meta.sendMessage(a.page_id ?? a.account_meta_id, a.meta_user_id, text, token)
      : await meta.replyToComment(a.platform, a.meta_id, text, token);
    await db.query("UPDATE actions SET status = 'hecha', meta_response_id = ? WHERE id = ?", [metaId, a.id]);
  } catch (e) {
    if (e instanceof MetaError) await db.query("UPDATE actions SET status = 'fallida' WHERE id = ?", [a.id]);
    throw e;
  }

  const team = a.payload?.by === "equipo";
  if (a.type !== "ocultar") {
    // La escribió una persona desde la bandeja: es respuesta del equipo (y ejemplo para la IA). Si
    // no, la publicó la IA; si el eco del webhook llegó antes y se contó como del equipo, se corrige.
    await db.query(
      team
        ? `UPDATE interactions SET answered_by = 'persona', human_reply = ?, first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP(3)) WHERE id = ?`
        : `UPDATE interactions SET answered_by = 'ia', first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP(3)),
             human_reply = IF(human_reply = ?, NULL, human_reply) WHERE id = ?`,
      [text, a.interaction_id],
    );
  }
  if (a.type !== "ocultar" || team) {
    await db.query("UPDATE escalations SET resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP(3)) WHERE interaction_id = ?", [a.interaction_id]);
  }
  return { type: a.type as ActionType };
}

// Cancela una publicación que todavía espera su turno. "publicada" si ya salió o el worker la tomó.
export async function cancelPending(db: Pool, clientId: number, interactionId: number) {
  const [[x]] = await db.query<Row[]>(
    "SELECT id, status FROM actions WHERE interaction_id = ? AND client_id = ? AND type IN ('responder', 'ocultar', 'dm')",
    [interactionId, clientId],
  );
  if (!x) return "ninguna" as const;
  if (x.status === "hecha") return "publicada" as const;
  const [job] = await db.query<any>("DELETE FROM jobs WHERE type = 'publish' AND status = 'pending' AND JSON_EXTRACT(payload, '$.action_id') = ?", [x.id]);
  if (!job.affectedRows) return "publicada" as const;
  await db.query("DELETE FROM actions WHERE id = ?", [x.id]);
  return "cancelada" as const;
}
