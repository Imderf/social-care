// Clientes: se crean vacíos o con la configuración de otro (nunca sus datos), se archivan sin
// borrarse, y un cliente sin matriz no se clasifica: lo atiende una persona.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createClient, listClients, setClientArchived } from "../src/lib/data.ts";
import { classifyInteraction } from "../src/lib/classify.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let base = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const count = async (table: string, client: number) => Number((await rows(`SELECT COUNT(*) AS n FROM ${table} WHERE client_id = ?`, [client]))[0].n);

before(async () => {
  db = await freshTestDb();
  base = await insert("INSERT INTO clients (name) VALUES ('Pruebas internas')", []);
  await seedConfig(db as any, base);
  const acc = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'fb', 'P1', 'P1', 'Página', 'x')", [base]);
  await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked) VALUES (?, ?, 'comentario', 'c1', 'Hola')", [base, acc]);
});
after(() => db.end());

test("copia la matriz, las plantillas y la base, pero no las cuentas ni los mensajes", async () => {
  const id = await createClient(db, "Droguerías Cafam", base);
  for (const t of ["case_types", "templates", "knowledge_items"]) assert.equal(await count(t, id), await count(t, base), t);
  assert.equal(await count("accounts", id), 0);
  assert.equal(await count("interactions", id), 0);
});

test("archivar lo saca del selector y desconecta sus cuentas; restaurar lo devuelve", async () => {
  await setClientArchived(db, base, true);
  assert.ok(!(await listClients(db)).some((c) => c.id === base));
  assert.deepEqual((await rows("SELECT status, mode FROM accounts WHERE client_id = ?", [base])).map((a) => [a.status, a.mode]), [["desconectada", "prueba"]]);
  await setClientArchived(db, base, false);
  assert.ok((await listClients(db)).some((c) => c.id === base));
  assert.equal(await count("interactions", base), 1, "archivar no borra datos");
});

test("un cliente en blanco no llama a la IA: el mensaje pasa a una persona", async () => {
  const blank = await createClient(db, "Nuevo", null);
  assert.equal(await count("case_types", blank), 0);
  const acc = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'fb', 'P2', 'P2', 'Página', 'x')", [blank]);
  const i = await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked) VALUES (?, ?, 'comentario', 'c2', 'Hola')", [blank, acc]);
  const r = await classifyInteraction(db, i, async () => assert.fail("no debe llamar a la IA"));
  assert.equal(r?.decision, "escalar");
  assert.equal(await count("escalations", blank), 1);
});
