import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

// Nivel de influencia de quien escribe (pedido de Imderf, 2026-10-26): persona del común o
// influenciador según sus seguidores, con cortes que configura cada cliente. Desde el nivel que el
// cliente elija, el caso pasa a una persona para una respuesta especial. La lista de vigilancia
// (periodistas, medios, influenciadores conocidos) pasa siempre, tenga o no datos de seguidores.

export const TIERS = ["comun", "nano", "micro", "macro", "mega"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = {
  comun: "Persona del común",
  nano: "Nanoinfluenciador",
  micro: "Microinfluenciador",
  macro: "Macroinfluenciador",
  mega: "Megainfluenciador",
};
export type Influence = { nano: number; micro: number; macro: number; mega: number; escalateFrom: Exclude<Tier, "comun"> };
// Cortes de seguidores más usados en la industria; cada cliente los cambia en Perfiles.
export const DEFAULT_INFLUENCE: Influence = { nano: 1_000, micro: 10_000, macro: 100_000, mega: 1_000_000, escalateFrom: "micro" };

export async function getInfluence(db: Pool, clientId: number): Promise<Influence> {
  const [[r]] = await db.query<RowDataPacket[]>("SELECT JSON_EXTRACT(settings, '$.influence') AS v FROM clients WHERE id = ?", [clientId]);
  const v = typeof r?.v === "string" ? JSON.parse(r.v) : r?.v;
  return { ...DEFAULT_INFLUENCE, ...(v && typeof v === "object" ? v : {}) };
}

// Valida que los cortes suban (nano < micro < macro < mega). Devuelve el problema, o null si guardó.
export async function setInfluence(db: Pool, clientId: number, v: Influence) {
  const cuts = [v.nano, v.micro, v.macro, v.mega];
  if (cuts.some((n) => !Number.isInteger(n) || n < 1)) return "Los cortes son números enteros de seguidores, desde 1.";
  if (cuts.some((n, i) => i > 0 && n <= cuts[i - 1])) return "Cada nivel empieza en más seguidores que el anterior: nano < micro < macro < mega.";
  if (!TIERS.includes(v.escalateFrom) || v.escalateFrom === ("comun" as string)) return "Elige desde qué nivel pasa a una persona.";
  await db.query("UPDATE clients SET settings = JSON_SET(settings, '$.influence', JSON_EXTRACT(?, '$')) WHERE id = ?", [JSON.stringify(v), clientId]);
  return null;
}

// Null cuando no se sabe cuántos seguidores tiene (Meta no lo da en todos los casos).
export function tierFor(followers: number | null | undefined, i: Influence): Tier | null {
  if (followers == null) return null;
  return followers >= i.mega ? "mega" : followers >= i.macro ? "macro" : followers >= i.micro ? "micro" : followers >= i.nano ? "nano" : "comun";
}

export const reachesPerson = (tier: Tier | null, i: Influence) => !!tier && TIERS.indexOf(tier) >= TIERS.indexOf(i.escalateFrom);

// Lista de vigilancia: usuario de Instagram (sin @) o nombre de Facebook, sin importar mayúsculas.
const handle = (t: string) => t.trim().replace(/^@/, "").replace(/\s+/g, " ").toLowerCase();

export const listWatch = async (db: Pool, clientId: number) =>
  (await db.query<RowDataPacket[]>("SELECT id, value, note FROM lists WHERE client_id = ? AND kind = 'vigilancia' ORDER BY value", [clientId]))[0] as { id: number; value: string; note: string | null }[];

export async function addWatch(db: Pool, clientId: number, values: string, note: string | null) {
  const names = [...new Set(values.split(/[,\n]/).map(handle).filter(Boolean).map((v) => v.slice(0, 120)))];
  for (const v of names) {
    await db.query("INSERT INTO lists (client_id, kind, value, note) VALUES (?, 'vigilancia', ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note)", [clientId, v, note?.trim().slice(0, 255) || null]);
  }
  return names.length;
}

export const removeWatch = async (db: Pool, clientId: number, id: number) =>
  (await db.query<ResultSetHeader>("DELETE FROM lists WHERE id = ? AND client_id = ? AND kind = 'vigilancia'", [id, clientId]))[0].affectedRows > 0;

export const isWatched = (username: string | null | undefined, watch: { value: string }[]) => !!username && watch.some((w) => w.value === handle(username));

// Si quien escribe es una persona importante (la lista), un influenciador desde el nivel elegido o una
// cuenta verificada, el caso pasa a una persona con el motivo; si no, null. Macro y mega son críticos.
export function influencerOf(
  p: { followers?: number | null; verified?: boolean | number | null; username?: string | null; platform: string },
  inf: Influence,
  watch: { value: string; note: string | null }[],
): { reason: string; priority: "critica" | "alta" } | null {
  const important = p.username ? watch.find((w) => w.value === handle(p.username!)) : undefined;
  const tier = tierFor(p.followers, inf);
  const big = reachesPerson(tier, inf);
  if (!important && !big && !p.verified) return null;
  const where = p.platform === "ig" ? "Instagram" : "Facebook";
  const parts = [
    important ? `Persona importante${important.note ? ` (${important.note})` : ""}` : null,
    big && tier ? `${TIER_LABELS[tier]}: ${Number(p.followers).toLocaleString("es-CO")} seguidores en ${where}` : null,
    p.verified ? "Cuenta verificada" : null,
  ].filter(Boolean);
  return { reason: parts.join(" · ").slice(0, 255), priority: tier === "macro" || tier === "mega" ? "critica" : "alta" };
}

// Personas importantes con su actividad: cuántos mensajes ha mandado y su ficha, si ya escribió.
export const listImportant = async (db: Pool, clientId: number) =>
  (await db.query<RowDataPacket[]>(
    `SELECT l.id, l.value, l.note,
            (SELECT c.id FROM contacts c WHERE c.client_id = l.client_id AND c.username = l.value ORDER BY c.id LIMIT 1) AS contact_id,
            (SELECT COUNT(*) FROM interactions i JOIN contacts c ON c.id = i.contact_id WHERE c.client_id = l.client_id AND c.username = l.value) AS messages
     FROM lists l WHERE l.client_id = ? AND l.kind = 'vigilancia' ORDER BY l.value`,
    [clientId],
  ))[0] as { id: number; value: string; note: string | null; contact_id: number | null; messages: number }[];
