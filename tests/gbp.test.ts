// Google Business Profile: conexión (login con Google y sedes detectadas), lectura de reseñas sin duplicar, y la
// clasificación de reseñas con su propia matriz. Nada llama a Google ni a OpenAI: se usan una API y un clasificador de prueba.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { seedReviewConfig } from "../db/seed-resenas.ts";
import { classifyInteraction, loadMatrix, type Classification } from "../src/lib/classify.ts";
import { createClient } from "../src/lib/data.ts";
import { GBP_SCOPES, type GbpApi, type GbpReview, cleanReviewText, connectLocations, disconnectGbp, dueGbpSyncs, gbpErrorText, gbpLoginUrl, GbpError, missingGbpConfig, saveGbpConnection, syncGbp } from "../src/lib/gbp.ts";
import { cannotSend } from "../src/lib/inbox.ts";
import { setAccountMode } from "../src/lib/learning.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let cafam = 0;
let otro = 0;
const LOC = "accounts/111/locations/222";
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const dias = (n: number) => new Date(Date.now() - n * 864e5);

const resena = (id: string, o: Partial<GbpReview> = {}): GbpReview => ({ reviewId: id, reviewer: "Ana Pérez", rating: 5, comment: "Excelente atención", createdAt: dias(1), reply: null, ...o });
const apiCon = (paginas: GbpReview[][], llamadas: string[] = []): GbpApi => ({
  listLocations: async () => [],
  listReviews: async (_t, loc, page = "") => {
    if (loc !== LOC) return { reviews: [], next: "" };      // la otra sede no tiene reseñas
    llamadas.push(page);
    const k = page ? Number(page) : 0;
    return { reviews: paginas[k] ?? [], next: k + 1 < paginas.length ? String(k + 1) : "" };
  },
});

const clasif = (o: Partial<Classification> = {}) => async (): Promise<Classification> => ({
  tipo_caso: "resena_positiva", confianza: 0.95, cubierto: true, es_queja_o_pregunta: false, sentimiento: "positivo", plantilla_publica: "R1", plantilla_privada: null,
  senales: { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false },
  respuesta_publica: "¡Hola {nombre}! Gracias por tomarte el tiempo de contarnos tu experiencia. 💙 Nos alegra mucho que hayas tenido una buena atención. ¡Te esperamos pronto!",
  respuesta_privada: null, motivo_escalamiento: null, ...o,
});

async function interaccion(clientId: number, accountId: number, meta: string, o: { texto?: string; rating?: number | null; nombre?: string | null } = {}) {
  const [c] = await db.query<any>("INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, 'gbp', ?, ?)", [clientId, `sin_id:${meta}`, o.nombre === undefined ? "Ana Pérez" : o.nombre]);
  const [r] = await db.query<any>("INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked, rating, mode, source) VALUES (?, ?, 'resena', ?, ?, ?, ?, 'prueba', 'webhook')",
    [clientId, accountId, meta, c.insertId, o.texto ?? "Excelente atención", o.rating === undefined ? 5 : o.rating]);
  return Number(r.insertId);
}

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  process.env.SESSION_SECRET ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  cafam = await createClient(db, "Droguerías Cafam", null);
  otro = await createClient(db, "Otro cliente", null);
  await seedReviewConfig(db as any, cafam);
  await saveGbpConnection(db, cafam, "admin@cafam.test", "refresh-token-de-prueba");
});
after(() => db.end());

test("el login con Google pide solo lo de Business Profile y vuelve a este panel", () => {
  process.env.GOOGLE_CLIENT_ID = "cliente-123";
  process.env.GOOGLE_CLIENT_SECRET = "secreto";
  process.env.PANEL_URL = "https://panel.example.com/";
  const u = new URL(gbpLoginUrl("estado-firmado"));
  assert.equal(u.host, "accounts.google.com");
  assert.equal(u.searchParams.get("scope"), GBP_SCOPES.join(" "));
  assert.ok(GBP_SCOPES.includes("https://www.googleapis.com/auth/business.manage"));
  assert.equal(u.searchParams.get("redirect_uri"), "https://panel.example.com/api/gbp/callback");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("state"), "estado-firmado");
  assert.deepEqual(missingGbpConfig(), []);
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.deepEqual(missingGbpConfig(), ["GOOGLE_CLIENT_SECRET"]);
  process.env.GOOGLE_CLIENT_SECRET = "secreto";
});

