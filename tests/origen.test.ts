// Solo se responde lo orgánico: el comentario en un anuncio que no salió en la página, o en una
// publicación orgánica mientras está pautada, queda para análisis.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { postOrigin } from "../src/lib/meta.ts";
import { parseMetaEvent, processMetaEvent } from "../src/lib/meta-events.ts";
import { upsertPost } from "../src/lib/posts.ts";
import { classifyInteraction, type Classification } from "../src/lib/classify.ts";
import { sendFromInbox } from "../src/lib/inbox.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let fb = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const event = (payload: unknown) => insert("INSERT INTO webhook_events (dedupe_key, payload) VALUES (UUID(), ?)", [JSON.stringify(payload)]);
const fbComment = (id: string, post: string, extra: object = {}) => ({
  object: "page",
  entry: [{ id: "P1", time: 1761062400, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: id, post_id: post, parent_id: post, from: { id: "u1", name: "Ana" }, message: "No me han entregado", created_time: 1761062400, ...extra } }] }],
});
const igComment = (id: string, media: object) => ({ object: "instagram", entry: [{ id: "I1", time: 1761062400, changes: [{ field: "comments", value: { id, text: "¿Precio?", from: { id: "u2", username: "maria" }, media } }] }] });
const noText = async () => "";
const noName = async () => null;
const analysis = async (metaId: string) => Number((await rows("SELECT analysis_only FROM interactions WHERE meta_id = ?", [metaId]))[0].analysis_only);
const origin = async (metaId: string) => (await rows("SELECT origin FROM posts WHERE meta_id = ?", [metaId]))[0]?.origin;

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  await seedConfig(db as any, client);
  fb = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'fb', 'P1', 'P1', 'Página', ?)", [client, encryptToken("t")]);
  await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'ig', 'I1', 'P1', '@a', ?)", [client, encryptToken("t")]);
});
after(() => db.end());

test("el origen sale de lo que manda Meta", () => {
  assert.equal(postOrigin("fb", { is_published: false }), "anuncio", "anuncio que no salió en la página");
  assert.equal(postOrigin("fb", { is_published: true, is_inline_created: true }), "anuncio");
  assert.equal(postOrigin("fb", { is_published: true, promotion_status: "active" }), "pautada");
  assert.equal(postOrigin("fb", { is_published: true, promotion_status: "inactive" }), "organica");
  assert.equal(postOrigin("fb", {}), null, "sin datos no se adivina");
  assert.equal(postOrigin("ig", { ad_id: "9" }), "anuncio");
  assert.equal(postOrigin("ig", { media_product_type: "AD" }), "anuncio");
  assert.equal(postOrigin("ig", { media_product_type: "FEED" }), "organica");
  const [item] = parseMetaEvent(igComment("c", { id: "ad_media", ad_id: "9", original_media_id: "m1" })) as any[];
  assert.deepEqual([item.post.origin, item.promotedPostId], ["anuncio", "m1"]);
});

test("Facebook: comentario en un anuncio que no salió en la página queda solo para análisis; Meta se consulta una vez", async () => {
  let asked = 0;
  const darkPost = async () => (asked++, { type: "foto", origin: "anuncio" as const, permalink: null, caption: "Promo", publishedAt: null });
  await processMetaEvent(db, await event(fbComment("d1", "P1_ad")), noText, noName, darkPost);
  await processMetaEvent(db, await event(fbComment("d2", "P1_ad")), noText, noName, darkPost);
  assert.equal(asked, 1, "una vez por publicación");
  assert.deepEqual([await analysis("d1"), await analysis("d2"), await origin("P1_ad")], [1, 1, "anuncio"]);
});

test("Facebook: mientras la publicación está pautada no se responde; cuando Meta dice que terminó, vuelve", async () => {
  const organic = async () => ({ type: "foto", origin: "organica" as const, permalink: null, caption: null, publishedAt: null });
  const post = (promotion_status?: string) => ({ post: { id: "P1_boost", is_published: true, ...(promotion_status && { promotion_status }) } });
  await processMetaEvent(db, await event(fbComment("o1", "P1_boost", post())), noText, noName, organic);
  await processMetaEvent(db, await event(fbComment("b1", "P1_boost", post("active"))), noText, noName, organic);
  await processMetaEvent(db, await event(fbComment("b2", "P1_boost", post())), noText, noName, organic);
  assert.deepEqual([await analysis("o1"), await analysis("b1"), await analysis("b2")], [0, 1, 1], "sin dato de la pauta sigue pautada");
  await upsertPost(db, { id: fb, client_id: client }, "P1_boost", { type: null, origin: "organica", permalink: null }, false);
  assert.equal(await origin("P1_boost"), "pautada", "una lectura sin la pauta no le quita la marca");
  await processMetaEvent(db, await event(fbComment("b3", "P1_boost", post("inactive"))), noText, noName, organic);
  assert.deepEqual([await origin("P1_boost"), await analysis("b3")], ["organica", 0]);
});

test("Instagram: el comentario sobre el anuncio no se responde y la publicación de origen queda pautada", async () => {
  await processMetaEvent(db, await event(igComment("igad1", { id: "ad_media", ad_id: "9", original_media_id: "m1" })), noText, noName);
  await processMetaEvent(db, await event(igComment("igorg1", { id: "m1", media_product_type: "FEED" })), noText, noName);
  assert.deepEqual([await analysis("igad1"), await origin("ad_media"), await origin("m1"), await analysis("igorg1")], [1, "anuncio", "pautada", 1]);
});

test("el comentario en un anuncio o en una publicación pautada llega a la Bandeja como alerta, para responder desde Meta", async () => {
  const quiet = { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false };
  const complaint: Classification = {
    tipo_caso: "pendiente_entrega", confianza: 0.95, cubierto: true, es_queja_o_pregunta: true, sentimiento: "negativo", plantilla_publica: "P6", plantilla_privada: null,
    senales: { ...quiet, salud_critica: true }, respuesta_publica: "¡Hola {usuario}! Lamentamos la situación.", respuesta_privada: null, motivo_escalamiento: null,
  };
  const [i] = await rows("SELECT id FROM interactions WHERE meta_id = 'd1'");
  const r = await classifyInteraction(db, i.id, async () => complaint);
  assert.equal(r?.published, false, "nunca se publica solo");
  const [e] = await rows("SELECT id, reason, priority, suggested_draft FROM escalations WHERE interaction_id = ?", [i.id]);
  assert.match(e.reason, /^Comentario en un anuncio: se atiende desde Meta/);
  assert.equal(e.priority, "alta", "salud en riesgo");
  assert.equal(e.suggested_draft, "¡Hola Ana! Lamentamos la situación.", "el borrador de la IA para copiar");
  assert.match((await sendFromInbox(db, client, e.id, { text: "Hola" })).error!, /un anuncio: no se responde desde la plataforma/);
});
