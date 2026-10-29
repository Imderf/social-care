// Google: login con Google (OAuth) por cliente y lectura de la Hoja de casos (Sheets API v4).
// Permiso drive.file: la plataforma solo abre la Hoja que la persona elige en el selector de Google
// (Picker), nada más de su Drive. Sin librerías: fetch contra los endpoints de Google.
// Variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (OAuth, aplicación web), GOOGLE_API_KEY y
// GOOGLE_PROJECT_NUMBER (para el selector). La URL de regreso es PANEL_URL + /api/google/callback.

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];

export const missingGoogleConfig = () => ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_API_KEY", "GOOGLE_PROJECT_NUMBER"].filter((k) => !process.env[k]);
const redirectUri = () => `${(process.env.PANEL_URL || "http://localhost:3030").replace(/\/$/, "")}/api/google/callback`;

export function googleLoginUrl(state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // token de renovación para leer la Hoja sin que nadie esté conectado
    prompt: "consent select_account",
    state,
  }).toString();
  return u.toString();
}

export class GoogleError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function token(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(json.error_description ?? json.error ?? `Google respondió ${res.status}`, res.status);
  return json as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string };
}

// El código del regreso del login → token de renovación y correo de la cuenta. El id_token llega
// directo de Google por TLS en esta misma llamada: se lee sin verificar la firma.
export async function exchangeGoogleCode(code: string) {
  const t = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new GoogleError("Google no entregó el token de renovación");
  const payload = JSON.parse(Buffer.from(String(t.id_token).split(".")[1] ?? "", "base64url").toString("utf8") || "{}");
  return { refreshToken: t.refresh_token, email: String(payload.email ?? ""), accessToken: t.access_token };
}

// ponytail: caché en memoria del token de acceso (1 h); se pierde al reiniciar y se pide otro.
const cache = new Map<string, { token: string; until: number }>();
export async function accessToken(refreshToken: string) {
  const hit = cache.get(refreshToken);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  cache.set(refreshToken, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  return t.access_token;
}

async function sheets<T>(path: string, accessTokenValue: string): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { headers: { authorization: `Bearer ${accessTokenValue}` }, signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(json.error?.message ?? `Google Sheets respondió ${res.status}`, res.status);
  return json as T;
}

export type SheetTab = { title: string; rows: string[][] };

// Todas las pestañas (o las elegidas) con sus celdas como texto, hasta 3.000 filas y 40 columnas.
export async function readSpreadsheet(refreshToken: string, spreadsheetId: string, onlyTabs: string[] = []): Promise<{ name: string; tabs: SheetTab[] }> {
  const at = await accessToken(refreshToken);
  const id = encodeURIComponent(spreadsheetId);
  const meta = await sheets<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(`${id}?fields=properties.title,sheets.properties.title`, at);
  const wanted = onlyTabs.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const titles = meta.sheets.map((s) => s.properties.title).filter((t) => !wanted.length || wanted.includes(t.trim().toLowerCase()));
  if (!titles.length) return { name: meta.properties.title, tabs: [] };
  const ranges = titles.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:AN3000`)}`).join("&");
  const data = await sheets<{ valueRanges: { values?: string[][] }[] }>(`${id}/values:batchGet?${ranges}&valueRenderOption=FORMATTED_VALUE`, at);
  return { name: meta.properties.title, tabs: titles.map((title, k) => ({ title, rows: data.valueRanges[k]?.values ?? [] })) };
}

export type SheetReader = typeof readSpreadsheet;
