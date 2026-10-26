// Perfiles de quien escribe: niveles por seguidores configurables, personas importantes, lectura del
// perfil en cada canal (una vez cada 7 días) y paso a una persona sin respuesta automática.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { DEFAULT_INFLUENCE, addWatch, getInfluence, influencerOf, listImportant, setInfluence, tierFor } from "../src/lib/influence.ts";
import { processMetaEvent } from "../src/lib/meta-events.ts";
import { classifyInteraction, decide, type Classification } from "../src/lib/classify.ts";
import { createClient, disconnectAccount, saveConnectedAccount } from "../src/lib/data.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const event = (payload: unknown) => insert("INSERT INTO webhook_events (dedupe_key, payload) VALUES (UUID(), ?)", [JSON.stringify(payload)]);
const quiet = { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false };
const thanks: Classification = { tipo_caso: "positivo_emoji", confianza: 0.97, cubierto: true, es_queja_o_pregunta: false, sentimiento: "positivo", plantilla_publica: null, plantilla_privada: null, senales: quiet, respuesta_publica: "¡Gracias {usuario}! 💙", respuesta_privada: "¡Gracias! 💙", motivo_escalamiento: null };
const noText = async () => "";
const noName = async () => null;
const organic = async () => ({ type: "foto", origin: "organica" as const, permalink: null, caption: null, publishedAt: null });
const calls: string[] = [];
const fakeProfiles = {
  igDm: async () => (calls.push("igDm"), { username: "vale.fit", followers: 45_000, verified: false }),
  igBusiness: async (_own: string, username: string) => (calls.push(`igBusiness:${username}`), username === "personal.ana" ? { accountType: "personal" as const } : { followers: 250_000, bio: "Creadora de contenido de salud", accountType: "empresa_creador" as const }),
  fbAuthor: async () => (calls.push("fbAuthor"), { followers: 12_000, accountType: "pagina" as const }),
};

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  await seedConfig(db as any, client);
  await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted, user_token_encrypted) VALUES (?, 'ig', 'I1', 'P1', '@marca', ?, ?)", [client, encryptToken("t"), encryptToken("u")]);
  await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'fb', 'P1', 'P1', 'Marca', ?)", [client, encryptToken("t")]);
});
after(() => db.end());

test("los niveles salen de los cortes del cliente y no se guardan cortes que no suban", async () => {
  assert.deepEqual(await getInfluence(db, client), DEFAULT_INFLUENCE);
  assert.deepEqual([tierFor(999, DEFAULT_INFLUENCE), tierFor(1_000, DEFAULT_INFLUENCE), tierFor(45_000, DEFAULT_INFLUENCE), tierFor(100_000, DEFAULT_INFLUENCE), tierFor(2e6, DEFAULT_INFLUENCE), tierFor(null, DEFAULT_INFLUENCE)], ["comun", "nano", "micro", "macro", "mega", null]);
  assert.match((await setInfluence(db, client, { ...DEFAULT_INFLUENCE, micro: 500 }))!, /nano < micro/);
  assert.equal(await setInfluence(db, client, { nano: 1_000, micro: 10_000, macro: 50_000, mega: 1_000_000, escalateFrom: "micro" }), null);
  assert.equal((await getInfluence(db, client)).macro, 50_000);
  const copy = await createClient(db, "Copia", client);
  assert.equal((await getInfluence(db, copy)).macro, 50_000, "se copia con la configuración");
});

test("pasa a una persona: persona importante, influenciador desde el nivel elegido o cuenta verificada", async () => {
  const watch = [{ value: "periodista.x", note: "Periodista de Noticias Caracol" }];
  assert.equal(influencerOf({ followers: 300, username: "ana", platform: "ig" }, DEFAULT_INFLUENCE, watch), null, "persona del común");
  assert.equal(influencerOf({ followers: 5_000, username: "ana", platform: "ig" }, DEFAULT_INFLUENCE, watch), null, "nano no llega a micro");
  assert.deepEqual(influencerOf({ followers: 45_000, username: "vale", platform: "ig" }, DEFAULT_INFLUENCE, watch), { reason: "Microinfluenciador: 45.000 seguidores en Instagram", priority: "alta" });
  assert.equal(influencerOf({ followers: 250_000, username: "x", platform: "ig" }, DEFAULT_INFLUENCE, watch)?.priority, "critica");
  assert.match(influencerOf({ username: "@Periodista.X", platform: "ig" }, DEFAULT_INFLUENCE, watch)!.reason, /^Persona importante \(Periodista de Noticias Caracol\)/);
  assert.equal(influencerOf({ verified: true, platform: "ig" }, DEFAULT_INFLUENCE, watch)?.reason, "Cuenta verificada");
  const d = decide({ code: "positivo_emoji", autonomy: "automatica", threshold: 0.85 } as any, thanks, "comentario", { reason: "Microinfluenciador", priority: "alta" });
  assert.deepEqual([d.decision, d.proposed, d.escalation?.priority, d.escalation?.draft], ["escalar", null, "alta", "¡Gracias {usuario}! 💙"], "sin contención; el borrador queda para la persona");
});

