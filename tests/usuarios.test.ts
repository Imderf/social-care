// Administración de usuarios: crear con contraseña temporal, restablecer, desactivar, desbloquear, roles y
// clientes asignados. Siempre queda un administrador activo y nadie se quita el acceso a sí mismo.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { generateTempPassword, login, passwordError, saveUser, sessionValid, startSession, verifyPassword } from "../src/lib/auth.ts";
import { createClient, listClients, listClientsOf } from "../src/lib/data.ts";
import { ALLOWED, can } from "../src/lib/permissions.ts";
import { UserError, changeOwnPassword, createUser, listUserEvents, listUsers, loadAccess, memberClientIds, resetPassword, setActive, unlockUser, updateUser } from "../src/lib/users.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let admin = 0;
let cafam = 0;
let otro = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  process.env.SESSION_SECRET ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  await saveUser(db, "admin", "Administrador", "clave-larga-1");
  admin = Number((await rows("SELECT id FROM users WHERE username = 'admin'"))[0].id);
  cafam = await createClient(db, "Droguerías Cafam", null);
  otro = await createClient(db, "Otro cliente", null);
});
after(() => db.end());

test("la contraseña temporal es legible, distinta cada vez y cumple la política", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = generateTempPassword();
    seen.add(p);
    assert.match(p, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    assert.ok(/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p), "mayúscula, minúscula y número");
    assert.ok(!/[01OIl]/.test(p), "sin letras que se confunden");
    assert.equal(passwordError(p), null);
  }
  assert.equal(seen.size, 200);
  assert.match(passwordError("corta")!, /8 caracteres/);
  assert.match(passwordError("Maria.Perez", "maria.perez")!, /igual al usuario/);
});

test("crear: queda con la contraseña temporal, debe cambiarla y solo se guarda su hash", async () => {
  const r = await createUser(db, admin, { username: "Maria.Perez", name: "  María   Pérez ", email: "Maria@Ogilvy.com", role: "operador", clientIds: [cafam] });
  assert.equal(r.username, "maria.perez");
  const [u] = await rows("SELECT * FROM users WHERE id = ?", [r.id]);
  assert.equal(u.name, "María Pérez");
  assert.equal(u.email, "maria@ogilvy.com");
  assert.equal(u.role, "operador");
  assert.equal(u.must_change_password, 1);
  assert.ok(!JSON.stringify(u).includes(r.password), "la contraseña no queda en claro");
  assert.equal(await verifyPassword(r.password, u.password_hash), true);
  assert.deepEqual(await memberClientIds(db, r.id), [cafam]);
  assert.deepEqual((await rows("SELECT role FROM client_members WHERE user_id = ?", [r.id])).map((m) => m.role), ["operador"]);
  // ingresa con la temporal y por correo
  assert.equal(await login(db, "maria.perez", r.password), r.id);
  assert.equal(await login(db, "maria@ogilvy.com", r.password), r.id);
  const a = await loadAccess(db, r.id);
  assert.deepEqual(a, { id: r.id, username: "maria.perez", name: "María Pérez", role: "operador", mustChange: true });
  assert.ok((await rows("SELECT last_login_at FROM users WHERE id = ?", [r.id]))[0].last_login_at, "queda el último ingreso");
});

test("crear: valida usuario, nombre, correo, rol y clientes, y no repite usuario ni correo", async () => {
  const base = { username: "ana.ruiz", name: "Ana Ruiz", email: "", role: "verificador", clientIds: [cafam] };
  await assert.rejects(createUser(db, admin, { ...base, username: "a" }), /3 a 60/);
  await assert.rejects(createUser(db, admin, { ...base, name: "  " }), /nombre/);
  await assert.rejects(createUser(db, admin, { ...base, email: "no-es-correo" }), /correo/);
  await assert.rejects(createUser(db, admin, { ...base, role: "superadmin" }), /rol/);
  await assert.rejects(createUser(db, admin, { ...base, clientIds: [99999] }), /ya no existe/);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM users WHERE username = 'ana.ruiz'"))[0].n, 0, "una falla no deja la persona a medias");
  await createUser(db, admin, base);
  await assert.rejects(createUser(db, admin, base), /mismo usuario|ese usuario/);
  await assert.rejects(createUser(db, admin, { ...base, username: "ana.ruiz2", email: "maria@ogilvy.com" }), /ese correo/);
});

