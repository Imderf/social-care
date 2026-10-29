import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { decryptToken, encryptToken } from "./crypto.ts";
import { accessToken as refreshAccessToken, GoogleError } from "./google.ts";
import { maskPersonalData } from "./mask.ts";

// Google Business Profile: login con Google (permiso business.manage), detección automática de las cuentas y sedes de
// quien se conecta y lectura de sus reseñas. Nadie copia claves ni busca nada: se conecta con un botón.
// Solo lee (modo prueba): responder reseñas es la fase siguiente. Variables propias (GBP_CLIENT_ID y GBP_CLIENT_SECRET):
// el cliente OAuth vive en el proyecto de Google Cloud que pide el acceso a la API, que no es el de la Hoja de casos.
// La URL de regreso es PANEL_URL + /api/gbp/callback.
// Para que las llamadas funcionen, Google tiene que haber aprobado el acceso del proyecto de Google Cloud a la API
// (formulario de acceso básico): sin eso responde 403 y aquí se le explica a la persona.

type Row = RowDataPacket & Record<string, any>;

export const GBP_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/business.manage"];
export const missingGbpConfig = () => ["GBP_CLIENT_ID", "GBP_CLIENT_SECRET"].filter((k) => !process.env[k]);
const accessToken = (refreshToken: string) => refreshAccessToken(refreshToken, { id: process.env.GBP_CLIENT_ID!, secret: process.env.GBP_CLIENT_SECRET! });
export const gbpRedirectUri =() => `${(process.env.PANEL_URL || "http://localhost:3030").replace(/\/$/, "")}/api/gbp/callback`;

export function gbpLoginUrl(state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: process.env.GBP_CLIENT_ID!,
    redirect_uri: gbpRedirectUri(),
    response_type: "code",
    scope: GBP_SCOPES.join(" "),
    access_type: "offline", // token de renovación: la plataforma lee las reseñas sin que nadie esté conectado
    prompt: "consent select_account",
    state,
  }).toString();
  return u.toString();
}

// El código del regreso del login → token de renovación y correo de la cuenta de Google.
export async function exchangeGbpCode(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: process.env.GBP_CLIENT_ID!, client_secret: process.env.GBP_CLIENT_SECRET!, code, grant_type: "authorization_code", redirect_uri: gbpRedirectUri() }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) throw new GoogleError(json.error_description ?? json.error ?? `Google respondió ${res.status}`, res.status);
  if (!json.refresh_token) throw new GoogleError("Google no entregó el token de renovación");
  const payload = JSON.parse(Buffer.from(String(json.id_token).split(".")[1] ?? "", "base64url").toString("utf8") || "{}");
  return { refreshToken: json.refresh_token, email: String(payload.email ?? "") };
}

export class GbpError extends GoogleError {
  // 401 o 403: el acceso se quitó o la plataforma todavía no está aprobada por Google.
  get blocked() {
    return this.status === 401 || this.status === 403;
  }
}

// Lo que dice la persona cuando Google responde con error.
export const gbpErrorText = (e: unknown) =>
  e instanceof GbpError && e.status === 403
    ? "Google todavía no aprobó el acceso de la plataforma a la API de Business Profile, o esta cuenta no tiene permiso sobre las fichas."
    : e instanceof GbpError && e.status === 401
      ? "El permiso de Google venció o se quitó. Vuelve a conectar la cuenta."
      : e instanceof GbpError && e.status === 429
        ? "Google limitó las consultas. Si es la primera conexión, lo más probable es que Google todavía no haya aprobado el acceso del proyecto a la API de Business Profile (la cuota llega en 0). Si ya funcionaba, se reintenta solo."
        : "Google no respondió bien. Se reintenta solo.";

