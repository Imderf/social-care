import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

// Palabras prohibidas por cliente (pedido del equipo de cuentas y social media, 2026-10-24). La IA
// las recibe antes de redactar, y el código revisa toda respuesta, de la IA o de una persona, antes
// de proponerla, aceptarla o enviarla: ninguna sale con una de ellas.

export type Forbidden = { id?: number; value: string; note: string | null };

// Sin tildes ni mayúsculas, y como palabra o frase completa: «culpa» no marca «disculpa».
const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findForbidden(text: string | null | undefined, words: Forbidden[]) {
  if (!text || !words.length) return [];
  const t = fold(text);
  return words
    .filter((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(w.value).trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "u").test(t))
    .map((w) => w.value);
}

export const quoteList = (words: string[]) => words.map((w) => `«${w}»`).join(", ");

export const listForbidden = async (db: Pool, clientId: number) =>
  (await db.query<RowDataPacket[]>("SELECT id, value, note FROM lists WHERE client_id = ? AND kind = 'prohibida' ORDER BY value", [clientId]))[0] as Forbidden[];

// Una o varias (separadas por coma o por línea), con la misma alternativa. Si ya existe, actualiza la alternativa.
export async function addForbidden(db: Pool, clientId: number, values: string, note: string | null) {
  const words = [...new Set(values.split(/[,\n]/).map((v) => v.trim().replace(/\s+/g, " ").slice(0, 120)).filter(Boolean))];
  for (const w of words) {
    await db.query("INSERT INTO lists (client_id, kind, value, note) VALUES (?, 'prohibida', ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note)", [clientId, w, note?.trim().slice(0, 255) || null]);
  }
  return words.length;
}

export const removeForbidden = async (db: Pool, clientId: number, id: number) =>
  (await db.query<ResultSetHeader>("DELETE FROM lists WHERE id = ? AND client_id = ? AND kind = 'prohibida'", [id, clientId]))[0].affectedRows > 0;

// Lo que ve la persona cuando su respuesta lleva una palabra prohibida, o null si está limpia.
export async function forbiddenError(db: Pool, clientId: number, text: string | null | undefined) {
  const hits = findForbidden(text, await listForbidden(db, clientId));
  return hits.length ? `La respuesta lleva ${hits.length === 1 ? "una palabra prohibida" : "palabras prohibidas"}: ${quoteList(hits)}. Cámbiala antes de enviarla.` : null;
}