test("los administradores no llevan clientes asignados: ven todos; los demás, solo los suyos", async () => {
  const adm = await createUser(db, admin, { username: "otro.admin", name: "Otro Admin", role: "admin", clientIds: [cafam] });
  assert.deepEqual(await memberClientIds(db, adm.id), []);
  const maria = Number((await rows("SELECT id FROM users WHERE username = 'maria.perez'"))[0].id);
  assert.deepEqual((await listClientsOf(db, maria)).map((c) => c.id), [cafam]);
  assert.ok((await listClients(db)).length >= 2);
  // cambiarle los clientes
  await updateUser(db, admin, maria, { name: "María Pérez", email: "maria@ogilvy.com", role: "operador", clientIds: [cafam, otro] });
  assert.deepEqual((await listClientsOf(db, maria)).map((c) => c.id).sort(), [cafam, otro].sort());
  await updateUser(db, admin, maria, { name: "María Pérez", email: "maria@ogilvy.com", role: "operador", clientIds: [otro] });
  assert.deepEqual(await memberClientIds(db, maria), [otro]);
  // un cliente archivado no sale en su lista
  await db.query("UPDATE clients SET archived_at = NOW() WHERE id = ?", [otro]);
  assert.deepEqual(await listClientsOf(db, maria), []);
  await db.query("UPDATE clients SET archived_at = NULL WHERE id = ?", [otro]);
  // al pasar a administrador se quitan las asignaciones; al volver a otro rol, el rol se copia a sus clientes
  await updateUser(db, admin, maria, { name: "María Pérez", email: "maria@ogilvy.com", role: "admin", clientIds: [otro] });
  assert.deepEqual(await memberClientIds(db, maria), []);
  await updateUser(db, admin, maria, { name: "María Pérez", email: "maria@ogilvy.com", role: "verificador", clientIds: [cafam] });
  assert.deepEqual((await rows("SELECT role FROM client_members WHERE user_id = ?", [maria])).map((m) => m.role), ["verificador"]);
});

test("restablecer: contraseña temporal nueva, sesiones cerradas, bloqueo quitado y debe cambiarla", async () => {
  const r = await createUser(db, admin, { username: "luis.gomez", name: "Luis Gómez", role: "operador", clientIds: [cafam] });
  await changeOwnPassword(db, r.id, r.password, "mi-clave-propia-1", "mi-clave-propia-1");
  assert.equal((await loadAccess(db, r.id))!.mustChange, false);
  const token = await startSession(db, r.id);
  assert.equal(await sessionValid(db, token), r.id);
  for (let i = 0; i < 5; i++) assert.equal(await login(db, "luis.gomez", "mala"), null);
  assert.equal(await login(db, "luis.gomez", "mi-clave-propia-1"), "bloqueado");
  const nueva = await resetPassword(db, admin, r.id);
  assert.equal(nueva.username, "luis.gomez");
  assert.equal(await sessionValid(db, token), null, "la sesión anterior ya no sirve");
  assert.equal(await login(db, "luis.gomez", "mi-clave-propia-1"), null, "la anterior no entra");
  assert.equal(await login(db, "luis.gomez", nueva.password), r.id, "ni el bloqueo impide entrar con la temporal");
  assert.equal((await loadAccess(db, r.id))!.mustChange, true);
  await assert.rejects(resetPassword(db, admin, admin), /Mi cuenta/);
  await assert.rejects(resetPassword(db, admin, 999999), /ya no existe/);
});

test("cambiar mi contraseña: pide la actual, la nueva distinta y larga, cierra las demás sesiones", async () => {
  const r = await createUser(db, admin, { username: "pedro.leal", name: "Pedro Leal", role: "verificador", clientIds: [cafam] });
  const viejo = await startSession(db, r.id);
  await assert.rejects(changeOwnPassword(db, r.id, "otra", "nueva-clave-12", "nueva-clave-12"), /actual no coincide/);
  await assert.rejects(changeOwnPassword(db, r.id, r.password, "nueva-clave-12", "distinta-clave"), /no coinciden/);
  await assert.rejects(changeOwnPassword(db, r.id, r.password, r.password, r.password), /distinta de la actual/);
  await assert.rejects(changeOwnPassword(db, r.id, r.password, "corta", "corta"), /8 caracteres/);
  await assert.rejects(changeOwnPassword(db, r.id, r.password, "pedro.leal", "pedro.leal"), /igual al usuario/);
  await changeOwnPassword(db, r.id, r.password, "nueva-clave-12", "nueva-clave-12");
  assert.equal(await login(db, "pedro.leal", "nueva-clave-12"), r.id);
  assert.equal((await loadAccess(db, r.id))!.mustChange, false);
  assert.equal(await sessionValid(db, viejo), null);
  assert.equal(await sessionValid(db, await startSession(db, r.id)), r.id);
});

