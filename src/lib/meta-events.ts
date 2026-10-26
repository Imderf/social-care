import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { decryptToken } from "./crypto.ts";
import { maskPersonalData } from "./mask.ts";
import { PROFILES, type PostOrigin, attachmentLabel, fetchCommentText, fetchPost, fetchUserName, postOrigin } from "./meta.ts";
import { originFor, postType, upsertPost } from "./posts.ts";
export { attachmentLabel };

// Convierte el evento crudo de un webhook de Meta en mensajes de usuarios y respuestas de la marca.
// Cubre comentarios de Facebook (feed) e Instagram (comments) y DM de Messenger e Instagram
// (messaging). Las menciones se registran más adelante, cuando se lea su contenido por API.

type Base = { platform: "fb" | "ig"; account: string; kind: "comentario" | "dm"; text: string; at: Date };
export type MetaItem =
  | (Base & {
      type: "incoming";
      metaId: string;
      postId: string | null;
      post?: { type: string | null; origin?: PostOrigin | null; promotionKnown?: boolean; permalink: string | null; caption?: string | null; publishedAt?: Date | null };
      promotedPostId?: string | null; // Instagram: publicación orgánica de la que salió el anuncio comentado
      userId: string;
      username: string | null;
    })
  | (Base & { type: "brand_reply"; selfId: string; replyTo: string | null; userId: string | null });

// Meta manda segundos en unos campos y milisegundos en otros.
export const toDate = (t: unknown) => {
  const n = Number(t);
  return new Date(!n ? Date.now() : n > 1e12 ? n : n * 1000);
};

export function parseMetaEvent(payload: any): MetaItem[] {
  const platform = payload?.object === "instagram" ? "ig" : payload?.object === "page" ? "fb" : null;
  if (!platform) return [];
  const items: MetaItem[] = [];

  for (const entry of payload.entry ?? []) {
    const account = String(entry.id);
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const isFbComment = platform === "fb" && change.field === "feed" && v.item === "comment" && v.verb === "add";
      const isIgComment = platform === "ig" && change.field === "comments";
      if (!isFbComment && !isIgComment) continue;

      const fromId = String(v.from?.id ?? "");
      const text = String((isFbComment ? v.message : v.text) ?? "");
      const at = toDate(isFbComment ? v.created_time : entry.time);
      if (fromId === account) {
        // La marca respondió desde Meta: solo cuenta si responde a un comentario, no a su publicación.
        const replyTo = v.parent_id && v.parent_id !== v.post_id ? String(v.parent_id) : null;
        const selfId = String(isFbComment ? v.comment_id : v.id);
        if (replyTo) items.push({ type: "brand_reply", platform, account, kind: "comentario", text, at, selfId, replyTo, userId: null });
        continue;
      }
      items.push({
        type: "incoming",
        platform,
        account,
        kind: "comentario",
        text,
        at,
        metaId: String(isFbComment ? v.comment_id : v.id),
        postId: (isFbComment ? v.post_id : v.media?.id) ?? null,
        post: isFbComment
          ? { type: postType("fb", { status_type: v.post?.status_type, permalink: v.post?.permalink_url }), origin: postOrigin("fb", v.post ?? {}), promotionKnown: v.post?.is_published === true && typeof v.post?.promotion_status === "string", permalink: v.post?.permalink_url ?? null }
          : { type: postType("ig", { media_product_type: v.media?.media_product_type }), origin: postOrigin("ig", { ad_id: v.media?.ad_id }), permalink: null },
        promotedPostId: isIgComment && v.media?.ad_id && v.media?.original_media_id ? String(v.media.original_media_id) : null,
        userId: fromId,
        username: (isFbComment ? v.from?.name : v.from?.username) ?? null,
      });
    }

    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (!msg || msg.is_deleted) continue;
      const files = attachmentLabel((msg.attachments ?? []).map((a: any) => String(a.type)));
      const text = [msg.text, files].filter(Boolean).join(" ");
      const at = toDate(m.timestamp);
      if (msg.is_echo || String(m.sender?.id) === account) {
        items.push({ type: "brand_reply", platform, account, kind: "dm", text, at, selfId: String(msg.mid), replyTo: null, userId: String(m.recipient?.id ?? "") });
      } else {
        items.push({ type: "incoming", platform, account, kind: "dm", text, at, metaId: String(msg.mid), postId: null, userId: String(m.sender?.id ?? ""), username: null });
      }
    }
  }
  return items;
}

