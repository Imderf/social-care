// Palabras prohibidas: se encuentran sin importar tildes ni mayúsculas y solo como palabra completa;
// la IA las recibe y tiene un segundo intento; ninguna respuesta con ellas se propone sola, se
// acepta ni se envía; se copian con la configuración de un cliente y no se cruzan entre clientes.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { addForbidden, findForbidden, listForbidden, removeForbidden } from "../src/lib/forbidden.ts";
import { classifyInteraction, type Classification } from "../src/lib/classify.ts";
import { reviewProposal } from "../src/lib/learning.ts";
import { sendFromInbox } from "../src/lib/inbox.ts";
import { createClient } from "../src/lib/data.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let account = 0;
let n = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const interaction = (text: string, extra = "") =>
  insert(`INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked${extra ? ", decision, proposed_reply" : ""}) VALUES (?, ?, 'comentario', ?, ?${extra ? ", 'responder', ?" : ""})`,
    extra ? [client, account, `f${++n}`, text, extra] : [client, account, `f${++n}`, text]);
const quiet = { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false };
const thanks = (reply: string): Classification => ({
  tipo_caso: "positivo_emoji", confianza: 0.97, cubierto: true, es_queja_o_pregunta: false, sentimiento: "positivo", plantilla_publica: null, plantilla_privada: null,
  senales: quiet, respuesta_publica: reply, respuesta_privada: null, motivo_escalamiento: null,
});

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  await seedConfig(db as any, client);
  account = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, mode, token_encrypted) VALUES (?, 'fb', 'P1', 'P1', 'Página', 'en_vivo', ?)", [client, encryptToken("t")]);
  await addForbidden(db, client, "lamentablemente, EPS Sanitas\nculpa", "inconveniente");
});
after(() => db.end());

test("se encuentran sin tildes ni mayúsculas, como palabra o frase completa", () => {
  const words = [{ value: "culpa", note: null }, { value: "lamentablemente", note: null }, { value: "EPS Sanitas", note: null }];
  assert.deepEqual(findForbidden("Disculpa la demora", words), [], "«culpa» no marca «disculpa»");
  assert.deepEqual(findForbidden("No es nuestra CULPA.", words), ["culpa"]);
  assert.deepEqual(findForbidden("Lamentáblemente no hay", words), ["lamentablemente"]);
  assert.deepEqual(findForbidden("Escríbele a la eps  sanitas", words), ["EPS Sanitas"]);
  assert.deepEqual(findForbidden(null, words), []);
});

test("la IA las recibe y, si insiste en usarlas, la respuesta no sale sola", async () => {
  let calls = 0;
  let instructions = "";
  const stubborn = async (req: { instructions: string }) => ((calls++, (instructions = req.instructions)), thanks("¡Gracias {usuario}! Lamentablemente 💙"));
  const id = await interaction("💙");
  const r = await classifyInteraction(db, id, stubborn as any);
  assert.equal(calls, 2, "un segundo intento");
  assert.match(instructions, /## Palabras prohibidas[\s\S]*«lamentablemente» → en su lugar: inconveniente/);
  assert.match(instructions, /## Corrección/);
  assert.equal(r?.decision, "escalar");
  assert.match((await rows("SELECT reason FROM escalations WHERE interaction_id = ?", [id]))[0].reason, /palabras prohibidas \(«lamentablemente»\)/);
});

test("si en el segundo intento la quita, se propone normal", async () => {
  let calls = 0;
  const learns = async () => (calls++ === 0 ? thanks("No es nuestra culpa 💙") : thanks("¡Gracias {usuario}! 💙"));
  const id = await interaction("❤️");
  const r = await classifyInteraction(db, id, learns as any);
  assert.equal(r?.decision, "responder");
  assert.equal((await rows("SELECT proposed_reply FROM interactions WHERE id = ?", [id]))[0].proposed_reply, "¡Gracias! 💙");
});

test("no se acepta ni se envía una respuesta con palabras prohibidas", async () => {
  const id = await interaction("Gracias", "¡Gracias! Lamentablemente…");
  const r = await reviewProposal(db, client, id, {});
  assert.deepEqual([r?.verdict, r?.published], [null, false]);
  assert.match((r as any).error, /una palabra prohibida: «lamentablemente»/);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM verifications WHERE interaction_id = ?", [id]))[0].n, 0, "no le enseña nada a la IA");
  assert.equal((await reviewProposal(db, client, id, { text: "¡Gracias por escribirnos!" }))?.verdict, "corregir");

  const i = await interaction("Pésimo");
  const e = await insert("INSERT INTO escalations (client_id, interaction_id, reason) VALUES (?, ?, 'Queja')", [client, i]);
  assert.match((await sendFromInbox(db, client, e, { text: "Escríbele a tu EPS Sanitas" })).error!, /«EPS Sanitas»/);
  assert.equal((await sendFromInbox(db, client, e, { text: "Te escribimos por DM" })).ok, true);
});

test("se copian con la configuración y no se cruzan entre clientes", async () => {
  const copy = await createClient(db, "Copia", client);
  assert.deepEqual((await listForbidden(db, copy)).map((w) => w.value).sort(), ["EPS Sanitas", "culpa", "lamentablemente"]);
  const other = await createClient(db, "Otro", null);
  assert.deepEqual(await listForbidden(db, other), []);
  const [w] = await listForbidden(db, client);
  assert.equal(await removeForbidden(db, other, w.id!), false, "un cliente no borra las de otro");
  assert.equal((await listForbidden(db, client)).length, 3);
});
