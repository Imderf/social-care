import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ROLES, type Role } from "./permissions.ts";
import { USERNAME_HELP, USERNAME_RE, clearFailures, generateTempPassword, hashPassword, passwordError, sign, verify, verifyPassword } from "./auth.ts";

// Administración de usuarios del panel: crear, editar, restablecer la contraseña, desactivar, desbloquear
// y asignar clientes. Los mensajes de UserError se le muestran tal cual a la persona que administra.
// Reglas: siempre queda al menos un administrador activo, y nadie se desactiva, se restablece ni se
// quita el rol de administrador a sí mismo (para eso están Mi cuenta y otro administrador).
// Las contraseñas temporales no se guardan ni se registran: se devuelven una sola vez.
// Enlace de invitación: la persona crea ella misma su contraseña. El enlace es un texto firmado con la versión de sesión
// del usuario, sin tabla: sirve una vez (al guardar la contraseña la versión sube), vence a los 7 días y uno nuevo anula
// el anterior. Una cuenta sin contraseña (`password_hash` NULL) está «pendiente» y no puede ingresar.

type Row = RowDataPacket & Record<string, any>;

export { ROLES, ROLE_HELP, ROLE_LABELS, type Role } from "./permissions.ts";
const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

export class UserError extends Error {}

export type UserInfo = { id: number; username: string; name: string; email: string | null; role: Role; active: boolean; mustChange: boolean; pending: boolean; lastLogin: Date | null; createdAt: Date; clients: { id: number; name: string }[] };

const toInfo = (u: Row, clients: Row[]): UserInfo => ({
  id: Number(u.id),
  username: u.username ?? "",
  name: u.name,
  email: u.email ?? null,
  role: u.role,
  active: !!u.active,
  mustChange: !!u.must_change_password,
  pending: !!u.pending,
  lastLogin: u.last_login_at ?? null,
  createdAt: u.created_at,
  clients: clients.filter((c) => Number(c.user_id) === Number(u.id)).map((c) => ({ id: Number(c.client_id), name: c.name })),
});

// Todas las personas, administradores primero, con los clientes que ve cada una.
export async function listUsers(db: Pool) {
  const [users] = await db.query<Row[]>(
    "SELECT id, username, name, email, role, active, must_change_password, password_hash IS NULL AS pending, last_login_at, created_at FROM users ORDER BY active DESC, role, name",
  );
  const [clients] = await db.query<Row[]>("SELECT m.user_id, m.client_id, c.name FROM client_members m JOIN clients c ON c.id = m.client_id ORDER BY c.name");
  return users.map((u) => toInfo(u, clients));
}

// Lo que el panel necesita saber de quien tiene la sesión abierta.
export async function loadAccess(db: Pool, id: number) {
  const [[u]] = await db.query<Row[]>("SELECT id, username, name, role, active, must_change_password FROM users WHERE id = ?", [id]);
  if (!u || !u.active) return null;
  return { id: Number(u.id), username: String(u.username), name: String(u.name), role: u.role as Role, mustChange: !!u.must_change_password };
}
export type Access = NonNullable<Awaited<ReturnType<typeof loadAccess>>>;

export async function memberClientIds(db: Pool, userId: number) {
  const [rows] = await db.query<Row[]>("SELECT client_id FROM client_members WHERE user_id = ?", [userId]);
  return rows.map((r) => Number(r.client_id));
}

async function tx<T>(db: Pool, fn: (c: PoolConnection) => Promise<T>) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

const INVITATION_SECONDS = 7 * 24 * 3600;
const invitationToken = (id: number, version: number) => sign("invitacion", [id, version], INVITATION_SECONDS);

async function logEvent(c: Pool | PoolConnection, actorId: number | null, targetId: number | null, action: string, detail: string | null = null) {
  await c.query("INSERT INTO user_events (actor_id, target_id, action, detail) VALUES (?, ?, ?, ?)", [actorId, targetId, action, detail?.slice(0, 255) ?? null]);
}

type Fields = { name: string; email: string | null; role: Role; clientIds: number[] };