type Row = RowDataPacket & Record<string, any>;
export type Account = { id: number; client_id: number; platform?: string; meta_id?: string; mode: string; token_encrypted: string | null; user_token_encrypted?: string | null };
type Applied = "created" | "duplicate" | "reply" | "skip";

// Guarda un mensaje de un usuario o una respuesta de la marca. Lo usan el webhook y la importación
// del historial (source = 'historial'). Se puede repetir sin duplicar nada.
export async function applyItem(db: Pool, account: Account, item: MetaItem, opts: { source?: "webhook" | "historial"; commentText?: typeof fetchCommentText; userName?: typeof fetchUserName; postInfo?: typeof fetchPost; profiles?: typeof PROFILES } = {}): Promise<Applied> {
  const source = opts.source ?? "webhook";
  if (item.type === "incoming") {
    if (!item.text && item.platform === "fb" && item.kind === "comentario" && account.token_encrypted) {
      item.text = await (opts.commentText ?? fetchCommentText)(item.metaId, decryptToken(account.token_encrypted));
    }
    if (item.postId) await upsertPost(db, account, item.postId, item.post ?? null, source === "webhook" && !opts.postInfo);
    // La publicación orgánica de la que salió un anuncio de Instagram queda marcada como pautada.
    if (item.promotedPostId) await upsertPost(db, account, item.promotedPostId, { type: null, origin: "pautada", permalink: null }, false);
    // Solo se responde lo orgánico: un comentario en un anuncio, o en una publicación mientras está
    // pautada, se guarda para análisis. El origen se lee ya combinado con lo que se sabía de la publicación.
    const origin = item.kind === "comentario" && item.postId ? await originFor(db, account, item.postId, opts.postInfo) : null;
    // Un DM llega sin nombre: se pide a Meta la primera vez, para poder buscar a la persona.
    if (!item.username && item.kind === "dm" && item.userId && opts.userName && account.token_encrypted) {
      const [[known]] = await db.query<Row[]>("SELECT username FROM contacts WHERE client_id = ? AND platform = ? AND meta_user_id = ?", [account.client_id, item.platform, item.userId]);
      if (!known?.username) item.username = await opts.userName(item.platform, item.userId, decryptToken(account.token_encrypted));
    }
    const [contact] = await db.query<ResultSetHeader>(
      `INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE username = COALESCE(VALUES(username), username), id = LAST_INSERT_ID(id)`,
      [account.client_id, item.platform, item.userId, item.username],
    );
    if (opts.profiles) await refreshProfile(db, account, contact.insertId, item, opts.profiles);
    // Del historial, lo que ya no se puede responder (comentario de hace más de 7 días, DM fuera de
    // la ventana de 24 h) queda solo para análisis.
    const age = Date.now() - item.at.getTime();
    const analysisOnly = origin === "anuncio" || origin === "pautada" || (source === "historial" && (item.kind === "comentario" ? age > 7 * 864e5 : age > 864e5));
    const interactionId = await db
      .query<ResultSetHeader>(
        `INSERT INTO interactions (client_id, account_id, kind, meta_id, post_id, contact_id, text_masked, mode, source, analysis_only, received_at, window_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [account.client_id, account.id, item.kind, item.metaId, item.postId, contact.insertId, maskPersonalData(item.text), account.mode, source, analysisOnly,
          item.at, item.kind === "dm" ? new Date(item.at.getTime() + 864e5) : null],
      )
      .then(
        ([r]) => r.insertId,
        (e) => {
          if (e.code === "ER_DUP_ENTRY") return null;
          throw e;
        },
      );
    if (!interactionId) return "duplicate";
    await db.query("INSERT INTO jobs (type, payload) VALUES ('classify', JSON_OBJECT('interaction_id', ?))", [interactionId]);
    return "created";
  }

  // Lo que publicó la propia plataforma también llega como eco: no es respuesta del equipo.
  const [[own]] = await db.query<Row[]>("SELECT id FROM actions WHERE client_id = ? AND meta_response_id = ?", [account.client_id, item.selfId]);
  if (own) return "skip";

  // Respuesta del equipo: a un comentario por su id; a un DM, el último sin responder de esa persona.
  const [[target]] = item.replyTo
    ? await db.query<Row[]>("SELECT id FROM interactions WHERE account_id = ? AND meta_id = ?", [account.id, item.replyTo])
    : await db.query<Row[]>(
        `SELECT i.id FROM interactions i JOIN contacts c ON c.id = i.contact_id
         WHERE i.account_id = ? AND i.kind = 'dm' AND c.meta_user_id = ? AND i.answered_by IS NULL AND i.received_at <= ?
         ORDER BY i.received_at DESC LIMIT 1`,
        [account.id, item.userId, item.at],
      );
  if (!target) return "skip";
  await db.query(
    `UPDATE interactions SET human_reply = COALESCE(human_reply, ?), answered_by = COALESCE(answered_by, 'persona'),
       first_response_at = COALESCE(first_response_at, ?) WHERE id = ?`,
    [maskPersonalData(item.text), item.at, target.id],
  );
  await db.query("UPDATE escalations SET resolved_at = COALESCE(resolved_at, ?) WHERE interaction_id = ?", [item.at, target.id]);
  return "reply";
}

// Procesa un evento guardado del webhook. `commentText` se cambia en las pruebas para no llamar a Meta.
// Perfil de quien escribe (seguidores, verificación, tipo de cuenta): se le pregunta a Meta la primera
// vez y cada 7 días. Si Meta no da nada en ese canal (Messenger) o falla, no se marca como consultado.
async function refreshProfile(db: Pool, account: Account, contactId: number, item: Extract<MetaItem, { type: "incoming" }>, api: typeof PROFILES) {
  if (!account.token_encrypted || !item.userId || item.userId.startsWith("sin_id:")) return;
  const [[c]] = await db.query<Row[]>("SELECT username, profile_checked_at FROM contacts WHERE id = ?", [contactId]);
  if (c?.profile_checked_at && Date.now() - new Date(c.profile_checked_at).getTime() < 7 * 864e5) return;
  const token = decryptToken(account.token_encrypted);
  const username = c?.username ?? item.username;
  const p =
    item.platform === "ig"
      ? item.kind === "dm"
        ? await api.igDm(item.userId, token)
        : username && account.user_token_encrypted && account.meta_id
          ? await api.igBusiness(account.meta_id, username, decryptToken(account.user_token_encrypted))
          : null
      : item.kind === "comentario"
        ? await api.fbAuthor(item.userId, token)
        : null;
  if (!p) return;
  await db.query(
    `UPDATE contacts SET followers = COALESCE(?, followers), verified = COALESCE(?, verified), account_type = COALESCE(?, account_type),
       bio = COALESCE(?, bio), username = COALESCE(username, ?), profile_checked_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
    [p.followers ?? null, p.verified ?? null, p.accountType ?? null, p.bio?.slice(0, 500) ?? null, p.username ?? null, contactId],
  );
}

export async function processMetaEvent(db: Pool, eventId: number, commentText = fetchCommentText, userName = fetchUserName, postInfo = fetchPost, profiles = PROFILES) {
  const [[event]] = await db.query<Row[]>("SELECT payload FROM webhook_events WHERE id = ?", [eventId]);
  const result = { created: 0, duplicates: 0, replies: 0, unknownAccount: 0 };
  if (!event) return result;

  for (const item of parseMetaEvent(event.payload)) {
    const [[account]] = await db.query<Row[]>(
      "SELECT id, client_id, platform, meta_id, mode, token_encrypted, user_token_encrypted FROM accounts WHERE platform = ? AND meta_id = ? AND status = 'conectada'",
      [item.platform, item.account],
    );
    if (!account) {
      result.unknownAccount++;
      continue;
    }
    await db.query("UPDATE accounts SET last_webhook_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [account.id]);
    const r = await applyItem(db, account as Account, item, { commentText, userName, postInfo, profiles });
    if (r === "created") result.created++;
    else if (r === "duplicate") result.duplicates++;
    else if (r === "reply") result.replies++;
  }

  // El crudo trae comentarios y DM sin enmascarar: se vacía al procesarlo (la llave queda para no
  // repetirlo) y la fila se borra a los 7 días.
  await db.query("UPDATE webhook_events SET processed_at = CURRENT_TIMESTAMP(3), payload = JSON_OBJECT() WHERE id = ?", [eventId]);
  await db.query("DELETE FROM webhook_events WHERE received_at < NOW() - INTERVAL 7 DAY");
  return result;
}
