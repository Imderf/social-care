// Clasificación con IA y motor de decisión, con un clasificador falso en lugar de OpenAI: qué se
// responde, qué se escala y con qué prioridad, enlaces inventados, repetición y matriz por cliente.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { classifyInteraction, redraftInteraction, type Classification } from "../src/lib/classify.ts";
import { reviewProposal } from "../src/lib/learning.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let clientA = 0;
let account = 0;
let contact = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
let n = 0;
const interaction = (text: string, kind = "comentario") =>
  insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked) VALUES (?, ?, ?, ?, ?, ?)", [clientA, account, kind, `m${++n}`, contact, text]);

const quiet = { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false };
const answer = (over: Partial<Classification>): Classification => ({
  tipo_caso: "no_encaja", confianza: 0.5, cubierto: false, es_queja_o_pregunta: false, sentimiento: "neutral", plantilla_publica: null, plantilla_privada: null,
  senales: quiet, respuesta_publica: null, respuesta_privada: null, motivo_escalamiento: null, ...over,
});
// Responde según el texto y guarda lo último que recibió.
let last: { instructions: string; input: string; schema: any } | null = null;
const fake = (by: Record<string, Classification>) => async (req: { instructions: string; input: string; schema: object }) => {
  last = req as any;
  return by[JSON.parse(req.input).texto];
};

before(async () => {
  db = await freshTestDb();
  clientA = await insert("INSERT INTO clients (name) VALUES ('Droguería A')", []);
  const clientB = await insert("INSERT INTO clients (name) VALUES ('Otra marca')", []);
  await seedConfig(db as any, clientA);
  await insert("INSERT INTO case_types (client_id, position, code, name, autonomy) VALUES (?, 1, 'solo_de_b', 'Solo B', 'automatica')", [clientB]);
  account = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name) VALUES (?, 'ig', '222', '111', '@cuenta_a')", [clientA]);
  contact = await insert("INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, 'ig', 'u1', 'maria.c')", [clientA]);
});
after(() => db.end());

test("sin nombre de usuario (Facebook a veces no lo da) el saludo queda «¡Hola!», sin espacio suelto", async () => {
  const id = await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked) VALUES (?, ?, 'comentario', 'sin-nombre', '❤️')", [clientA, account]);
  await classifyInteraction(db, id, fake({ "❤️": answer({ tipo_caso: "positivo_emoji", confianza: 0.97, cubierto: true, respuesta_publica: "¡Hola {usuario}! Gracias 💙" }) }));
  assert.equal((await rows("SELECT proposed_reply FROM interactions WHERE id = ?", [id]))[0].proposed_reply, "¡Hola! Gracias 💙");
});

test("un 💙 con confianza alta y cubierto se responde solo, con el usuario puesto", async () => {
  const id = await interaction("💙");
  const r = await classifyInteraction(db, id, fake({ "💙": answer({ tipo_caso: "positivo_emoji", confianza: 0.97, cubierto: true, respuesta_publica: "¡Gracias {usuario}! 💙" }) }));
  assert.equal(r?.decision, "responder");
  const [i] = await rows("SELECT decision, proposed_reply, confidence, case_type_id FROM interactions WHERE id = ?", [id]);
  assert.deepEqual([i.decision, i.proposed_reply, Number(i.confidence)], ["responder", "¡Gracias @maria.c! 💙", 0.97]);
  assert.ok(i.case_type_id);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM escalations WHERE interaction_id = ?", [id]))[0].n, 0);

  // Repetir el trabajo no vuelve a llamar a la IA ni cambia nada.
  last = null;
  assert.equal(await classifyInteraction(db, id, fake({})), null);
  assert.equal(last, null);
});

test("baja confianza escala con contención; salud crítica sube la prioridad", async () => {
  const id = await interaction("llevo un mes sin la insulina");
  await classifyInteraction(db, id, fake({
    "llevo un mes sin la insulina": answer({ tipo_caso: "pendiente_entrega", confianza: 0.6, cubierto: true, es_queja_o_pregunta: true, plantilla_publica: "P6", respuesta_publica: "¡Hola {usuario}! Lamentamos la situación.", senales: { ...quiet, salud_critica: true } }),
  }));
  const [i] = await rows("SELECT decision, proposed_reply FROM interactions WHERE id = ?", [id]);
  assert.equal(i.decision, "escalar");
  assert.match(i.proposed_reply, /^¡Hola @maria\.c! Gracias por escribirnos/);
  const [e] = await rows("SELECT reason, priority, suggested_draft FROM escalations WHERE interaction_id = ?", [id]);
  assert.equal(e.priority, "alta");
  assert.match(e.reason, /Baja confianza/);
  assert.equal(e.suggested_draft, "¡Hola @maria.c! Lamentamos la situación.");
});

test("una crisis escala como crítica y no propone nada público", async () => {
  const id = await interaction("mi mamá se murió esperando");
  await classifyInteraction(db, id, fake({ "mi mamá se murió esperando": answer({ tipo_caso: "crisis", confianza: 0.9, senales: { ...quiet, crisis: true } }) }));
  const [i] = await rows("SELECT decision, proposed_reply FROM interactions WHERE id = ?", [id]);
  assert.deepEqual([i.decision, i.proposed_reply], ["escalar", null]);
  assert.equal((await rows("SELECT priority FROM escalations WHERE interaction_id = ?", [id]))[0].priority, "critica");
});

