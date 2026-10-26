// Plantilla y base de conocimiento combinables por canal: la plantilla pone el texto, la base el dato,
// y cada tipo de caso dice de qué temas de la base puede sacar datos.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { CASE_TYPES, TEMPLATES, seedConfig } from "../db/seed-cafam.ts";
import { buildInstructions, classifyInteraction, loadMatrix, type Classification } from "../src/lib/classify.ts";
import { type Flow, allowedTopics, flowColumns, flowFromForm, inferFlow, validateFlow } from "../src/lib/flow.ts";
import { addKnowledge } from "../src/lib/data.ts";
import { freshTestDb } from "./test-db.ts";

const templates = TEMPLATES.map(([code, , channel, body]) => ({ code, channel, body }));
const types = CASE_TYPES.map(([code, , , pub, priv, record, alert]) => ({ code, public_action: pub, private_action: priv, record_target: record, alert }));
const flowOf = (code: string) => inferFlow(types.find((t) => t.code === code)!, templates);

test("plantilla y base se combinan, y los temas sobreviven al texto que lee la IA", () => {
  assert.deepEqual(flowOf("domicilios").public, { mode: "plantilla", templates: ["P1", "P10"], base: ["cobertura"], like: false });
  assert.deepEqual(flowOf("horarios_sedes").public, { mode: "plantilla", templates: [], base: ["sede", "horario", "festivo", "enlace"], like: false });
  assert.deepEqual(flowOf("pendiente_entrega").public.base, [], "solo plantilla");
  for (const code of ["domicilios", "horarios_sedes", "puntos_dispensacion"]) {
    const f = flowOf(code);
    const again = inferFlow({ ...flowColumns(f), flow: null }, templates);
    assert.deepEqual([again.public.templates, again.public.base], [f.public.templates, f.public.base], code);
  }
  assert.equal(flowColumns(flowOf("domicilios")).public_action, "P1 / P10 pública + datos de la base (domicilios y cobertura)");
  assert.equal(flowColumns(flowOf("horarios_sedes")).public_action, "Pública con datos de la base (sedes, horarios, festivos y enlaces)");
  const dm = { ...flowOf("pendiente_entrega"), private: { mode: "plantilla", templates: [], base: ["dispensacion"], ask: ["ciudad"] } } as Flow;
  assert.equal(flowColumns(dm).private_action, "DM con datos de la base (puntos de dispensación por ciudad): pide ciudad");
});

test("los flujos guardados antes siguen funcionando: «dato de la base» pasa a todos los temas", () => {
  const old = (pub: object) => inferFlow({ public_action: null, private_action: null, record_target: null, alert: null, flow: { public: pub, private: { mode: "nada", templates: [], ask: [] }, record: "ninguno", alert: { level: "no", when: "siempre" } } }, templates);
  assert.deepEqual(old({ mode: "base", templates: [], like: false }).public, { mode: "plantilla", templates: [], base: ["sede", "horario", "festivo", "enlace", "requisito", "cobertura", "dispensacion"], like: false });
  assert.deepEqual(old({ mode: "plantilla", templates: ["P6"], like: false }).public.base, []);
  assert.deepEqual(old({ mode: "plantilla", templates: ["P6"], like: false }).private.base, []);
});

test("el editor exige plantilla o tema, y la base cuando la plantilla tiene variables", () => {
  const f = flowOf("puntos_dispensacion");
  assert.equal(validateFlow(f, templates), null);
  assert.match(validateFlow({ ...f, public: { ...f.public, templates: [], base: [] } }, templates)!, /plantilla pública o un tema de la base/);
  assert.match(validateFlow({ ...f, public: { ...f.public, base: [] } }, templates)!, /P11 usa \{ciudad\} y \{puntos\}: marca de qué temas/);
  assert.equal(validateFlow({ ...f, public: { ...f.public, templates: [], base: ["dispensacion"] } }, templates), null, "solo base");
  assert.match(validateFlow({ ...f, private: { mode: "plantilla", templates: [], base: [], ask: [] } }, templates)!, /plantilla de DM o un tema/);
});

test("el formulario solo acepta temas que existen, por canal", () => {
  const form = new FormData();
  form.set("public_mode", "plantilla");
  for (const v of ["cobertura", "contraseñas"]) form.append("public_base", v);
  form.append("private_base", "dispensacion");
  const f = flowFromForm(form);
  assert.deepEqual([f.public.base, f.private.base], [["cobertura"], ["dispensacion"]]);
  assert.deepEqual(allowedTopics({ mode: "corta", base: ["sede"] }), [], "una respuesta corta no saca datos de la base");
  assert.equal(allowedTopics({ mode: "caso_fondo", base: [] }).length, 7, "el caso de fondo usa los temas de ese caso");
});

let db: Pool;
let client = 0;
let account = 0;
let n = 0;
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const quiet = { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false };
const answer = (over: Partial<Classification>): Classification => ({
  tipo_caso: "horarios_sedes", confianza: 0.95, cubierto: true, es_queja_o_pregunta: true, sentimiento: "neutral", plantilla_publica: null, plantilla_privada: null,
  senales: quiet, respuesta_publica: null, respuesta_privada: null, motivo_escalamiento: null, falta_contexto: false, ...over,
});

before(async () => {
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('Droguería')", []);
  await seedConfig(db as any, client);
  await addKnowledge(db, client, { topic: "enlace", title: "Horarios de todas las tiendas", content: "https://cafam.example/horarios" });
  await addKnowledge(db, client, { topic: "cobertura", title: "Cali", content: "Domicilio de compras por la web" });
  account = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name) VALUES (?, 'ig', 'I1', 'P1', '@d')", [client]);
});
after(() => db.end());

test("la IA ve el tema de cada dato y qué temas usa cada tipo de caso", async () => {
  const m = await loadMatrix(db, client);
  const text = buildInstructions("Droguería", m.types, m.templates, m.knowledge, m.learned, m.forbidden);
  assert.match(text, /- \[Domicilios y cobertura\] Cobertura de domicilios en Cali: Domicilio de compras por la web/);
  assert.match(text, /- \[Enlaces\] Horarios de todas las tiendas: https:\/\/cafam\.example\/horarios/);
  assert.match(text, /domicilios: Domicilios\..*Acción pública: P1 \/ P10 \+ datos de la base \(domicilios y cobertura\)/);
});

test("un dato de un tema que el tipo de caso no usa no cuenta como cubierto", async () => {
  const reply = "¡Hola {usuario}! 💙 Aquí ves los horarios: https://cafam.example/horarios";
  const comment = async () => insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, text_masked) VALUES (?, ?, 'comentario', ?, '¿A qué hora abren?')", [client, account, `b${++n}`]);
  const ok = await classifyInteraction(db, await comment(), async () => answer({ respuesta_publica: reply }));
  assert.equal(ok?.decision, "responder", "horarios_sedes usa enlaces");
  const off = await classifyInteraction(db, await comment(), async () => answer({ tipo_caso: "domicilios", respuesta_publica: reply }));
  assert.equal(off?.decision, "escalar", "domicilios solo usa cobertura");
});