test("conectar sedes: cada una es una cuenta en modo prueba, sin duplicar ni tocar las de otro cliente", async () => {
  const r = await connectLocations(db, cafam, [{ accountLocation: LOC, title: "Droguería Cafam Calle 80" }, { accountLocation: "accounts/111/locations/333", title: "Droguería Cafam Suba" }]);
  assert.deepEqual(r, { created: 2, taken: 0 });
  const cuentas = await rows("SELECT platform, mode, status, token_encrypted FROM accounts WHERE client_id = ? ORDER BY meta_id", [cafam]);
  assert.deepEqual(cuentas.map((c) => [c.platform, c.mode, c.status, c.token_encrypted]), [["gbp", "prueba", "conectada", null], ["gbp", "prueba", "conectada", null]]);
  assert.deepEqual(await connectLocations(db, cafam, [{ accountLocation: LOC, title: "Droguería Cafam Calle 80 (nueva)" }]), { created: 0, taken: 0 }, "repetir no duplica");
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM jobs WHERE type = 'gbp_sync'"))[0].n), 1, "una sola lectura pedida");
  assert.deepEqual(await connectLocations(db, otro, [{ accountLocation: LOC, title: "Ajena" }]), { created: 0, taken: 1 }, "la sede de otro cliente no se toca");
  assert.equal((await rows("SELECT client_id FROM accounts WHERE meta_id = ?", [LOC]))[0].client_id, cafam);
  assert.ok((await dueGbpSyncs(db)).includes(cafam), "toca leer");
});

test("la primera lectura trae los últimos 30 días, lo respondido entra como respondido y no se enmascara de menos", async () => {
  const cuenta = Number((await rows("SELECT id FROM accounts WHERE meta_id = ?", [LOC]))[0].id);
  const api = apiCon([[
    resena("r1", { comment: "Excelente atención. Mi correo es ana@mail.com", createdAt: dias(2) }),
    resena("r2", { rating: null as any, comment: "", reviewer: null, createdAt: dias(3) }),
    resena("r3", { rating: 4, comment: "Gracias", reply: { comment: "Gracias a ti", at: dias(1) }, createdAt: dias(4) }),
    resena("r4", { createdAt: dias(45) }),
  ]]);
  const r = (await syncGbp(db, cafam, api))!;
  assert.deepEqual([r.created, r.replied, r.locations, r.error], [3, 1, 2, null]);
  const fila = (m: string) => rows("SELECT i.kind, i.rating, i.text_masked, i.answered_by, i.human_reply, i.source, c.username, c.platform FROM interactions i JOIN contacts c ON c.id = i.contact_id WHERE i.account_id = ? AND i.meta_id = ?", [cuenta, m]).then((x) => x[0]);
  const r1 = await fila("r1");
  assert.equal(r1.kind, "resena");
  assert.equal(r1.rating, 5);
  assert.ok(!r1.text_masked.includes("ana@mail.com") && r1.text_masked.includes("[correo]"), "el correo queda enmascarado");
  assert.deepEqual([r1.username, r1.platform, r1.source, r1.answered_by], ["Ana Pérez", "gbp", "historial", null]);
  assert.equal((await fila("r2")).username, null, "una reseña anónima no trae nombre");
  const r3 = await fila("r3");
  assert.deepEqual([r3.answered_by, r3.human_reply], ["persona", "Gracias a ti"]);
  assert.equal(await fila("r4"), undefined, "la de hace 45 días no entra en la primera lectura");
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM jobs WHERE type = 'classify'"))[0].n), 3);
  const g = (await rows("SELECT last_sync_summary, last_sync_at FROM gbp_connections WHERE client_id = ?", [cafam]))[0];
  assert.match(g.last_sync_summary, /3 reseña/);
  assert.ok(g.last_sync_at);
});

