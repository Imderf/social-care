// Historial al conectar, con una Graph API falsa: qué entra, qué queda respondido por el equipo, qué
// es solo para análisis, los DM en orden y los datos de cada publicación.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { backfillAccount } from "../src/lib/backfill.ts";
import { postType } from "../src/lib/meta.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let page = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('A')", []);
  page = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'fb', 'P1', 'P1', 'Página', ?)", [client, encryptToken("tok")]);
});
after(() => db.end());

const FEED = [
  {
    id: "P1_a", created_time: daysAgo(10), status_type: "added_video", permalink_url: "https://www.facebook.com/reel/123/", message: "Nuestro reel",
    comments: { data: [
      // Respondido por la página hace 10 días: sirve para aprender y medir.
      { id: "c1", message: "¿Tienen domicilios?", created_time: daysAgo(10), from: { id: "u1", name: "Ana" },
        comments: { data: [{ id: "c1r", message: "¡Hola Ana! Sí, para usuarios priorizados.", created_time: daysAgo(9.9), from: { id: "P1", name: "Página" } }] } },
      // Sin responder y de hace 10 días: solo análisis.
      { id: "c2", message: "Pésimo servicio", created_time: daysAgo(10), from: { id: "u2", name: "Beto" } },
      // Sin responder y de hace 2 días: va a Pruebas.
      { id: "c3", message: "¿Abren el domingo?", created_time: daysAgo(2), from: { id: "u3", name: "Caro" } },
    ] },
  },
];
const CONVERSATIONS = [
  { updated_time: daysAgo(0.1), messages: { data: [
    // La API los da del más nuevo al más viejo.
    { id: "m3", message: "Gracias", created_time: daysAgo(0.1), from: { id: "u4", name: "Dani" } },
    { id: "m2", message: "Hola Dani, ¿en qué ciudad?", created_time: daysAgo(0.15), from: { id: "P1" }, to: { data: [{ id: "u4" }] } },
    { id: "m1", message: "No me entregaron la fórmula", created_time: daysAgo(0.2), from: { id: "u4", name: "Dani" } },
  ] } },
];
const fakeApi = { graphPages: async (path: string) => (path.endsWith("/feed") ? FEED : path.endsWith("/conversations") ? CONVERSATIONS : []) as any };

test("trae los últimos días: lo respondido queda del equipo, lo viejo solo para análisis, lo reciente para Pruebas", async () => {
  const r = await backfillAccount(db, page, 30, fakeApi as any);
  assert.deepEqual(r, { created: 5, duplicates: 0, replies: 2 });

  const get = async (id: string) => (await rows("SELECT source, analysis_only, answered_by, human_reply, kind FROM interactions WHERE meta_id = ?", [id]))[0];
  const c1 = await get("c1");
  assert.deepEqual([c1.source, Number(c1.analysis_only), c1.answered_by, c1.human_reply], ["historial", 1, "persona", "¡Hola Ana! Sí, para usuarios priorizados."]);
  assert.equal(Number((await get("c2")).analysis_only), 1);
  const c3 = await get("c3");
  assert.deepEqual([Number(c3.analysis_only), c3.answered_by], [0, null], "reciente y sin responder: se puede responder");

  // DM en orden: la respuesta de la página queda con m1, y m3 sigue sin responder.
  assert.equal((await get("m1")).human_reply, "Hola Dani, ¿en qué ciudad?");
  assert.equal((await get("m3")).answered_by, null);

  const [post] = await rows("SELECT type, permalink, caption FROM posts WHERE meta_id = 'P1_a'");
  assert.deepEqual([post.type, post.permalink, post.caption], ["reel", "https://www.facebook.com/reel/123/", "Nuestro reel"]);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM jobs WHERE type = 'classify'"))[0].n, 5, "todo se clasifica, también para el Resumen");

  // Traerlo otra vez no duplica nada.
  assert.equal((await backfillAccount(db, page, 30, fakeApi as any))?.duplicates, 5);
});

test("tipo de pieza en palabras del equipo", () => {
  assert.equal(postType("fb", { status_type: "added_photos" }), "foto");
  assert.equal(postType("ig", { media_product_type: "REELS", media_type: "VIDEO" }), "reel");
  assert.equal(postType("ig", { media_product_type: "FEED", media_type: "CAROUSEL_ALBUM" }), "carrusel");
});
