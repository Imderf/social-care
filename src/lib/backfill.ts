import type { Pool, RowDataPacket } from "mysql2/promise";
import { decryptToken } from "./crypto.ts";
import { attachmentLabel, graphPages, postOrigin, postType } from "./meta.ts";
import { applyItem, type MetaItem } from "./meta-events.ts";
import { upsertPost } from "./posts.ts";

// Historial de una cuenta: al conectarla, si el equipo lo elige, o después desde Cuentas. Trae los
// comentarios de los últimos N días (con las respuestas de la marca), sin importar la fecha de la
// publicación, y los DM de ese periodo. Los guarda igual que el webhook pero con source = 'historial'.
// Lo respondido sirve para aprender y medir; lo no respondido reciente va a Pruebas; lo antiguo,
// solo a análisis.
// ponytail: recorre las últimas POSTS_SCANNED publicaciones; comentarios en publicaciones más viejas
// no entran. Subirlo si un cliente tiene mucha actividad en piezas antiguas.

type Row = RowDataPacket & Record<string, any>;
export const HISTORY_DAYS = 30;
const POSTS_SCANNED = 100; // 4 páginas de 25
export const API = { graphPages };

export async function enqueueBackfill(db: Pool, clientId: number, accountId: number, days = HISTORY_DAYS) {
  await db.query(
    "INSERT INTO jobs (type, payload) SELECT 'backfill', JSON_OBJECT('account_id', id, 'days', ?) FROM accounts WHERE id = ? AND client_id = ?",
    [days, accountId, clientId],
  );
}

export async function backfillAccount(db: Pool, accountId: number, days = HISTORY_DAYS, api = API) {
  const [[a]] = await db.query<Row[]>("SELECT id, client_id, platform, meta_id, page_id, mode, token_encrypted FROM accounts WHERE id = ?", [accountId]);
  if (!a?.token_encrypted) return null;
  const token = decryptToken(a.token_encrypted);
  const since = Date.now() - days * 864e5;
  const recent = (t: string) => new Date(t).getTime() >= since;
  const platform = a.platform as "fb" | "ig";
  const items: MetaItem[] = [];

  // Un comentario de la marca es su respuesta al comentario padre; los demás son de usuarios.
  const comment = (c: any, postId: string, parentId: string | null) => {
    const at = new Date(c.created_time ?? c.timestamp);
    if (!recent(at.toISOString())) return;
    const text = String(c.message ?? c.text ?? "");
    if (String(c.from?.id) === String(a.meta_id)) {
      if (parentId) items.push({ type: "brand_reply", platform, account: a.meta_id, kind: "comentario", text, at, selfId: String(c.id), replyTo: parentId, userId: null });
      return;
    }
    items.push({
      type: "incoming", platform, account: a.meta_id, kind: "comentario", text, at, metaId: String(c.id), postId,
      userId: String(c.from?.id ?? `sin_id:${c.id}`), username: c.from?.name ?? c.from?.username ?? c.username ?? null,
    });
  };

  if (platform === "fb") {
    const posts = await api.graphPages<any>(`${a.meta_id}/feed`, {
      fields: "id,created_time,permalink_url,status_type,message,is_published,is_inline_created,comments.limit(100){id,message,created_time,from{id,name},comments.limit(100){id,message,created_time,from{id,name}}}",
      limit: "25",
      access_token: token,
    }, undefined, POSTS_SCANNED / 25);
    for (const p of posts) {
      await upsertPost(db, a as any, p.id, { type: postType("fb", { status_type: p.status_type, permalink: p.permalink_url }), origin: postOrigin("fb", p), permalink: p.permalink_url ?? null, caption: p.message ?? null, publishedAt: new Date(p.created_time) }, false);
      for (const c of p.comments?.data ?? []) {
        comment(c, p.id, null);
        for (const r of c.comments?.data ?? []) comment(r, p.id, c.id);
      }
    }
  } else {
    const media = await api.graphPages<any>(`${a.meta_id}/media`, {
      fields: "id,timestamp,permalink,media_type,media_product_type,caption,comments_count",
      limit: "25",
      access_token: token,
    }, undefined, POSTS_SCANNED / 25);
    for (const m of media) {
      await upsertPost(db, a as any, m.id, { type: postType("ig", m), origin: postOrigin("ig", m), permalink: m.permalink ?? null, caption: m.caption ?? null, publishedAt: new Date(m.timestamp) }, false);
      if (!m.comments_count) continue;
      const comments = await api.graphPages<any>(`${m.id}/comments`, { fields: "id,text,timestamp,username,from{id,username},replies{id,text,timestamp,username,from{id,username}}", limit: "50", access_token: token });
      for (const c of comments) {
        comment(c, m.id, null);
        for (const r of c.replies?.data ?? []) comment(r, m.id, c.id);
      }
    }
  }

  // DM: cada conversación en orden cronológico, para que la respuesta quede con su mensaje.
  const conversations = await api.graphPages<any>(`${a.page_id ?? a.meta_id}/conversations`, {
    platform: platform === "fb" ? "messenger" : "instagram",
    fields: "updated_time,messages.limit(20){id,message,created_time,from{id,username,name},to{data{id}},attachments{mime_type},shares{link},story}",
    limit: "10",
    access_token: token,
  }, (c) => !recent(c.updated_time), 20);
  for (const conv of conversations) {
    for (const m of [...(conv.messages?.data ?? [])].reverse()) {
      if (!recent(m.created_time)) continue;
      const at = new Date(m.created_time);
      // Foto, video, audio, respuesta a una historia o publicación compartida. Si no trae nada, no se importa.
      const files = attachmentLabel([
        ...(m.attachments?.data ?? []).map((x: any) => String(x.mime_type ?? "file")),
        ...(m.story ? ["story_mention"] : []),
        ...(m.shares?.data?.length ? ["share"] : []),
      ]);
      const text = [m.message, files].filter(Boolean).join(" ");
      if (!text) continue;
      if (String(m.from?.id) === String(a.meta_id)) {
        items.push({ type: "brand_reply", platform, account: a.meta_id, kind: "dm", text, at, selfId: String(m.id), replyTo: null, userId: String(m.to?.data?.[0]?.id ?? "") });
      } else {
        items.push({ type: "incoming", platform, account: a.meta_id, kind: "dm", text, at, metaId: String(m.id), postId: null, userId: String(m.from?.id ?? ""), username: m.from?.username ?? m.from?.name ?? null });
      }
    }
  }

  const result = { created: 0, duplicates: 0, replies: 0 };
  for (const item of items) {
    const r = await applyItem(db, a as any, item, { source: "historial" });
    if (r === "created") result.created++;
    else if (r === "duplicate") result.duplicates++;
    else if (r === "reply") result.replies++;
  }
  await db.query("UPDATE accounts SET backfilled_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [a.id]);
  return result;
}