test("leer otra vez no duplica nada y solo entran las reseñas nuevas, aunque lleguen en varias páginas", async () => {
  const llamadas: string[] = [];
  const api = apiCon([[resena("n1", { createdAt: dias(0) }), resena("n2", { createdAt: dias(0) })], [resena("r1"), resena("r2")]], llamadas);
  const r = (await syncGbp(db, cafam, api))!;
  assert.equal(r.created, 2, "solo las dos nuevas");
  assert.deepEqual(llamadas.slice(0, 2), ["", "1"], "pidió la segunda página porque en la primera todas eran nuevas");
  const otra = (await syncGbp(db, cafam, api))!;
  assert.equal(otra.created, 0, "la segunda vez todo ya estaba");
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM interactions WHERE kind = 'resena' AND meta_id = 'n1'"))[0].n), 1);
});

test("si Google quita el permiso, las sedes pasan a error con un motivo claro, y al reconectar vuelven", async () => {
  const sinPermiso: GbpApi = { listLocations: async () => [], listReviews: async () => { throw new GbpError("The caller does not have permission", 403); } };
  const r = (await syncGbp(db, cafam, sinPermiso))!;
  assert.match(r.error!, /no aprobó el acceso/);
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM accounts WHERE client_id = ? AND status = 'error'", [cafam]))[0].n), 1, "se corta en la primera sede con error");
  assert.match((await rows("SELECT last_sync_summary FROM gbp_connections WHERE client_id = ?", [cafam]))[0].last_sync_summary, /no aprobó el acceso/);
  assert.match(gbpErrorText(new GbpError("x", 401)), /Vuelve a conectar/);
  assert.match(gbpErrorText(new GbpError("x", 429)), /limitó las consultas/);
  assert.match(gbpErrorText(new Error("red")), /no respondió bien/);
  await saveGbpConnection(db, cafam, "admin@cafam.test", "otro-token");
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM accounts WHERE client_id = ? AND status = 'error'", [cafam]))[0].n), 0);
  assert.equal(await syncGbp(db, otro, apiCon([])), null, "un cliente sin conexión no lee nada");
});

test("el texto de una reseña traducida por Google se deja en su idioma original", () => {
  assert.equal(cleanReviewText("(Translated by Google) Great service\n\n(Original)\nExcelente servicio"), "Excelente servicio");
  assert.equal(cleanReviewText("  Muy buena atención  "), "Muy buena atención");
});

test("la matriz de reseñas y la de redes no se mezclan, ni al copiar un cliente", async () => {
  const redes = await loadMatrix(db, cafam);
  assert.equal(redes.types.length, 0, "los tipos de reseñas no entran a clasificar comentarios de Facebook o Instagram");
  assert.equal(redes.templates.length, 0);
  const res = await loadMatrix(db, cafam, "resenas");
  assert.deepEqual(res.types.map((t) => t.code), ["resena_positiva", "resena_sin_texto", "resena_neutra", "resena_queja", "resena_critica", "resena_no_encaja"]);
  assert.equal(res.templates.length, 7);
  const copia = await createClient(db, "Copia", cafam);
  assert.equal((await loadMatrix(db, copia, "resenas")).types.length, 6, "la copia conserva las reseñas como reseñas");
  assert.equal((await loadMatrix(db, copia)).types.length, 0);
  await seedReviewConfig(db as any, cafam);
  assert.equal((await loadMatrix(db, cafam, "resenas")).types.length, 6, "correr la carga otra vez no duplica");
});

test("una reseña positiva con texto se responde con la plantilla y el nombre de pila, sin publicar", async () => {
  const cuenta = Number((await rows("SELECT id FROM accounts WHERE meta_id = ?", [LOC]))[0].id);
  const id = await interaccion(cafam, cuenta, "c-pos");
  const d = (await classifyInteraction(db, id, clasif()))!;
  assert.equal(d.decision, "responder");
  assert.equal(d.published, false);
  const [i] = await rows("SELECT decision, proposed_reply, proposed_template, sentiment, case_type_id FROM interactions WHERE id = ?", [id]);
  assert.equal(i.decision, "responder");
  assert.ok(i.proposed_reply.startsWith("¡Hola Ana!") && !i.proposed_reply.includes("{nombre}"));
  assert.equal(i.proposed_template, "R1");
  assert.ok(i.case_type_id);
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM actions WHERE interaction_id = ?", [id]))[0].n), 0, "nunca crea una publicación");
  assert.equal(await classifyInteraction(db, id, clasif()), null, "ya clasificada: no se repite");
});