export type GbpFetch = typeof fetch;
export type GbpLocation = { account: string; accountName: string; location: string; title: string; address: string };
export type GbpReview = { reviewId: string; reviewer: string | null; rating: number | null; comment: string; createdAt: Date; reply: { comment: string; at: Date } | null };

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function call<T>(url: string, token: string, f: GbpFetch): Promise<T> {
  const res = await f(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new GbpError(json?.error?.message ?? `Google respondió ${res.status}`, res.status);
  return json as T;
}

// Todas las cuentas de la persona (la suya y las de grupos o empresas que administra) con sus sedes.
export async function listLocations(refreshToken: string, f: GbpFetch = fetch): Promise<GbpLocation[]> {
  const token = await accessToken(refreshToken);
  const out: GbpLocation[] = [];
  const { accounts = [] } = await call<{ accounts?: { name: string; accountName?: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20", token, f);
  for (const a of accounts) {
    let page = "";
    do {
      const q = new URLSearchParams({ readMask: "name,title,storefrontAddress", pageSize: "100", ...(page ? { pageToken: page } : {}) });
      const r = await call<{ locations?: any[]; nextPageToken?: string }>(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?${q}`, token, f);
      for (const l of r.locations ?? []) {
        const ad = l.storefrontAddress ?? {};
        out.push({ account: a.name, accountName: a.accountName ?? a.name, location: l.name, title: String(l.title ?? l.name), address: [ad.addressLines?.[0], ad.locality].filter(Boolean).join(", ") });
      }
      page = r.nextPageToken ?? "";
    } while (page);
  }
  return out;
}

// Una página de reseñas, las más recientes primero.
export async function listReviews(refreshToken: string, accountLocation: string, pageToken = "", f: GbpFetch = fetch) {
  const token = await accessToken(refreshToken);
  const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc", ...(pageToken ? { pageToken } : {}) });
  const r = await call<{ reviews?: any[]; nextPageToken?: string }>(`https://mybusiness.googleapis.com/v4/${accountLocation}/reviews?${q}`, token, f);
  const reviews: GbpReview[] = (r.reviews ?? []).map((v) => ({
    reviewId: String(v.reviewId ?? String(v.name ?? "").split("/").pop()),
    reviewer: v.reviewer?.isAnonymous ? null : (v.reviewer?.displayName ?? null),
    rating: STARS[String(v.starRating)] ?? null,
    comment: String(v.comment ?? ""),
    createdAt: new Date(v.createTime),
    reply: v.reviewReply?.comment ? { comment: String(v.reviewReply.comment), at: new Date(v.reviewReply.updateTime ?? v.createTime) } : null,
  }));
  return { reviews, next: r.nextPageToken ?? "" };
}

export type GbpApi = { listLocations: typeof listLocations; listReviews: typeof listReviews };
export const GBP_API: GbpApi = { listLocations, listReviews };

// El comentario de una reseña viene en el idioma del autor y a veces con «(Translated by Google)»: se deja el original.
export const cleanReviewText = (t: string) => t.split(/\n\s*\(Original\)\s*\n/i).pop()!.replace(/^\(Translated by Google\)\s*/i, "").trim();

export async function saveGbpConnection(db: Pool, clientId: number, email: string, refreshToken: string) {
  await db.query(
    `INSERT INTO gbp_connections (client_id, email, refresh_token_encrypted) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email), refresh_token_encrypted = VALUES(refresh_token_encrypted), connected_at = CURRENT_TIMESTAMP(3), last_sync_summary = NULL`,
    [clientId, email, encryptToken(refreshToken)],
  );
  // Las sedes que estaban desconectadas por un permiso vencido vuelven a leerse.
  await db.query("UPDATE accounts SET status = 'conectada' WHERE client_id = ? AND platform = 'gbp' AND status = 'error'", [clientId]);
}

export async function getGbpConnection(db: Pool, clientId: number) {
  const [[c]] = await db.query<Row[]>("SELECT email, refresh_token_encrypted, connected_at, last_sync_at, last_sync_summary FROM gbp_connections WHERE client_id = ?", [clientId]);
  return c ? { email: String(c.email), refreshToken: decryptToken(c.refresh_token_encrypted), connectedAt: c.connected_at as Date, lastSyncAt: (c.last_sync_at as Date) ?? null, summary: (c.last_sync_summary as string) ?? null } : null;
}

// Quita el permiso de Google y desconecta las sedes (sus reseñas se guardan).
export async function disconnectGbp(db: Pool, clientId: number) {
  await db.query("DELETE FROM gbp_connections WHERE client_id = ?", [clientId]);
  await db.query("UPDATE accounts SET status = 'desconectada' WHERE client_id = ? AND platform = 'gbp'", [clientId]);
}

// Cada sede elegida es una cuenta en modo prueba. Repetirlo no duplica nada ni toca el modo de las que ya estaban.
// Una sede que ya es de otro cliente no se toca.
export async function connectLocations(db: Pool, clientId: number, locations: { accountLocation: string; title: string }[]) {
  let created = 0, taken = 0;
  for (const l of locations) {
    const [[ex]] = await db.query<Row[]>("SELECT id, client_id FROM accounts WHERE platform = 'gbp' AND meta_id = ?", [l.accountLocation]);
    if (ex && Number(ex.client_id) !== clientId) {
      taken++;
      continue;
    }
    if (ex) {
      await db.query("UPDATE accounts SET status = 'conectada', name = ? WHERE id = ?", [l.title.slice(0, 200), ex.id]);
      continue;
    }
    await db.query("INSERT INTO accounts (client_id, platform, meta_id, name, status, mode) VALUES (?, 'gbp', ?, ?, 'conectada', 'prueba')", [clientId, l.accountLocation, l.title.slice(0, 200)]);
    created++;
  }
  if (created) await db.query("INSERT INTO jobs (type, payload) VALUES ('gbp_sync', JSON_OBJECT('client_id', ?))", [clientId]);
  return { created, taken };
}

const FIRST_SYNC_DAYS = 30;
const MAX_PAGES = 20;

// Trae las reseñas nuevas de todas las sedes conectadas del cliente. La primera vez, las de los últimos 30 días; después,
// hasta llegar a una reseña que ya se tenía. Se puede repetir sin duplicar nada. Si Google quita el permiso, las sedes
// pasan a «error» con el motivo. Lo que ya tiene respuesta entra como respondido por una persona.
export async function syncGbp(db: Pool, clientId: number, api: GbpApi = GBP_API) {
  const conn = await getGbpConnection(db, clientId);
  const result = { created: 0, replied: 0, locations: 0, error: null as string | null };
  if (!conn) return null;
  const [accounts] = await db.query<Row[]>("SELECT id, meta_id, mode FROM accounts WHERE client_id = ? AND platform = 'gbp' AND status = 'conectada'", [clientId]);
  for (const a of accounts) {
    result.locations++;
    try {
      const [[any]] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM interactions WHERE account_id = ?", [a.id]);
      const first = Number(any.n) === 0;
      const since = Date.now() - FIRST_SYNC_DAYS * 864e5;
      let page = "", pages = 0, stop = false;
      do {
        const r = await api.listReviews(conn.refreshToken, String(a.meta_id), page, fetch);
        for (const v of r.reviews) {
          if (first && v.createdAt.getTime() < since) {
            stop = true;
            continue;
          }
          const saved = await saveReview(db, clientId, a, v, first);
          if (saved === "duplicate") stop = true;
          else {
            result.created++;
            if (saved === "replied") result.replied++;
          }
        }
        page = stop ? "" : r.next;
      } while (page && ++pages < MAX_PAGES);
    } catch (e) {
      result.error = gbpErrorText(e);
      if (e instanceof GbpError && e.blocked) await db.query("UPDATE accounts SET status = 'error' WHERE id = ?", [a.id]);
      break;
    }
  }
  const summary = result.error ?? `${result.created} reseña(s) nuevas en ${result.locations} sede(s)`;
  await db.query("UPDATE gbp_connections SET last_sync_at = CURRENT_TIMESTAMP(3), last_sync_summary = ? WHERE client_id = ?", [summary.slice(0, 255), clientId]);
  return result;
}

async function saveReview(db: Pool, clientId: number, a: Row, v: GbpReview, first: boolean): Promise<"created" | "replied" | "duplicate"> {
  // Google no da un identificador estable de quien reseña: cada reseña es su propia «persona».
  const [contact] = await db.query<ResultSetHeader>(
    `INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, 'gbp', ?, ?)
     ON DUPLICATE KEY UPDATE username = COALESCE(VALUES(username), username), id = LAST_INSERT_ID(id)`,
    [clientId, `sin_id:${v.reviewId}`, v.reviewer?.slice(0, 200) ?? null],
  );
  const text = maskPersonalData(cleanReviewText(v.comment));
  const inserted = await db
    .query<ResultSetHeader>(
      `INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked, rating, mode, source, received_at,
                                 human_reply, answered_by, first_response_at)
       VALUES (?, ?, 'resena', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, a.id, v.reviewId, contact.insertId, text, v.rating, a.mode, first ? "historial" : "webhook", v.createdAt,
        v.reply ? maskPersonalData(v.reply.comment) : null, v.reply ? "persona" : null, v.reply?.at ?? null],
    )
    .then(
      ([r]) => r.insertId,
      (e) => {
        if (e.code === "ER_DUP_ENTRY") return null;
        throw e;
      },
    );
  if (!inserted) return "duplicate";
  await db.query("INSERT INTO jobs (type, payload) VALUES ('classify', JSON_OBJECT('interaction_id', ?))", [inserted]);
  return v.reply ? "replied" : "created";
}

// Clientes con sedes de Google conectadas que toca leer (cada 5 minutos).
export async function dueGbpSyncs(db: Pool, now = new Date(), everyMs = 5 * 60_000) {
  const [rows] = await db.query<Row[]>(
    `SELECT g.client_id, g.last_sync_at FROM gbp_connections g JOIN clients c ON c.id = g.client_id
     WHERE c.archived_at IS NULL AND EXISTS (SELECT 1 FROM accounts a WHERE a.client_id = g.client_id AND a.platform = 'gbp' AND a.status = 'conectada')`,
  );
  return rows.filter((r) => !r.last_sync_at || now.getTime() - new Date(r.last_sync_at).getTime() >= everyMs).map((r) => Number(r.client_id));
}
