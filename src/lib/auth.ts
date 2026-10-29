import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Pool, RowDataPacket } from "mysql2/promise";

// Ingreso al panel. Contraseñas con scrypt y sal propia. La sesión y el permiso para conectar con
// Meta son textos firmados con HMAC (sin tabla de sesiones); la firma sale de SESSION_SECRET, aparte
// de la llave que cifra los tokens de Meta. La sesión lleva la versión del usuario: cambiar la
// contraseña la sube y cierra las sesiones abiertas.
// ponytail: salir borra la cookie pero no invalida una copia robada hasta que vence (12 h).

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = "sesion";
export const SESSION_SECONDS = 12 * 3600;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt.${salt.toString("base64url")}.${(await scryptAsync(pw, salt, 32)).toString("base64url")}`;
}

// Para un usuario que no existe se compara igual contra este, así no se nota por el tiempo de respuesta.
const NOBODY = `scrypt.${Buffer.alloc(16).toString("base64url")}.${Buffer.alloc(32).toString("base64url")}`;

export async function verifyPassword(pw: string, stored: string | null) {
  const [kind, salt, hash] = (stored ?? NOBODY).split(".");
  const want = Buffer.from(hash ?? "", "base64url");
  if (kind !== "scrypt" || want.length !== 32) return false;
  return timingSafeEqual(await scryptAsync(pw, Buffer.from(salt, "base64url"), 32), want);
}

function mac(purpose: string, body: string) {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("Falta SESSION_SECRET");
  return createHmac("sha256", key).update(`${purpose}:${body}`).digest("base64url");
}

// "<partes>.<vence>.<firma>". El propósito entra en la firma: una sesión no sirve como permiso de conexión.
export function sign(purpose: string, parts: (string | number)[], ttlSeconds: number, now = Date.now()) {
  const body = [...parts, now + ttlSeconds * 1000].join(".");
  return `${body}.${mac(purpose, body)}`;
}

export function verify(purpose: string, token: string | null | undefined, now?: number) {
  const i = token?.lastIndexOf(".") ?? -1;
  if (!token || i < 0) return null;
  const body = token.slice(0, i);
  const got = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(mac(purpose, body));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const parts = body.split(".");
  return Number(parts.pop()) > (now ?? Date.now()) ? parts : null;
}

// Solo la firma (sirve en el proxy, sin base). Las páginas y acciones usan sessionValid.
export const sessionUser = (token?: string) => Number(verify("sesion", token)?.[0]) || null;

export async function startSession(db: Pool, id: number) {
  const [[u]] = await db.query<RowDataPacket[]>("SELECT session_version FROM users WHERE id = ?", [id]);
  return sign("sesion", [id, Number(u?.session_version ?? 1)], SESSION_SECONDS);
}

export async function sessionValid(db: Pool, token?: string) {
  const parts = verify("sesion", token);
  if (!parts) return null;
  const [[u]] = await db.query<RowDataPacket[]>("SELECT session_version FROM users WHERE id = ?", [Number(parts[0])]);
  return u && Number(u.session_version) === Number(parts[1]) ? Number(parts[0]) : null;
}

// ponytail: límite de intentos en memoria (se pierde al reiniciar y no se comparte entre procesos).
// Por usuario (por su id, así usuario y correo cuentan juntos): 5 fallidos, 15 min. Por IP: 20.
// Mientras está bloqueado no se alarga, para que nadie deje a otro afuera para siempre.
const failures = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60_000;
const locked = (key: string, limit: number, now: number) => {
  const f = failures.get(key);
  return !!f && f.n >= limit && f.until > now;
};
function fail(key: string, limit: number, now: number) {
  const f = failures.get(key);
  if (f && f.n >= limit && f.until > now) return;
  failures.set(key, { n: f && f.until > now ? f.n + 1 : 1, until: now + WINDOW });
  if (failures.size > 10_000) for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
}

export async function login(db: Pool, username: string, password: string, ip = "") {
  const name = username.trim().toLowerCase();
  const now = Date.now();
  const [[u]] = await db.query<RowDataPacket[]>("SELECT id, password_hash FROM users WHERE username = ? OR email = ?", [name, name]);
  const keys: [string, number][] = [[`u:${u ? u.id : name}`, 5], ...(ip ? [[`ip:${ip}`, 20] as [string, number]] : [])];
  if (keys.some(([k, limit]) => locked(k, limit, now))) return "bloqueado" as const;
  if ((await verifyPassword(password, u?.password_hash ?? null)) && u) {
    failures.delete(keys[0][0]);
    return Number(u.id);
  }
  for (const [k, limit] of keys) fail(k, limit, now);
  return null;
}

// Crea el usuario o, si ya existe, le cambia la contraseña.
export async function saveUser(db: Pool, username: string, name: string, password: string) {
  if (!/^[a-z0-9_.-]{3,60}$/i.test(username)) throw new Error("El usuario lleva de 3 a 60 letras, números, punto, guion o guion bajo.");
  if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
  await db.query(
    "INSERT INTO users (username, name, password_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), session_version = users.session_version + 1",
    [username.toLowerCase(), name, await hashPassword(password)],
  );
}