test("1 o 2 estrellas, riesgo, tipos de una persona, poca confianza o datos inventados: la atiende una persona", async () => {
  const cuenta = Number((await rows("SELECT id FROM accounts WHERE meta_id = ?", [LOC]))[0].id);
  const caso = async (meta: string, o: Parameters<typeof interaccion>[3], c: Partial<Classification>) => {
    const id = await interaccion(cafam, cuenta, meta, o);
    const d = (await classifyInteraction(db, id, clasif(c)))!;
    const [e] = await rows("SELECT reason, priority FROM escalations WHERE interaction_id = ?", [id]);
    return { d, e };
  };
  const senal = (k: string) => ({ senales: { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false, [k]: true } });

  const una = await caso("e-1", { rating: 1, texto: "Pésimo servicio" }, { tipo_caso: "resena_queja", plantilla_publica: "R7", respuesta_publica: "¡Hola {nombre}! Lamentamos que tu experiencia no haya sido la mejor. 💙 Tu opinión es importante y la compartimos con el equipo de la sede para revisar lo que pasó. Gracias por contárnoslo." });
  assert.equal(una.d.decision, "escalar");
  assert.equal(una.e.priority, "alta");
  assert.match(una.e.reason, /1 estrella/);
  const dos = await caso("e-2", { rating: 2, texto: "Muy buen servicio" }, {});
  assert.match(dos.e.reason, /2 estrellas/, "con 2 estrellas siempre va a una persona, aunque la IA lo vea positivo");
  const salud = await caso("e-3", { rating: 5, texto: "Gracias" }, senal("salud_critica"));
  assert.match(salud.e.reason, /riesgo: salud/);
  assert.equal(salud.e.priority, "alta");
  assert.equal((await caso("e-4", { rating: 5, texto: "Gracias" }, senal("crisis"))).e.priority, "critica");
  assert.match((await caso("e-5", { rating: 5, texto: "Gracias" }, senal("accion_legal"))).e.reason, /acción legal/);
  const humana = await caso("e-6", { rating: 4, texto: "Tardaron" }, { tipo_caso: "resena_neutra", plantilla_publica: "R6", respuesta_publica: "¡Hola {nombre}! Gracias por compartirnos tu opinión. 💙 Tomamos nota de lo que nos cuentas para seguir mejorando nuestro servicio." });
  assert.match(humana.e.reason, /siempre atiende una persona/);
  assert.match((await caso("e-7", { rating: 5, texto: "Gracias" }, { confianza: 0.4 })).e.reason, /Baja confianza/);
  assert.match((await caso("e-8", { rating: 5, texto: "Gracias" }, { respuesta_publica: "¡Hola {nombre}! Escríbenos al 3001234567 o en https://estafa.co 💙" })).e.reason, /no sale completa de una plantilla/);
  assert.match((await caso("e-9", { rating: 5, texto: "Gracias" }, { respuesta_publica: "¡Hola {nombre}! Tu ciudad es {ciudad}. 💙" })).e.reason, /no sale completa/);
  assert.match((await caso("e-10", { rating: 5, texto: "Gracias" }, { tipo_caso: "resena_critica", plantilla_publica: null })).e.reason, /Tipo de caso que se escala/);
  for (const k of ["e-1", "e-2", "e-3", "e-4", "e-5", "e-6", "e-7", "e-8", "e-9", "e-10"]) {
    assert.equal((await rows("SELECT decision FROM interactions WHERE meta_id = ?", [k]))[0].decision, "escalar", `${k} nunca se oculta ni se responde sola`);
  }
});

