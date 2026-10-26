// Editores de plantillas y de la matriz: versiones, activar y desactivar, tipos nuevos con clave
// única, y que la IA reciba siempre lo vigente.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getCaseType, saveCaseType, saveTemplate, setTemplateActive } from "../src/lib/data.ts";
import { buildSchema, loadMatrix } from "../src/lib/classify.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;

before(async () => {
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  await seedConfig(db as any, client);
});
after(() => db.end());

test("editar una plantilla crea una versión nueva; la IA recibe la vigente; desactivada no la recibe", async () => {
  await saveTemplate(db, client, { code: "P9", channel: "publico", name: "Precio", body: "¡Hola {usuario}! Mira los precios en la web 💙" });
  const versions = await rows("SELECT version, active FROM templates WHERE client_id = ? AND code = 'P9' AND channel = 'publico' ORDER BY version", [client]);
  assert.deepEqual(versions.map((v) => [v.version, !!v.active]), [[1, false], [2, true]]);
  let m = await loadMatrix(db, client);
  assert.equal(m.templates.find((t) => t.code === "P9")?.body, "¡Hola {usuario}! Mira los precios en la web 💙");

  await setTemplateActive(db, client, "P9", "publico", false);
  m = await loadMatrix(db, client);
  assert.ok(!m.templates.some((t) => t.code === "P9"));
  await setTemplateActive(db, client, "P9", "publico", true);
  assert.equal((await rows("SELECT version FROM templates WHERE client_id = ? AND code = 'P9' AND active", [client]))[0].version, 2, "vuelve la última versión");
});

const base = { description: null, examples: ["¿Tienen parqueadero?"], threshold: 0.85, public_action: "P3 pública", private_action: null, record_target: null, alert: null, active: true };

test("un tipo nuevo recibe una clave única y la IA lo puede elegir; inactivo, no", async () => {
  const a = await saveCaseType(db, client, null, { ...base, name: "Parqueaderos y accesos", autonomy: "automatica" });
  const b = await saveCaseType(db, client, null, { ...base, name: "Parqueaderos y accesos", autonomy: "automatica" });
  assert.deepEqual([(await getCaseType(db, client, a)).code, (await getCaseType(db, client, b)).code], ["parqueaderos_y_accesos", "parqueaderos_y_accesos_2"]);
  let m = await loadMatrix(db, client);
  assert.ok(buildSchema(m.types, m.templates).properties.tipo_caso.enum.includes("parqueaderos_y_accesos"));

  await saveCaseType(db, client, b, { ...base, name: "Parqueaderos (duplicado)", autonomy: "automatica", active: false });
  m = await loadMatrix(db, client);
  assert.ok(!m.types.some((t) => t.code === "parqueaderos_y_accesos_2"));
});

test("si un tipo deja de ser automático, deja de responder solo", async () => {
  const [t] = await rows("SELECT id FROM case_types WHERE client_id = ? AND code = 'positivo_emoji'", [client]);
  await db.query("UPDATE case_types SET live_enabled = TRUE WHERE id = ?", [t.id]);
  await saveCaseType(db, client, t.id, { ...base, name: "Positivo o emoji", autonomy: "humana" });
  const after_ = await getCaseType(db, client, t.id);
  assert.deepEqual([after_.autonomy, !!after_.live_enabled, after_.code], ["humana", false, "positivo_emoji"], "la clave no cambia al editar");
  assert.equal(await getCaseType(db, 999, t.id), null, "otro cliente no lo ve");
});
