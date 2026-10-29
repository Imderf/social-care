// Enlaces para crear la contraseña: la cuenta nace sin contraseña, el enlace sirve una vez, vence, uno nuevo anula el
// anterior y restablecer deja sin efecto la contraseña vieja.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { login, saveUser, sessionValid, sign, signShort, startSession } from "../src/lib/auth.ts";
import { createClient } from "../src/lib/data.ts";
import { acceptInvitation, createUser, invitationInfo, inviteUser, listUserEvents, listUsers, setActive } from "../src/lib/users.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let admin = 0;
let cafam = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const nueva = (u: string, extra: Record<string, unknown> = {}) => createUser(db, admin, { username: u, name: `Persona ${u}`, role: "operador", clientIds: [cafam], ...extra });

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  process.env.SESSION_SECRET ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  await saveUser(db, "admin", "Administrador", "clave-larga-1");
  admin = Number((await rows("SELECT id FROM users WHERE username = 'admin'"))[0].id);
  cafam = await createClient(db, "Droguerías Cafam", null);
});
after(() => db.end());

test("crear con enlace: la cuenta nace sin contraseña, no entra con nada y queda pendiente", async () => {
  const r = await nueva("luna.barbosa");
  assert.ok(r.token && r.password === null);
  const [u] = await rows("SELECT password_hash, must_change_password FROM users WHERE id = ?", [r.id]);
  assert.equal(u.password_hash, null);
  assert.equal(u.must_change_password, 0);
  for (const intento of ["", "luna.barbosa", "cualquiera-1234", r.token!]) assert.equal(await login(db, "luna.barbosa", intento), null);
  const info = (await listUsers(db)).find((x) => x.id === r.id)!;
  assert.equal(info.pending, true);
  assert.deepEqual(await invitationInfo(db, r.token), { name: "Persona luna.barbosa", username: "luna.barbosa" });
  // el modo temporal sigue existiendo y no deja la cuenta pendiente
  const t = await nueva("con.temporal", { mode: "temporal" });
  assert.ok(t.password && t.token === null);
  assert.equal((await listUsers(db)).find((x) => x.id === t.id)!.pending, false);
});

test("el enlace solo vale si es el suyo: firmado, de invitación, vigente y de una cuenta pendiente", async () => {
  const r = await nueva("pablo.botero", { role: "verificador" });
  assert.equal(await invitationInfo(db, undefined), null);
  assert.equal(await invitationInfo(db, "basura"), null);
  assert.match(r.token!, /^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+-.{16}$/, "código corto");
  assert.ok(r.token!.length <= 40, `el enlace es corto (${r.token!.length})`);
  assert.equal(await invitationInfo(db, r.token!.replace(/^[0-9a-z]+-/, "zz-")), null, "cambiar de persona rompe la firma");
  assert.equal(await invitationInfo(db, r.token!.slice(0, -1) + (r.token!.endsWith("a") ? "b" : "a")), null, "cambiar la firma la rompe");
  assert.equal(await invitationInfo(db, sign("sesion", [r.id, 1], 600)), null, "una sesión no es una invitación");
  assert.equal(await invitationInfo(db, signShort("invitacion", r.id, 1, 60, Date.now() - 7_200_000)), null, "vencido");
  assert.equal(await invitationInfo(db, signShort("invitacion", r.id, 7, 600)), null, "versión que no es la de la cuenta");
  assert.equal(await invitationInfo(db, signShort("sesion", r.id, 1, 600)), null, "otro propósito");
  // los enlaces largos de antes siguen valiendo hasta que venzan
  assert.equal(await invitationInfo(db, sign("invitacion", [r.id, 1], 60, Date.now() - 3_600_000)), null, "largo vencido");
  assert.equal(await invitationInfo(db, sign("invitacion", [r.id, 7], 600)), null, "largo con otra versión");
  assert.ok(await invitationInfo(db, sign("invitacion", [r.id, 1], 600)), "largo vigente");
  assert.ok(await invitationInfo(db, r.token));
});

