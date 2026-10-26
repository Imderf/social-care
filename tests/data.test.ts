// Aislamiento entre clientes: MySQL no tiene RLS, así que cada lectura y escritura del panel se prueba aquí.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import * as data from "../src/lib/data.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
const clients: { id: number; interaction: number; contact: number }[] = [];

async function insert(sql: string, params: unknown[]) {
  return (await db.query<ResultSetHeader>(sql, params))[0].insertId;
}

before(async () => {
  db = await freshTestDb();
  for (const name of ["Cliente A", "Cliente B"]) {
    const c = await insert("INSERT INTO clients (name) VALUES (?)", [name]);
    const ct = await insert("INSERT INTO case_types (client_id, position, code, name, autonomy) VALUES (?, 1, 'x', ?, 'automatica')", [c, name]);
    await insert("INSERT INTO templates (client_id, code, name, channel, body) VALUES (?, 'P1', ?, 'publico', ?)", [c, name, name]);
    await insert("INSERT INTO knowledge_items (client_id, topic, title, content) VALUES (?, 'enlace', ?, ?)", [c, name, name]);
    const acc = await insert("INSERT INTO accounts (client_id, platform, meta_id, name) VALUES (?, 'fb', ?, ?)", [c, `page-${c}`, name]);
    const contact = await insert("INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, 'fb', 'u1', ?)", [c, name]);
    // Dos interacciones del mismo usuario: una propuesta de respuesta (prueba) y una escalada.
    const i = await insert(
      `INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked, case_type_id, decision, mode, proposed_reply, answered_by)
       VALUES (?, ?, 'comentario', 'c1', ?, ?, ?, 'responder', 'prueba', ?, 'persona')`,
      [c, acc, contact, name, ct, name],
    );
    const i2 = await insert(
      "INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked, case_type_id, decision) VALUES (?, ?, 'comentario', 'c2', ?, ?, ?, 'escalar')",
      [c, acc, contact, name, ct],
    );
    await insert("INSERT INTO escalations (client_id, interaction_id, reason, priority) VALUES (?, ?, ?, 'critica')", [c, i2, name]);
    clients.push({ id: c, interaction: i, contact });
  }
});
after(() => db.end());

test("cada lectura del panel solo trae datos del cliente pedido", async () => {
  const [a, b] = clients;
  const lists = [data.listCaseTypes, data.listTemplates, data.listKnowledge, data.listAccounts, data.listOpenEscalations, data.listProposals];
  for (const list of lists) {
    const rowsA = await list(db, a.id);
    assert.equal(rowsA.length, 1, list.name);
    assert.ok(!JSON.stringify(rowsA).includes("Cliente B"), `${list.name} filtra datos de otro cliente`);
    assert.equal((await list(db, b.id)).length, 1, list.name);
  }
  assert.equal((await data.listInteractions(db, a.id)).length, 2);
  assert.equal((await data.listInteractions(db, a.id, "todas", "Cliente B")).length, 0, "la búsqueda no cruza clientes");
  // El historial de un usuario no trae interacciones de otro cliente aunque se pida su contacto.
  assert.equal((await data.listContactHistory(db, a.id, b.contact, 0)).length, 0);
  assert.equal((await data.listContactHistory(db, a.id, a.contact, a.interaction)).length, 1);
});

test("el resumen cuenta solo lo del cliente", async () => {
  const o = await data.getOverview(db, clients[0].id);
  assert.equal(o.receivedToday, 2);
  assert.equal(o.openEscalations, 1);
  assert.equal(o.criticalEscalations, 1);
  assert.equal(o.accounts, 1);
  assert.equal(o.liveAccounts, 0, "las cuentas nuevas quedan en modo prueba");
  assert.equal(o.toVerify, 1);

  const d = await data.getDashboard(db, clients[0].id, 7);
  assert.equal(d.current.received, 2);
  assert.equal(d.daily.length, 7);
  assert.equal(d.daily.at(-1)!.responder, 1, "la interacción de hoy cae en el último día");
  assert.equal(d.daily.at(-1)!.escalar, 1);
});

test("una verificación no puede tocar interacciones de otro cliente", async () => {
  const [a, b] = clients;
  assert.equal(await data.saveVerification(db, a.id, b.interaction, "correcta", null), false);
  const [none] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM verifications WHERE interaction_id = ?", [b.interaction]);
  assert.equal(none[0].n, 0);

  assert.equal(await data.saveVerification(db, a.id, a.interaction, "corregir", "faltó el enlace"), true);
  assert.equal(await data.saveVerification(db, a.id, a.interaction, "correcta", null), true, "volver a marcar reemplaza");
  const [rows] = await db.query<RowDataPacket[]>("SELECT verdict, client_id FROM verifications WHERE interaction_id = ?", [a.interaction]);
  assert.deepEqual({ ...rows[0] }, { verdict: "correcta", client_id: a.id });
  assert.equal((await data.getOverview(db, a.id)).toVerify, 0);
  assert.equal((await data.getOverview(db, b.id)).toVerify, 1);
});

test("la precisión por tipo exige verificaciones mínimas antes de declarar un tipo listo", async () => {
  const [a] = clients;
  const [type] = await data.getAccuracyByType(db, a.id);
  assert.equal(type.proposals, 1);
  assert.equal(type.verified, 1);
  assert.equal(type.accuracy, 1);
  assert.equal(type.status, "faltan", "100 % con una sola verificación todavía no alcanza");
});

test("getClient usa el cliente pedido y si no existe cae al primero", async () => {
  assert.equal((await data.getClient(db, clients[1].id))?.name, "Cliente B");
  assert.equal((await data.getClient(db, 999999))?.name, "Cliente A");
});
