// Bandeja: una persona envía, oculta o resuelve el caso; lo que envía cuenta como respuesta del
// equipo. Y en Pruebas, ocultar en vez de responder.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { resolveWithoutReply, sendFromInbox, undoInboxSend } from "../src/lib/inbox.ts";
import { publishAction } from "../src/lib/publish.ts";
import { reviewProposal } from "../src/lib/learning.ts";
import { saveConnectedAccount } from "../src/lib/data.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let live = 0;
let test_ = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
let n = 0;
// Un caso escalado: la interacción y su escalamiento abierto.
const escalated = async (account: number, kind = "comentario", window: Date | null = null) => {
  const i = await insert(
    "INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked, decision, proposed_reply, window_expires_at) VALUES (?, ?, ?, ?, 'Pésimo servicio', 'escalar', 'contención', ?)",
    [client, account, kind, `e${++n}`, window],
  );
  return { i, e: await insert("INSERT INTO escalations (client_id, interaction_id, reason, suggested_draft) VALUES (?, ?, 'Queja', '¡Hola! Lamentamos lo ocurrido.')", [client, i]) };
};
const fakeMeta = { replyToComment: async () => "r1", hideComment: async () => null, sendMessage: async () => "m1" };
const lastAction = async (i: number) => (await rows("SELECT id, type, status, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.by')) AS by_ FROM actions WHERE interaction_id = ?", [i]))[0];

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  live = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, mode, token_encrypted) VALUES (?, 'fb', 'P1', 'P1', 'Página', 'en_vivo', ?)", [client, encryptToken("t")]);
  test_ = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'ig', 'I1', 'P1', '@a', ?)", [client, encryptToken("t")]);
});
after(() => db.end());

test("lo que envía una persona desde la bandeja sale como respuesta del equipo y cierra el caso", async () => {
  const { i, e } = await escalated(live);
  assert.deepEqual(await sendFromInbox(db, client, e, { text: "¡Hola! Te escribimos por DM." }), { ok: true });
  const x = await lastAction(i);
  assert.deepEqual([x.type, x.by_], ["responder", "equipo"]);
  await publishAction(db, x.id, fakeMeta as any);
  const [r] = await rows("SELECT answered_by, human_reply FROM interactions WHERE id = ?", [i]);
  assert.deepEqual([r.answered_by, r.human_reply], ["persona", "¡Hola! Te escribimos por DM."], "es ejemplo de cómo responde el equipo");
  assert.ok((await rows("SELECT resolved_at FROM escalations WHERE id = ?", [e]))[0].resolved_at);
});

test("ocultar, deshacer y resolver sin responder", async () => {
  const hide = await escalated(live);
  await sendFromInbox(db, client, hide.e, { hide: true });
  assert.equal((await lastAction(hide.i)).type, "ocultar");
  assert.equal(await undoInboxSend(db, client, hide.e), "cancelada", "antes de salir se puede deshacer");
  assert.equal(await lastAction(hide.i), undefined);

  const done = await escalated(live);
  await resolveWithoutReply(db, client, done.e);
  assert.ok((await rows("SELECT resolved_at FROM escalations WHERE id = ?", [done.e]))[0].resolved_at);
  assert.equal((await sendFromInbox(db, client, done.e, { text: "x" })).ok, false, "un caso cerrado no se envía");
});

test("no se envía desde la plataforma en modo prueba ni con la ventana de DM vencida", async () => {
  const t = await escalated(test_);
  assert.match((await sendFromInbox(db, client, t.e, { text: "Hola" })).error!, /modo prueba/);
  const late = await escalated(live, "dm", new Date(Date.now() - 36e5));
  assert.match((await sendFromInbox(db, client, late.e, { text: "Hola" })).error!, /24 h/);
  const ok = await escalated(live, "dm", new Date(Date.now() + 36e5));
  assert.equal((await sendFromInbox(db, client, ok.e, { text: "Hola" })).ok, true);
  assert.equal((await lastAction(ok.i)).type, "dm");
});

test("en Pruebas, ocultar en vez de responder cuenta como error de la IA y oculta", async () => {
  const i = await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked, decision, proposed_reply) VALUES (?, ?, 'comentario', 'h1', 'Spam', 'responder', '¡Hola!')", [client, live]);
  assert.deepEqual(await reviewProposal(db, client, i, { hide: true }), { verdict: "incorrecta", published: true });
  assert.equal((await lastAction(i)).type, "ocultar");
});

test("una cuenta desconectada se puede conectar a otro cliente, y entra en modo prueba", async () => {
  const other = await insert("INSERT INTO clients (name) VALUES ('Nuevo')", []);
  const acc = { platform: "fb" as const, metaId: "P1", pageId: "P1", name: "Página", tokenEncrypted: encryptToken("t") };
  assert.equal(await saveConnectedAccount(db, other, acc), "otro_cliente", "conectada a otro cliente: no se toca");
  await db.query("UPDATE accounts SET status = 'desconectada' WHERE id = ?", [live]);
  assert.equal(await saveConnectedAccount(db, other, acc), "ok");
  const [a] = await rows("SELECT client_id, mode, status FROM accounts WHERE id = ?", [live]);
  assert.deepEqual([a.client_id, a.mode, a.status], [other, "prueba", "conectada"]);
});