test("crear la contraseña: valida, guarda, abre la sesión y gasta el enlace", async () => {
  const r = await nueva("sebastian.villalobos", { role: "verificador" });
  await assert.rejects(acceptInvitation(db, r.token, "una-clave-larga-1", "otra-distinta-2"), /no coinciden/);
  await assert.rejects(acceptInvitation(db, r.token, "corta", "corta"), /8 caracteres/);
  await assert.rejects(acceptInvitation(db, r.token, "sebastian.villalobos", "sebastian.villalobos"), /igual al usuario/);
  assert.ok(await invitationInfo(db, r.token), "un intento fallido no gasta el enlace");

  const id = await acceptInvitation(db, r.token, "mi-clave-nueva-1", "mi-clave-nueva-1");
  assert.equal(id, r.id);
  assert.equal(await login(db, "sebastian.villalobos", "mi-clave-nueva-1"), r.id);
  assert.equal(await sessionValid(db, await startSession(db, r.id)), r.id);
  assert.equal((await listUsers(db)).find((x) => x.id === r.id)!.pending, false);
  // el mismo enlace no sirve dos veces ni para cambiar una contraseña ya creada
  assert.equal(await invitationInfo(db, r.token), null);
  await assert.rejects(acceptInvitation(db, r.token, "otra-clave-nueva-9", "otra-clave-nueva-9"), /ya se usó o venció/);
  assert.equal(await login(db, "sebastian.villalobos", "mi-clave-nueva-1"), r.id, "la contraseña no cambió");
  const ev = (await listUserEvents(db, 50)).filter((e) => e.target === "Persona sebastian.villalobos").map((e) => e.action);
  assert.ok(ev.includes("crear") && ev.includes("crear_clave"));
});

test("un enlace nuevo anula el anterior y restablecer deja sin efecto la contraseña vieja y las sesiones", async () => {
  const r = await nueva("jennifer.beltran");
  const primero = r.token!;
  const segundo = (await inviteUser(db, admin, r.id)).token;
  assert.equal(await invitationInfo(db, primero), null, "el anterior dejó de servir");
  assert.ok(await invitationInfo(db, segundo));
  await acceptInvitation(db, segundo, "clave-original-1", "clave-original-1");

  const viejaSesion = await startSession(db, r.id);
  assert.equal(await sessionValid(db, viejaSesion), r.id);
  const reset = await inviteUser(db, admin, r.id);
  assert.equal(await login(db, "jennifer.beltran", "clave-original-1"), null, "la contraseña vieja ya no entra");
  assert.equal(await sessionValid(db, viejaSesion), null, "y su sesión se cerró");
  assert.equal((await listUsers(db)).find((x) => x.id === r.id)!.pending, true);
  await acceptInvitation(db, reset.token, "clave-nueva-2", "clave-nueva-2");
  assert.equal(await login(db, "jennifer.beltran", "clave-nueva-2"), r.id);
});

test("no se manda un enlace a uno mismo ni a una cuenta desactivada, y esa cuenta no puede usar uno viejo", async () => {
  await assert.rejects(inviteUser(db, admin, admin), /Mi cuenta/);
  await assert.rejects(inviteUser(db, admin, 999999), /ya no existe/);
  const r = await nueva("desactivada.uno");
  await setActive(db, admin, r.id, false);
  await assert.rejects(inviteUser(db, admin, r.id), /desactivada/);
  assert.equal(await invitationInfo(db, r.token), null);
  await assert.rejects(acceptInvitation(db, r.token, "clave-larga-77", "clave-larga-77"), /ya se usó o venció/);
  await setActive(db, admin, r.id, true);
  assert.equal(await invitationInfo(db, r.token), null, "reactivar sube la versión: el enlace viejo no vuelve a servir");
  assert.ok(await invitationInfo(db, (await inviteUser(db, admin, r.id)).token));
});

test("un script de administración puede crear personas sin un administrador como autor", async () => {
  const r = await createUser(db, null, { username: "desde.script", name: "Desde Script", role: "operador", clientIds: [cafam] });
  assert.ok(r.token);
  const ev = (await listUserEvents(db, 50)).find((e) => e.target === "Desde Script");
  assert.equal(ev?.action, "crear");
  assert.equal(ev?.actor, null);
});