test("desactivar: no entra, pierde la sesión al instante y se puede reactivar sin perder sus datos", async () => {
  const r = await createUser(db, admin, { username: "sofia.mora", name: "Sofía Mora", role: "operador", clientIds: [cafam] });
  const token = await startSession(db, r.id);
  await setActive(db, admin, r.id, false);
  assert.equal(await sessionValid(db, token), null);
  assert.equal(await login(db, "sofia.mora", r.password), null, "responde como una contraseña mala");
  assert.equal(await loadAccess(db, r.id), null);
  assert.ok((await listUsers(db)).some((u) => u.id === r.id && !u.active), "sigue en la lista");
  assert.deepEqual(await memberClientIds(db, r.id), [cafam], "conserva sus clientes");
  await setActive(db, admin, r.id, true);
  assert.equal(await login(db, "sofia.mora", r.password), r.id);
});

test("siempre queda un administrador activo y nadie se quita el acceso a sí mismo", async () => {
  const otroAdmin = Number((await rows("SELECT id FROM users WHERE username = 'otro.admin'"))[0].id);
  await assert.rejects(setActive(db, admin, admin, false), /a ti mismo/);
  await assert.rejects(updateUser(db, admin, admin, { name: "Administrador", role: "operador", clientIds: [cafam] }), /a ti mismo/);
  // con dos administradores activos, uno puede desactivar al otro; el último ya no se puede tocar
  await setActive(db, admin, otroAdmin, false);
  await assert.rejects(setActive(db, otroAdmin, admin, false), /al menos un administrador/);
  await assert.rejects(updateUser(db, otroAdmin, admin, { name: "Administrador", role: "operador", clientIds: [] }), /al menos un administrador/);
  assert.equal((await loadAccess(db, admin))!.role, "admin");
  // con dos activos sí se puede bajar a uno de rol
  await setActive(db, admin, otroAdmin, true);
  await updateUser(db, admin, otroAdmin, { name: "Otro Admin", role: "operador", clientIds: [cafam] });
  assert.equal((await loadAccess(db, otroAdmin))!.role, "operador");
  await assert.rejects(updateUser(db, admin, otroAdmin, { name: "Otro Admin", role: "no-existe", clientIds: [] }), /rol/);
});

test("quitar el bloqueo y el registro de administración, sin contraseñas", async () => {
  const r = await createUser(db, admin, { username: "juan.rios", name: "Juan Ríos", role: "operador", clientIds: [cafam] });
  for (let i = 0; i < 5; i++) await login(db, "juan.rios", "mala");
  assert.equal(await login(db, "juan.rios", r.password), "bloqueado");
  await unlockUser(db, admin, r.id);
  assert.equal(await login(db, "juan.rios", r.password), r.id);
  await assert.rejects(unlockUser(db, admin, 999999), UserError);

  const events = await listUserEvents(db, 100);
  const mine = events.filter((e) => e.target === "Juan Ríos").map((e) => e.action);
  assert.deepEqual(mine.sort(), ["crear", "desbloquear"]);
  assert.ok(events.every((e) => e.actor), "cada movimiento dice quién lo hizo");
  const raw = JSON.stringify(await rows("SELECT * FROM user_events"));
  assert.ok(!raw.includes(r.password), "el registro no guarda contraseñas");
  assert.ok(events.some((e) => e.action === "restablecer") && events.some((e) => e.action === "desactivar") && events.some((e) => e.action === "cambiar_clave"));
});

test("los usuarios que ya existían quedan como administradores y se ven en la lista", async () => {
  await db.query("INSERT INTO users (username, name, password_hash) VALUES ('vieja', 'Cuenta vieja', NULL)");
  const v = (await listUsers(db)).find((u) => u.username === "vieja")!;
  assert.equal(v.role, "admin");
  assert.equal(v.active, true);
  assert.equal(v.mustChange, false);
  assert.equal(v.lastLogin, null);
});

test("permisos por rol: cada uno ve lo suyo y solo el administrador configura y administra", () => {
  assert.deepEqual(ALLOWED.config, ["admin"]);
  assert.deepEqual(ALLOWED.usuarios, ["admin"]);
  assert.equal(can("operador", "bandeja"), true);
  assert.equal(can("operador", "pruebas"), false);
  assert.equal(can("verificador", "pruebas"), true);
  assert.equal(can("verificador", "bandeja"), false);
  assert.equal(can("operador", "config"), false);
  assert.equal(can("verificador", "usuarios"), false);
  assert.equal(can("admin", "bandeja") && can("admin", "pruebas") && can("admin", "config") && can("admin", "usuarios"), true);
});
