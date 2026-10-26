// Interacciones por persona: comentarios y DM del mismo usuario quedan juntos, el DM pide el nombre
// a Meta una sola vez, y lo que llega del historial sin autor no se mezcla.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { processMetaEvent } from "../src/lib/meta-events.ts";
import { countUnidentified, listContactTimeline, listContacts } from "../src/lib/data.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let account = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const event = (payload: unknown) => insert("INSERT INTO webhook_events (dedupe_key, payload) VALUES (UUID(), ?)", [JSON.stringify(payload)]);
const dm = (mid: string, text: string, t: number) => ({ object: "page", entry: [{ id: "P1", time: t, messaging: [{ sender: { id: "u5" }, recipient: { id: "P1" }, timestamp: t, message: { mid, text } }] }] });
const comment = (id: string, text: string) => ({
  object: "page",
  entry: [{ id: "P1", time: 1761062400, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: id, post_id: "P1_post", parent_id: "P1_post", from: { id: "u5" }, message: text, created_time: 1761062400 } }] }],
});

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  account = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'fb', 'P1', 'P1', 'Página', ?)", [client, encryptToken("t")]);
});
after(() => db.end());

test("el DM sin nombre lo pide a Meta una vez, y comentario y DM quedan en la misma persona", async () => {
  let asked = 0;
  const name = async () => (asked++, "Laura Gómez");
  const noText = async () => "";
  await processMetaEvent(db, await event(dm("m1", "Hola, mi pedido no llega", 1761062500000)), noText, name);
  await processMetaEvent(db, await event(dm("m2", "¿Me ayudan?", 1761062600000)), noText, name);
  await processMetaEvent(db, await event(comment("c1", "Pésimo servicio")), noText, name);
  assert.equal(asked, 1, "con el nombre guardado no vuelve a preguntar");

  const [p] = await listContacts(db, client);
  assert.deepEqual([p.username, Number(p.total), Number(p.comments), Number(p.dms)], ["Laura Gómez", 3, 1, 2]);
  assert.equal((await listContacts(db, client, "lau")).length, 1, "se busca por nombre");
  assert.equal((await listContacts(db, client, "pedro")).length, 0);

  const timeline = await listContactTimeline(db, client, p.id);
  assert.equal(timeline.length, 3);
  assert.ok(new Date(timeline[0].received_at) >= new Date(timeline[2].received_at), "lo más reciente primero");
});

test("los comentarios del historial sin autor no se agrupan como persona, pero se cuentan", async () => {
  const c = await insert("INSERT INTO contacts (client_id, platform, meta_user_id) VALUES (?, 'fb', 'sin_id:c9')", [client]);
  await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked) VALUES (?, ?, 'comentario', 'c9', ?, 'Hola')", [client, account, c]);
  assert.ok(!(await listContacts(db, client)).some((x) => x.id === c));
  assert.equal(await countUnidentified(db, client), 1);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM contacts WHERE client_id = ?", [client]))[0].n, 2);
});