test("el perfil se lee en cada canal y se renueva cada 7 días", async () => {
  const dm = (mid: string) => ({ object: "instagram", entry: [{ id: "I1", time: 1761062500000, messaging: [{ sender: { id: "igu1" }, recipient: { id: "I1" }, timestamp: 1761062500000, message: { mid, text: "Hola" } }] }] });
  await processMetaEvent(db, await event(dm("m1")), noText, noName, organic, fakeProfiles);
  await processMetaEvent(db, await event(dm("m2")), noText, noName, organic, fakeProfiles);
  assert.equal(calls.filter((c) => c === "igDm").length, 1, "no se vuelve a consultar en 7 días");
  assert.deepEqual(Object.values((await rows("SELECT followers, verified FROM contacts WHERE meta_user_id = 'igu1'"))[0]), [45_000, 0]);

  const igComment = (id: string, username: string) => ({ object: "instagram", entry: [{ id: "I1", time: 1761062400, changes: [{ field: "comments", value: { id, text: "💙", from: { id: `id_${username}`, username }, media: { id: "m1", media_product_type: "FEED" } } }] }] });
  await processMetaEvent(db, await event(igComment("c1", "creadora.salud")), noText, noName, organic, fakeProfiles);
  await processMetaEvent(db, await event(igComment("c2", "personal.ana")), noText, noName, organic, fakeProfiles);
  const ig = await rows("SELECT username, followers, account_type, bio FROM contacts WHERE username IN ('creadora.salud', 'personal.ana') ORDER BY username");
  assert.deepEqual(ig.map((r) => [r.username, r.followers, r.account_type]), [["creadora.salud", 250_000, "empresa_creador"], ["personal.ana", null, "personal"]]);

  const fb = { object: "page", entry: [{ id: "P1", time: 1761062400, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "f1", post_id: "P1_p", parent_id: "P1_p", from: { id: "pg9", name: "Fundación Salud" }, message: "Hola", created_time: 1761062400 } }] }] };
  await processMetaEvent(db, await event(fb), noText, noName, organic, fakeProfiles);
  assert.deepEqual(Object.values((await rows("SELECT followers, account_type FROM contacts WHERE meta_user_id = 'pg9'"))[0]), [12_000, "pagina"]);
});

test("un influenciador y una persona importante van a la Bandeja sin respuesta automática", async () => {
  const [i] = await rows("SELECT i.id FROM interactions i JOIN contacts c ON c.id = i.contact_id WHERE c.username = 'creadora.salud'");
  const r = await classifyInteraction(db, i.id, async () => thanks);
  assert.equal(r?.decision, "escalar");
  const [e] = await rows("SELECT reason, priority FROM escalations WHERE interaction_id = ?", [i.id]);
  assert.deepEqual([e.reason, e.priority], ["Macroinfluenciador: 250.000 seguidores en Instagram", "critica"]);

  await addWatch(db, client, "@Personal.Ana", "Directora de comunicaciones");
  const [j] = await rows("SELECT i.id FROM interactions i JOIN contacts c ON c.id = i.contact_id WHERE c.username = 'personal.ana'");
  await classifyInteraction(db, j.id, async () => thanks);
  assert.match((await rows("SELECT reason FROM escalations WHERE interaction_id = ?", [j.id]))[0].reason, /^Persona importante \(Directora de comunicaciones\)/);
  const [p] = await listImportant(db, client);
  assert.deepEqual([p.value, Number(p.messages)], ["personal.ana", 1]);
});

test("volver a conectar guarda el token de usuario sin cambiar el modo; desconectar es solo del cliente", async () => {
  await db.query("UPDATE accounts SET mode = 'en_vivo', user_token_encrypted = NULL WHERE meta_id = 'P1'");
  assert.equal(await saveConnectedAccount(db, client, { platform: "fb", metaId: "P1", pageId: "P1", name: "Marca", tokenEncrypted: encryptToken("t2"), userTokenEncrypted: encryptToken("u2") }), "ok");
  const [a] = await rows("SELECT id, mode, status, user_token_encrypted IS NOT NULL AS has FROM accounts WHERE meta_id = 'P1'");
  assert.deepEqual([a.mode, a.status, Number(a.has)], ["en_vivo", "conectada", 1]);
  const other = await createClient(db, "Otro", null);
  await disconnectAccount(db, other, a.id);
  assert.equal((await rows("SELECT status FROM accounts WHERE id = ?", [a.id]))[0].status, "conectada", "otro cliente no la desconecta");
  await disconnectAccount(db, client, a.id);
  assert.equal((await rows("SELECT status FROM accounts WHERE id = ?", [a.id]))[0].status, "desconectada");
});