test("una reseña solo con estrellas no llama a la IA: 4 o 5 se agradece rotando plantillas y 3 o menos la ve una persona", async () => {
  const cuenta = Number((await rows("SELECT id FROM accounts WHERE meta_id = ?", [LOC]))[0].id);
  const noLlamar = async () => assert.fail("no debe llamar a la IA") as never;
  const usadas = new Set<string>();
  for (let k = 0; k < 6; k++) {
    const id = await interaccion(cafam, cuenta, `s-${k}`, { texto: "", rating: k % 2 ? 4 : 5 });
    const d = (await classifyInteraction(db, id, noLlamar))!;
    assert.equal(d.decision, "responder");
    const [i] = await rows("SELECT proposed_template, proposed_reply FROM interactions WHERE id = ?", [id]);
    assert.match(i.proposed_template, /^R[345]$/);
    assert.ok(i.proposed_reply.startsWith("¡Hola Ana!"));
    usadas.add(i.proposed_template);
  }
  assert.ok(usadas.size >= 2, "las plantillas rotan");
  for (const [k, stars] of [[0, 3], [1, 2], [2, 1], [3, null]] as const) {
    const id = await interaccion(cafam, cuenta, `st-${k}`, { texto: "", rating: stars });
    const d = (await classifyInteraction(db, id, noLlamar))!;
    assert.equal(d.decision, "escalar");
    assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM escalations WHERE interaction_id = ?", [id]))[0].n), 1);
  }
  // sin nombre (reseña anónima), el saludo no deja un hueco
  const anon = await interaccion(cafam, cuenta, "s-anon", { texto: "", rating: 5, nombre: null });
  await classifyInteraction(db, anon, noLlamar);
  assert.ok(!(await rows("SELECT proposed_reply FROM interactions WHERE id = ?", [anon]))[0].proposed_reply.includes("{"));
});

test("las palabras prohibidas y un cliente sin matriz de reseñas pasan a una persona", async () => {
  const cuenta = Number((await rows("SELECT id FROM accounts WHERE meta_id = ?", [LOC]))[0].id);
  await db.query("INSERT INTO lists (client_id, kind, value) VALUES (?, 'prohibida', 'gratis')", [cafam]);
  const id = await interaccion(cafam, cuenta, "p-1");
  const d = (await classifyInteraction(db, id, clasif({ respuesta_publica: "¡Hola {nombre}! Gracias, te esperamos con algo gratis 💙" })))!;
  assert.equal(d.decision, "escalar");
  assert.match((await rows("SELECT reason FROM escalations WHERE interaction_id = ?", [id]))[0].reason, /palabras prohibidas/);

  const sin = await createClient(db, "Sin matriz", null);
  await connectLocations(db, sin, [{ accountLocation: "accounts/9/locations/9", title: "Sede" }]);
  const cuentaSin = Number((await rows("SELECT id FROM accounts WHERE client_id = ?", [sin]))[0].id);
  const id2 = await interaccion(sin, cuentaSin, "x-1");
  const d2 = (await classifyInteraction(db, id2, async () => assert.fail("no debe llamar a la IA") as never))!;
  assert.equal(d2.decision, "escalar");
  assert.match((await rows("SELECT reason FROM escalations WHERE interaction_id = ?", [id2]))[0].reason, /todavía no tiene matriz de reseñas/);
});

test("una cuenta de Google no pasa a asistido todavía, y desde la bandeja se dice por qué no se responde", async () => {
  const cuenta = Number((await rows("SELECT id FROM accounts WHERE meta_id = ?", [LOC]))[0].id);
  await setAccountMode(db, cafam, cuenta, "en_vivo");
  assert.equal((await rows("SELECT mode FROM accounts WHERE id = ?", [cuenta]))[0].mode, "prueba");
  const motivo = cannotSend({ mode: "prueba", analysis_only: 0, kind: "resena", window_expires_at: null });
  assert.match(motivo!, /Google Business Profile/);
  // desconectar Google quita el permiso y deja las reseñas
  await disconnectGbp(db, cafam);
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM gbp_connections WHERE client_id = ?", [cafam]))[0].n), 0);
  assert.equal(Number((await rows("SELECT COUNT(*) AS n FROM accounts WHERE client_id = ? AND platform = 'gbp' AND status = 'conectada'", [cafam]))[0].n), 0);
  assert.ok(Number((await rows("SELECT COUNT(*) AS n FROM interactions WHERE kind = 'resena' AND client_id = ?", [cafam]))[0].n) > 5, "las reseñas se quedan");
  assert.ok(!(await dueGbpSyncs(db)).includes(cafam));
});
