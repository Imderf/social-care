// Base de prueba en el MySQL local (ver CLAUDE.md): se borra y se recrea con las migraciones.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { migrate } from "../db/migrate.ts";

export async function freshTestDb() {
  const uri = process.env.TEST_DATABASE_URL || "mysql://root@127.0.0.1:3307/social_care_test";
  const name = new URL(uri).pathname.slice(1);
  assert.match(name, /_test$/, "la base de prueba debe terminar en _test: se borra en cada corrida");

  const admin = await mysql.createConnection({ uri: uri.slice(0, uri.lastIndexOf("/") + 1) });
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  await migrate(uri);
  return mysql.createPool({ uri, timezone: "Z" });
}
