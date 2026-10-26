// Procesamiento de webhooks de Meta: comentarios y DM de Facebook e Instagram, respuestas del
// equipo, repeticiones y cuentas no conectadas, siempre dentro del cliente dueño de la cuenta.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { parseMetaEvent, processMetaEvent } from "../src/lib/meta-events.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let clientA = 0;
let clientB = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const event = (payload: unknown) => insert("INSERT INTO webhook_events (dedupe_key, payload) VALUES (UUID(), ?)", [JSON.stringify(payload)]);

const fbComment = (page: string, commentId: string, from: { id: string; name: string }, message: string, parent?: string) => ({
  object: "page",
  entry: [{ id: page, time: 1761062400, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: commentId, post_id: `${page}_post1`, parent_id: parent ?? `${page}_post1`, from, message, created_time: 1761062400 } }] }],
});

before(async () => {
  db = await freshTestDb();
  clientA = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  clientB = await insert("INSERT INTO clients (name) VALUES ('B')", []);
  await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name) VALUES (?, 'fb', '111', '111', 'Página A')", [clientA]);
  await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name) VALUES (?, 'ig', '222', '111', '@cuenta_a')", [clientA]);
  await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name) VALUES (?, 'fb', '333', '333', 'Página B')", [clientB]);
});
after(() => db.end());

test("un comentario de Facebook crea la interacción enmascarada, en modo prueba, y encola su clasificación", async () => {
  const id = await event(fbComment("111", "post1_c1", { id: "u1", name: "Ana Pérez" }, "Mi cédula 1234567890, llevo un mes sin la insulina"));
  assert.deepEqual(await processMetaEvent(db, id), { created: 1, duplicates: 0, replies: 0, unknownAccount: 0 });

  const [i] = await rows("SELECT * FROM interactions WHERE meta_id = 'post1_c1'");
  assert.equal(i.client_id, clientA);
  assert.equal(i.kind, "comentario");
  assert.equal(i.mode, "prueba");
  assert.equal(i.text_masked, "Mi cédula [documento], llevo un mes sin la insulina");
  assert.equal((await rows("SELECT username FROM contacts WHERE id = ?", [i.contact_id]))[0].username, "Ana Pérez");
  assert.equal((await rows("SELECT COUNT(*) AS n FROM jobs WHERE type = 'classify'"))[0].n, 1);
  const [ev] = await rows("SELECT processed_at, JSON_LENGTH(payload) AS keys_ FROM webhook_events WHERE id = ?", [id]);
  assert.ok(ev.processed_at);
  assert.equal(ev.keys_, 0, "el crudo (sin enmascarar) se vacía al procesarlo");

  // Meta reenvía el mismo comentario: no se duplica.
  assert.equal((await processMetaEvent(db, await event(fbComment("111", "post1_c1", { id: "u1", name: "Ana Pérez" }, "x")))).duplicates, 1);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM interactions WHERE meta_id = 'post1_c1'"))[0].n, 1);
});

test("la respuesta de la página a ese comentario queda como respuesta del equipo", async () => {
  const r = await processMetaEvent(db, await event(fbComment("111", "post1_c2", { id: "111", name: "Página A" }, "Hola Ana, te escribimos por DM", "post1_c1")));
  assert.equal(r.replies, 1);
  const [i] = await rows("SELECT human_reply, answered_by, first_response_at FROM interactions WHERE meta_id = 'post1_c1'");
  assert.deepEqual([i.human_reply, i.answered_by], ["Hola Ana, te escribimos por DM", "persona"]);
  assert.ok(i.first_response_at);
  // Un comentario de la página directo en su publicación no es respuesta a nadie.
  assert.equal((await processMetaEvent(db, await event(fbComment("111", "post1_c3", { id: "111", name: "Página A" }, "¡Gracias a todos!")))).replies, 0);
});

