// Preguntas abiertas: las plantillas dicen cuándo se usan, cada tipo de caso dice qué hacer si falta
// saber qué caso es (por defecto: cubrir los casos en comentarios y preguntar por DM), la IA ve la
// conversación previa del DM y el equipo ve qué llegó sin plantilla.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { buildInstructions, classifyInteraction, decide, loadMatrix, type Classification } from "../src/lib/classify.ts";
import { ambiguousOf, flowFromForm } from "../src/lib/flow.ts";
import { addKnowledge, createClient, listUncovered, saveTemplate } from "../src/lib/data.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let account = 0;
let contact = 0;
let n = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const quiet = { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false };
const answer = (over: Partial<Classification>): Classification => ({
  tipo_caso: "domicilios", confianza: 0.95, cubierto: true, es_queja_o_pregunta: true, sentimiento: "neutral", plantilla_publica: null, plantilla_privada: null,
  senales: quiet, respuesta_publica: null, respuesta_privada: null, motivo_escalamiento: null, falta_contexto: false, ...over,
});

before(async () => {
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('Droguería')", []);
  await seedConfig(db as any, client);
  await addKnowledge(db, client, { topic: "cobertura", title: "Cali", content: "Domicilio de compras por la web, entrega el mismo día" });
  await addKnowledge(db, client, { topic: "dispensacion", title: "Palmira", content: "Droguería Cafam Palmira Centro, Calle 30 # 28-50" });
  account = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name) VALUES (?, 'ig', 'I1', 'P1', '@d')", [client]);
  contact = await insert("INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, 'ig', 'u1', 'ana.m')", [client]);
});
after(() => db.end());

test("la IA recibe cuándo usar cada plantilla, la cobertura por ciudad y qué hacer si falta saber el caso", async () => {
  const m = await loadMatrix(db, client);
  const text = buildInstructions("Droguería", m.types, m.templates, m.knowledge, m.learned, m.forbidden);
  assert.match(text, /- P1 \(pública\) — úsala cuando: Pregunta por el domicilio de los medicamentos que le entrega su EPS/);
  assert.match(text, /- P10 \(pública\) — úsala cuando: Quiere comprar/);
  assert.match(text, /Cobertura de domicilios en Cali: Domicilio de compras por la web/);
  assert.match(text, /Puntos de dispensación en Palmira: Droguería Cafam Palmira Centro/);
  assert.match(text, /- P11 \(pública\) — úsala cuando: Pregunta dónde reclamar sus medicamentos y su ciudad está en la base/);
  assert.match(text, /- domicilios: .*Si falta saber qué caso es: en comentarios, responde en una sola respuesta corta que cubra cada caso posible con su plantilla; por DM, haz una sola pregunta corta/);
});

test("por defecto se cubren los casos en comentarios y se pregunta por DM; cada tipo lo puede cambiar", () => {
  assert.deepEqual(ambiguousOf(null), { comentario: "ambas", dm: "preguntar" });
  const form = new FormData();
  form.set("amb_comentario", "persona");
  form.set("amb_dm", "inventar");
  assert.deepEqual(flowFromForm(form).ambiguous, { comentario: "persona", dm: "preguntar" }, "solo valores de la lista");
  const type = { code: "domicilios", autonomy: "automatica", threshold: 0.85, flow: { ambiguous: { comentario: "persona", dm: "preguntar" } } } as any;
  const open = answer({ falta_contexto: true, respuesta_publica: "¡Hola! ¿Es por tu EPS o una compra?" });
  assert.equal(decide(type, open, "comentario").decision, "escalar", "configurado para pasar a una persona");
  assert.match(decide(type, open, "comentario").escalation!.reason, /Pregunta abierta/);
  assert.equal(decide(type, { ...open, respuesta_privada: "¿Es por tu EPS o una compra? ¿En qué ciudad estás?" }, "dm").decision, "responder", "por DM pregunta");
});