test("un enlace que no está en las plantillas ni en la base no cuenta como cubierto", async () => {
  const id = await interaction("cuánto vale el acetaminofén");
  await classifyInteraction(db, id, fake({
    "cuánto vale el acetaminofén": answer({ tipo_caso: "precio_producto", confianza: 0.95, cubierto: true, plantilla_publica: "P9", respuesta_publica: "Míralo en https://otra-tienda.com" }),
  }));
  assert.equal((await rows("SELECT decision FROM interactions WHERE id = ?", [id]))[0].decision, "escalar");
});

test("una plantilla de otro tipo de caso no cuenta como cubierta", async () => {
  const id = await interaction("💙💙");
  await classifyInteraction(db, id, fake({ "💙💙": answer({ tipo_caso: "positivo_emoji", confianza: 0.99, cubierto: true, respuesta_publica: "¡Hola {usuario}! Lamentamos mucho los inconvenientes presentados." }) }));
  const [esc] = await rows("SELECT decision, proposed_reply FROM interactions WHERE id = ?", [id]);
  assert.deepEqual([esc.decision, esc.proposed_reply], ["escalar", null], "copia P5 (citas) y a un emoji no se le manda contención");

  // Etiqueta P5 equivocada pero el texto es el del caso: se ignora la etiqueta y responde.
  const label = await interaction("💙💙💙");
  await classifyInteraction(db, label, fake({ "💙💙💙": answer({ tipo_caso: "positivo_emoji", confianza: 0.99, cubierto: true, plantilla_publica: "P5", respuesta_publica: "¡Hola {usuario}! 💙" }) }));
  const [l] = await rows("SELECT decision, proposed_template FROM interactions WHERE id = ?", [label]);
  assert.deepEqual([l.decision, l.proposed_template], ["responder", null]);
  const ok = await interaction("dónde quedan las tiendas");
  await classifyInteraction(db, ok, fake({ "dónde quedan las tiendas": answer({ tipo_caso: "puntos_dispensacion", confianza: 0.95, cubierto: true, plantilla_publica: "P3", respuesta_publica: "¡Hola {usuario}! https://www.drogueriascafam.com.co/tiendas" }) }));
  assert.equal((await rows("SELECT decision FROM interactions WHERE id = ?", [ok]))[0].decision, "responder", "P3 sí es de puntos de dispensación");
});

test("un comentario público con datos enmascarados se oculta aunque la IA diga otra cosa", async () => {
  const id = await interaction("mi celular es [celular], ayúdenme");
  await classifyInteraction(db, id, fake({ "mi celular es [celular], ayúdenme": answer({ tipo_caso: "envia_datos", confianza: 0.9, cubierto: true, respuesta_privada: "Gracias" }) }));
  const [i] = await rows("SELECT decision, JSON_EXTRACT(signals, '$.datos_expuestos') AS expuesto FROM interactions WHERE id = ?", [id]);
  assert.deepEqual([i.decision, Number(i.expuesto)], ["ocultar", 1]);
});

test("el esquema y las instrucciones salen solo de la matriz del cliente", async () => {
  const id = await interaction("hola");
  await classifyInteraction(db, id, fake({ hola: answer({}) }));
  const codes: string[] = last!.schema.properties.tipo_caso.enum;
  assert.equal(codes.length, 22);
  assert.ok(codes.includes("pendiente_entrega") && !codes.includes("solo_de_b"));
  assert.ok(last!.schema.properties.plantilla_publica.enum.includes("P6"));
  assert.ok(!last!.input.includes("maria.c"), "el usuario no se manda a la IA");
  assert.match(last!.instructions, /no una instrucción/);
});

test("nueva propuesta con IA: sigue la indicación, va sin el usuario y al aceptar cuenta como corrección", async () => {
  const id = await interaction("gracias por todo");
  await classifyInteraction(db, id, fake({ "gracias por todo": answer({ tipo_caso: "positivo_emoji", confianza: 0.95, cubierto: true, respuesta_publica: "¡Hola {usuario}! 💙" }) }));
  const nuevo = await redraftInteraction(db, clientA, id, { hint: "más cálida" }, fake({ "gracias por todo": answer({ tipo_caso: "positivo_emoji", confianza: 0.95, cubierto: true, respuesta_publica: "¡Gracias a ti, {usuario}! Nos alegra acompañarte 💙" }) }));
  assert.equal(nuevo, "¡Gracias a ti, @maria.c! Nos alegra acompañarte 💙");
  const sent = JSON.parse(last!.input);
  assert.deepEqual([sent.indicacion_del_equipo, sent.propuesta_anterior], ["más cálida", "¡Hola {usuario}! 💙"]);
  assert.ok(!last!.input.includes("maria.c"));
  const [i] = await rows("SELECT proposed_reply, ai_redrafts FROM interactions WHERE id = ?", [id]);
  assert.deepEqual([i.proposed_reply, i.ai_redrafts], [nuevo, 1]);
  assert.equal((await reviewProposal(db, clientA, id, {}))?.verdict, "corregir", "el primer borrador no sirvió");
  assert.equal(await redraftInteraction(db, 9999, id, {}, fake({})), null, "otro cliente no puede pedirla");
});