test("comentario y DM de Instagram, y el eco de la respuesta del equipo por DM", async () => {
  const igComment = { object: "instagram", entry: [{ id: "222", time: 1761062400, changes: [{ field: "comments", value: { id: "igc1", text: "💙", from: { id: "ig_u2", username: "maria.c" }, media: { id: "m1" } } }] }] };
  const dm = { object: "instagram", entry: [{ id: "222", time: 1761062500000, messaging: [{ sender: { id: "ig_u2" }, recipient: { id: "222" }, timestamp: 1761062500000, message: { mid: "mid1", text: "Mi celular es 300 123 4567" } }] }] };
  const echo = { object: "instagram", entry: [{ id: "222", time: 1761062600000, messaging: [{ sender: { id: "222" }, recipient: { id: "ig_u2" }, timestamp: 1761062600000, message: { mid: "mid2", text: "Hola María, ¿nos confirmas la ciudad?", is_echo: true } }] }] };

  assert.equal((await processMetaEvent(db, await event(igComment))).created, 1);
  assert.equal((await processMetaEvent(db, await event(dm))).created, 1);
  assert.equal((await processMetaEvent(db, await event(echo))).replies, 1);

  const [c] = await rows("SELECT text_masked, kind FROM interactions WHERE meta_id = 'igc1'");
  assert.deepEqual([c.text_masked, c.kind], ["💙", "comentario"]);
  const [d] = await rows("SELECT text_masked, kind, window_expires_at, received_at, human_reply FROM interactions WHERE meta_id = 'mid1'");
  assert.deepEqual([d.text_masked, d.kind, d.human_reply], ["Mi celular es [celular]", "dm", "Hola María, ¿nos confirmas la ciudad?"]);
  assert.equal(new Date(d.window_expires_at).getTime() - new Date(d.received_at).getTime(), 864e5, "ventana de 24 h");
});

test("cada evento cae en el cliente dueño de la cuenta; páginas no conectadas se ignoran", async () => {
  assert.equal((await processMetaEvent(db, await event(fbComment("333", "b_c1", { id: "u9", name: "Beto" }, "hola")))).created, 1);
  assert.equal((await rows("SELECT client_id FROM interactions WHERE meta_id = 'b_c1'"))[0].client_id, clientB);
  assert.equal((await processMetaEvent(db, await event(fbComment("999", "x_c1", { id: "u9", name: "Beto" }, "hola")))).unknownAccount, 1);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM interactions WHERE meta_id = 'x_c1'"))[0].n, 0);
});

test("un comentario de Facebook que llega sin texto se completa con la API, con el token de la página", async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  await db.query("UPDATE accounts SET token_encrypted = ? WHERE meta_id = '111'", [encryptToken("token-pagina-a")]);
  const asked: string[] = [];
  const fake = async (id: string, token: string) => (asked.push(`${id} ${token}`), "💙");
  assert.equal((await processMetaEvent(db, await event(fbComment("111", "post1_c9", { id: "u7", name: "Lu" }, "")), fake)).created, 1);
  assert.deepEqual(asked, ["post1_c9 token-pagina-a"]);
  assert.equal((await rows("SELECT text_masked FROM interactions WHERE meta_id = 'post1_c9'"))[0].text_masked, "💙");
  // Con texto en el webhook no se llama a la API.
  await processMetaEvent(db, await event(fbComment("111", "post1_c10", { id: "u7", name: "Lu" }, "hola")), fake);
  assert.equal(asked.length, 1);
});

test("el parser ignora lo que no es comentario ni DM", () => {
  assert.deepEqual(parseMetaEvent({ object: "page", entry: [{ id: "1", changes: [{ field: "feed", value: { item: "reaction", verb: "add" } }] }] }), []);
  assert.deepEqual(parseMetaEvent({ object: "whatsapp_business_account", entry: [] }), []);
  assert.deepEqual(parseMetaEvent(null), []);
});

test("los adjuntos de un DM se nombran en español y la foto de ver una vez se avisa", () => {
  const dm = (attachments: any[], text?: string) => parseMetaEvent({ object: "instagram", entry: [{ id: "222", messaging: [{ sender: { id: "u" }, recipient: { id: "222" }, timestamp: 1, message: { mid: "x", text, attachments } }] }] })[0];
  assert.equal(dm([{ type: "image" }, { type: "video" }]).text, "[adjunto: foto, video]");
  assert.equal(dm([{ type: "image" }], "Esta es la fórmula").text, "Esta es la fórmula [adjunto: foto]");
  assert.match(dm([{ type: "ephemeral" }]).text, /ver una vez/);
});