test("por DM la IA ve la conversación previa, sin el nombre de la persona", async () => {
  const dm = (text: string, at: string, extra = "") =>
    insert(`INSERT INTO interactions (client_id, account_id, contact_id, kind, meta_id, text_masked, received_at${extra ? ", human_reply, answered_by, decision" : ""}) VALUES (?, ?, ?, 'dm', ?, ?, ?${extra ? ", ?, 'persona', 'responder'" : ""})`,
      extra ? [client, account, contact, `dm${++n}`, text, at, extra] : [client, account, contact, `dm${++n}`, text, at]);
  await dm("¿Tienen domicilios?", "2026-10-26 10:00:00", "¡Hola ana.m! ¿Es por tu EPS o una compra? ¿En qué ciudad estás?");
  const id = await dm("Es una compra, estoy en Cali", "2026-10-26 10:05:00");
  let input: any = null;
  await classifyInteraction(db, id, async (req) => ((input = JSON.parse(req.input)), answer({ respuesta_privada: "En Cali tenemos domicilio de compras por la web 💙" })));
  assert.deepEqual(input.conversacion_previa, [
    { de: "usuario", texto: "¿Tienen domicilios?" },
    { de: "marca", texto: "¡Hola {usuario}! ¿Es por tu EPS o una compra? ¿En qué ciudad estás?" },
  ]);
});

test("las plantillas guardan su condición en cada versión y al copiar el cliente", async () => {
  await saveTemplate(db, client, { code: "P20", channel: "publico", name: "Horarios en festivo", body: "¡Hola {usuario}!", whenToUse: "Pregunta si abren un festivo" });
  await saveTemplate(db, client, { code: "P20", channel: "publico", name: "Horarios en festivo", body: "¡Hola {usuario}! 💙", whenToUse: "Pregunta si abren un festivo" });
  assert.equal((await rows("SELECT when_to_use FROM templates WHERE client_id = ? AND code = 'P20' AND active", [client]))[0].when_to_use, "Pregunta si abren un festivo");
  const copy = await createClient(db, "Copia", client);
  assert.match((await rows("SELECT when_to_use FROM templates WHERE client_id = ? AND code = 'P1'", [copy]))[0].when_to_use, /^Pregunta por el domicilio de los medicamentos/);
});

test("el equipo ve lo que llegó sin plantilla, agrupado por tipo de caso", async () => {
  const [type] = await rows("SELECT id FROM case_types WHERE client_id = ? AND code = 'horarios_sedes'", [client]);
  for (const text of ["¿Abren el domingo en Palmira?", "¿A qué hora cierran en Tuluá?"]) {
    const i = await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked, case_type_id, decision) VALUES (?, ?, 'comentario', ?, ?, ?, 'escalar')", [client, account, `u${++n}`, text, type.id]);
    await insert("INSERT INTO escalations (client_id, interaction_id, reason) VALUES (?, ?, 'La respuesta no sale completa de una plantilla o de la base')", [client, i]);
  }
  const [g] = await listUncovered(db, client);
  assert.deepEqual([g.caseType, g.count, g.examples.length], ["Horarios, sedes, festivos", 2, 2]);
  assert.deepEqual(await listUncovered(db, await createClient(db, "Otro", null)), [], "solo lo del cliente");
});

test("una variable sin llenar ({puntos}) no sale: es un dato que la IA no tenía", async () => {
  const i = await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked) VALUES (?, ?, 'comentario', ?, '¿Dónde reclamo en Buga?')", [client, account, `v${++n}`]);
  const r = await classifyInteraction(db, i, async () => answer({ tipo_caso: "puntos_dispensacion", respuesta_publica: "¡Hola {usuario}! 💙 En Buga puedes reclamar tus medicamentos en estos puntos de dispensación: {puntos}" }));
  assert.equal(r?.decision, "escalar");
  const ok = await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked) VALUES (?, ?, 'comentario', ?, '¿Dónde reclamo en Palmira?')", [client, account, `v${++n}`]);
  const good = await classifyInteraction(db, ok, async () => answer({ tipo_caso: "puntos_dispensacion", respuesta_publica: "¡Hola {usuario}! 💙 En Palmira puedes reclamar tus medicamentos en Droguería Cafam Palmira Centro, Calle 30 # 28-50" }));
  assert.equal(good?.decision, "responder");
});
