// Ingreso: contraseñas con scrypt, textos firmados que no se pueden alterar ni reutilizar para otro
// propósito, y bloqueo tras 5 intentos fallidos.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { hashPassword, login, saveUser, sessionUser, sign, verify, verifyPassword } from "../src/lib/auth.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  process.env.SESSION_SECRET ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
});
after(() => db.end());

test("la contraseña se guarda cifrada y solo coincide la correcta", async () => {
  const h = await hashPassword("clave-larga-1");
  assert.ok(!h.includes("clave-larga-1"));
  assert.equal(await verifyPassword("clave-larga-1", h), true);
  assert.equal(await verifyPassword("clave-larga-2", h), false);
  assert.equal(await verifyPassword("x", null), false);
});

test("un texto firmado no se puede alterar, vence y no sirve para otro propósito", () => {
  const t = sign("sesion", [7], 60);
  assert.equal(sessionUser(t), 7);
  assert.equal(sessionUser(t.replace(/^7\./, "8.")), null, "cambiar el usuario rompe la firma");
  assert.equal(verify("conectar", t), null, "una sesión no es un permiso de conexión");
  assert.equal(verify("sesion", t, Date.now() + 61_000), null, "vencido");
  assert.equal(sessionUser(undefined), null);
  assert.equal(sessionUser("basura"), null);
});

test("ingresa con usuario y contraseña, y se bloquea tras 5 fallos", async () => {
  await saveUser(db, "Admin", "Administrador", "clave-larga-1");
  const [u] = (await db.query<RowDataPacket[]>("SELECT id, username, password_hash FROM users"))[0];
  assert.equal(u.username, "admin");
  assert.equal(await login(db, "ADMIN", "clave-larga-1"), Number(u.id), "el usuario no distingue mayúsculas");
  assert.equal(await login(db, "nadie", "clave-larga-1"), null);
  for (let i = 0; i < 5; i++) assert.equal(await login(db, "admin", "mala"), null);
  assert.equal(await login(db, "admin", "clave-larga-1"), "bloqueado", "ni con la correcta mientras dura el bloqueo");
  await assert.rejects(saveUser(db, "admin", "x", "corta"), /8 caracteres/);
  await saveUser(db, "admin", "Administrador", "otra-clave-9");
  assert.equal((await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users"))[0][0].n, 1, "cambia la contraseña, no duplica");
});