function cleanFields(input: { name?: unknown; email?: unknown; role?: unknown; clientIds?: unknown }): Fields {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new UserError("Escribe el nombre de la persona.");
  if (name.length > 200) throw new UserError("El nombre es demasiado largo.");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (email && (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new UserError("El correo no parece válido.");
  if (!isRole(input.role)) throw new UserError("Elige un rol.");
  const ids = Array.isArray(input.clientIds) ? input.clientIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  return { name, email: email || null, role: input.role, clientIds: [...new Set(ids)] };
}

// Los administradores ven todos los clientes: no llevan asignación. Los demás, solo los que se les asignan.
async function setMemberships(c: PoolConnection, userId: number, role: Role, clientIds: number[]) {
  await c.query("DELETE FROM client_members WHERE user_id = ?", [userId]);
  if (role === "admin" || !clientIds.length) return;
  const [found] = await c.query<Row[]>("SELECT id FROM clients WHERE id IN (?)", [clientIds]);
  if (found.length !== clientIds.length) throw new UserError("Alguno de los clientes ya no existe.");
  await c.query("INSERT INTO client_members (client_id, user_id, role) VALUES ?", [clientIds.map((id) => [id, userId, role])]);
}

const duplicate = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";

// mode «enlace» (por defecto): la cuenta nace sin contraseña y se devuelve el enlace para que la persona la cree.
// mode «temporal»: se genera una contraseña temporal que debe cambiar al entrar.
export async function createUser(db: Pool, actorId: number | null, input: { username?: unknown; name?: unknown; email?: unknown; role?: unknown; clientIds?: unknown; mode?: unknown }) {
  const username = String(input.username ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new UserError(USERNAME_HELP);
  const f = cleanFields(input);
  const temp = input.mode === "temporal" ? generateTempPassword() : null;
  const hash = temp ? await hashPassword(temp) : null;
  try {
    const id = await tx(db, async (c) => {
      const [r] = await c.query<any>("INSERT INTO users (username, name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?)", [username, f.name, f.email, hash, f.role, temp ? 1 : 0]);
      await setMemberships(c, r.insertId, f.role, f.clientIds);
      await logEvent(c, actorId, r.insertId, "crear", `${f.role}${f.clientIds.length ? `, ${f.clientIds.length} cliente(s)` : ""}`);
      return Number(r.insertId);
    });
    return { id, username, password: temp, token: temp ? null : invitationToken(id, 1) };
  } catch (e) {
    if (duplicate(e)) throw new UserError(/for key '(?:\w+\.)?email'/.test(String((e as Error).message)) ? "Ya hay una persona con ese correo." : "Ya hay una persona con ese usuario.");
    throw e;
  }
}

// Bloquea las filas de los administradores activos para que dos cambios a la vez no dejen el panel sin ninguno.
async function otherActiveAdmins(c: PoolConnection, exceptId: number) {
  const [rows] = await c.query<Row[]>("SELECT id FROM users WHERE role = 'admin' AND active = 1 AND id <> ? FOR UPDATE", [exceptId]);
  return rows.length;
}

async function target(c: PoolConnection, id: number) {
  const [[u]] = await c.query<Row[]>("SELECT id, username, role, active FROM users WHERE id = ? FOR UPDATE", [id]);
  if (!u) throw new UserError("La persona ya no existe.");
  return u;
}

export async function updateUser(db: Pool, actorId: number, id: number, input: { name?: unknown; email?: unknown; role?: unknown; clientIds?: unknown }) {
  const f = cleanFields(input);
  try {
    await tx(db, async (c) => {
      const u = await target(c, id);
      if (u.role === "admin" && f.role !== "admin") {
        if (id === actorId) throw new UserError("No puedes quitarte el rol de administrador a ti mismo. Pídeselo a otro administrador.");
        if (u.active && (await otherActiveAdmins(c, id)) === 0) throw new UserError("Siempre debe quedar al menos un administrador activo.");
      }
      await c.query("UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?", [f.name, f.email, f.role, id]);
      await setMemberships(c, id, f.role, f.clientIds);
      await logEvent(c, actorId, id, "editar", u.role !== f.role ? `rol: ${u.role} a ${f.role}` : null);
    });
  } catch (e) {
    if (duplicate(e)) throw new UserError("Ya hay una persona con ese correo.");
    throw e;
  }
}

// Contraseña temporal nueva: cierra sus sesiones, quita el bloqueo y la obliga a cambiarla al entrar.
export async function resetPassword(db: Pool, actorId: number, id: number) {
  if (id === actorId) throw new UserError("Tu propia contraseña se cambia en Mi cuenta.");
  const temp = generateTempPassword();
  const hash = await hashPassword(temp);
  const username = await tx(db, async (c) => {
    const u = await target(c, id);
    await c.query("UPDATE users SET password_hash = ?, must_change_password = 1, session_version = session_version + 1 WHERE id = ?", [hash, id]);
    await logEvent(c, actorId, id, "restablecer");
    return String(u.username);
  });
  clearFailures(id);
  return { username, password: temp };
}

export async function setActive(db: Pool, actorId: number, id: number, active: boolean) {
  if (!active && id === actorId) throw new UserError("No puedes desactivarte a ti mismo.");
  await tx(db, async (c) => {
    const u = await target(c, id);
    if (!active && u.role === "admin" && u.active && (await otherActiveAdmins(c, id)) === 0) throw new UserError("Siempre debe quedar al menos un administrador activo.");
    await c.query("UPDATE users SET active = ?, session_version = session_version + 1 WHERE id = ?", [active ? 1 : 0, id]);
    await logEvent(c, actorId, id, active ? "reactivar" : "desactivar");
  });
}

export async function unlockUser(db: Pool, actorId: number, id: number) {
  const [[u]] = await db.query<Row[]>("SELECT id FROM users WHERE id = ?", [id]);
  if (!u) throw new UserError("La persona ya no existe.");
  clearFailures(id);
  await logEvent(db, actorId, id, "desbloquear");
}

// Enlace nuevo para que la persona cree su contraseña. Sirve también para restablecerla: la contraseña actual deja de
// valer al instante y las sesiones se cierran. Anula cualquier enlace anterior.
export async function inviteUser(db: Pool, actorId: number | null, id: number) {
  if (id === actorId) throw new UserError("Tu propia contraseña se cambia en Mi cuenta.");
  const r = await tx(db, async (c) => {
    const u = await target(c, id);
    if (!u.active) throw new UserError("La cuenta está desactivada: reactívala antes de enviarle un enlace.");
    await c.query("UPDATE users SET password_hash = NULL, must_change_password = 0, session_version = session_version + 1 WHERE id = ?", [id]);
    const [[v]] = await c.query<Row[]>("SELECT session_version FROM users WHERE id = ?", [id]);
    await logEvent(c, actorId, id, "invitar");
    return { username: String(u.username), version: Number(v.session_version) };
  });
  clearFailures(id);
  return { username: r.username, token: invitationToken(id, r.version) };
}

const BAD_LINK = "Este enlace ya se usó o venció. Pídele uno nuevo a quien administra el panel.";

// La persona dueña de un enlace vigente, o null si el enlace es inválido, venció, ya se usó o la cuenta no está pendiente.
async function pendingFor(c: Pool | PoolConnection, token: string | null | undefined, lock = false) {
  const parts = verify("invitacion", token);
  if (!parts) return null;
  const [[u]] = await c.query<Row[]>(
    `SELECT id, username, name, active, session_version, password_hash IS NULL AS pending FROM users WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
    [Number(parts[0])],
  );
  return u && u.active && u.pending && Number(u.session_version) === Number(parts[1]) ? u : null;
}

export async function invitationInfo(db: Pool, token: string | null | undefined) {
  const u = await pendingFor(db, token);
  return u ? { name: String(u.name), username: String(u.username) } : null;
}

// Guarda la contraseña que eligió la persona y gasta el enlace (sube la versión de sesión). El que llama abre la sesión.
export async function acceptInvitation(db: Pool, token: string | null | undefined, next: string, again: string) {
  return tx(db, async (c) => {
    const u = await pendingFor(c, token, true);
    if (!u) throw new UserError(BAD_LINK);
    if (next !== again) throw new UserError("La contraseña y su repetición no coinciden.");
    const bad = passwordError(next, String(u.username));
    if (bad) throw new UserError(bad);
    await c.query("UPDATE users SET password_hash = ?, must_change_password = 0, last_login_at = CURRENT_TIMESTAMP(3), session_version = session_version + 1 WHERE id = ?", [await hashPassword(next), u.id]);
    await logEvent(c, Number(u.id), Number(u.id), "crear_clave");
    return Number(u.id);
  });
}

// La persona cambia su propia contraseña: exige la actual, sube la versión (cierra las demás sesiones)
// y quita la marca de «debe cambiarla». El que llama abre la sesión nueva con startSession.
export async function changeOwnPassword(db: Pool, id: number, current: string, next: string, again: string) {
  const [[u]] = await db.query<Row[]>("SELECT username, password_hash FROM users WHERE id = ? AND active = 1", [id]);
  if (!u) throw new UserError("La sesión ya no es válida.");
  if (!(await verifyPassword(current, u.password_hash))) throw new UserError("La contraseña actual no coincide.");
  if (next !== again) throw new UserError("La contraseña nueva y su repetición no coinciden.");
  if (next === current) throw new UserError("La contraseña nueva tiene que ser distinta de la actual.");
  const bad = passwordError(next, u.username);
  if (bad) throw new UserError(bad);
  await db.query("UPDATE users SET password_hash = ?, must_change_password = 0, session_version = session_version + 1 WHERE id = ?", [await hashPassword(next), id]);
  await logEvent(db, id, id, "cambiar_clave");
}

export async function listUserEvents(db: Pool, limit = 40) {
  const [rows] = await db.query<Row[]>(
    `SELECT e.id, e.action, e.detail, e.created_at, a.name AS actor, t.name AS target
     FROM user_events e LEFT JOIN users a ON a.id = e.actor_id LEFT JOIN users t ON t.id = e.target_id
     ORDER BY e.id DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ id: Number(r.id), action: String(r.action), detail: (r.detail as string | null) ?? null, at: r.created_at as Date, actor: (r.actor as string | null) ?? null, target: (r.target as string | null) ?? null }));
}
