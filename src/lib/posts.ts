import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { decryptToken } from "./crypto.ts";
import { type PostOrigin, fetchPost } from "./meta.ts";
export { postType } from "./meta.ts";

// Publicaciones en las que la gente comenta: tipo de pieza, enlace y texto, para el Resumen.

type Row = RowDataPacket & Record<string, any>;
// promotionKnown: Meta dijo explícitamente si la pauta está activa (promotion_status en el webhook de
// Facebook). Solo así una publicación pautada vuelve a orgánica cuando la pauta termina.
export type PostInfo = { type: string | null; origin?: PostOrigin | null; promotionKnown?: boolean; permalink: string | null; caption?: string | null; publishedAt?: Date | null };

// Guarda o completa la publicación. Si llega por webhook y le falta información, encola pedirla a Meta.
export async function upsertPost(db: Pool, account: { id: number; client_id: number }, metaId: string, info: PostInfo | null, fetchLater: boolean) {
  const [r] = await db.query<ResultSetHeader>(
    `INSERT INTO posts (client_id, account_id, meta_id, type, origin, permalink, caption, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE type = COALESCE(VALUES(type), type), permalink = COALESCE(VALUES(permalink), permalink),
       -- Un anuncio sigue siendo anuncio. Entre orgánica y pautada manda lo último que Meta dijo de la
       -- pauta; una lectura que no dice nada de la pauta no le quita la marca.
       origin = CASE WHEN origin = 'anuncio' OR VALUES(origin) IS NULL THEN COALESCE(origin, VALUES(origin))
                     WHEN origin IS NULL OR VALUES(origin) = 'anuncio' OR ? THEN VALUES(origin)
                     WHEN VALUES(origin) = 'pautada' THEN 'pautada' ELSE origin END,
       caption = COALESCE(VALUES(caption), caption), published_at = COALESCE(VALUES(published_at), published_at), fetched_at = COALESCE(VALUES(fetched_at), fetched_at)`,
    [account.client_id, account.id, metaId, info?.type ?? null, info?.origin ?? null, info?.permalink ?? null, info?.caption?.slice(0, 300) ?? null, info?.publishedAt ?? null,
      info?.caption !== undefined ? new Date() : null, !!info?.promotionKnown],
  );
  if (fetchLater && r.affectedRows === 1) await db.query("INSERT INTO jobs (type, payload) VALUES ('post_info', JSON_OBJECT('account_id', ?, 'meta_id', ?))", [account.id, metaId]);
}

// Origen de la publicación de un comentario. Si no se sabe y es la primera vez que se ve, se le
// pregunta a Meta en ese momento (una vez por publicación), porque decide si el comentario se responde.
export async function originFor(db: Pool, account: { id: number; client_id: number; platform?: string; token_encrypted: string | null }, metaId: string, fetch?: typeof fetchPost) {
  const [[p]] = await db.query<Row[]>("SELECT origin, fetched_at FROM posts WHERE account_id = ? AND meta_id = ?", [account.id, metaId]);
  if (p?.origin || p?.fetched_at || !fetch || !account.token_encrypted || !account.platform) return (p?.origin as PostOrigin) ?? null;
  try {
    const info = await fetch(account.platform as "fb" | "ig", metaId, decryptToken(account.token_encrypted));
    await upsertPost(db, account, metaId, { ...info, caption: info.caption ?? null }, false);
    return info.origin ?? null;
  } catch {
    return null; // sin respuesta de Meta se trata como orgánica; el trabajo post_info lo completa después
  }
}

// Trabajo "post_info": pide a Meta el tipo, el enlace y el texto de una publicación.
export async function completePost(db: Pool, accountId: number, metaId: string, fetch = fetchPost) {
  const [[a]] = await db.query<Row[]>("SELECT id, client_id, platform, token_encrypted FROM accounts WHERE id = ?", [accountId]);
  if (!a?.token_encrypted) return null;
  const info = await fetch(a.platform, metaId, decryptToken(a.token_encrypted));
  await upsertPost(db, a as any, metaId, { ...info, caption: info.caption ?? null }, false);
  return info;
}
