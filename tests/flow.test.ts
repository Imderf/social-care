// Matriz por selecciones: la matriz de Cafam se convierte en flujos, los textos conservan los
// códigos de plantilla y no se acepta una plantilla que no exista.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASE_TYPES, TEMPLATES } from "../db/seed-cafam.ts";
import { flowColumns, flowFromForm, inferFlow, validateFlow } from "../src/lib/flow.ts";

const templates = TEMPLATES.map(([code, , channel, body]) => ({ code, channel, body }));
const types = CASE_TYPES.map(([code, , , pub, priv, record, alert]) => ({ code, public_action: pub, private_action: priv, record_target: record, alert }));
const flowOf = (code: string) => inferFlow(types.find((t) => t.code === code)!, templates);

test("toda la matriz de Cafam se convierte en selecciones válidas", () => {
  for (const t of types) assert.equal(validateFlow(inferFlow(t, templates), templates), null, t.code);
  assert.deepEqual([flowOf("empleo").public.mode, flowOf("empleo").private.templates], ["contencion", ["P8"]], "P8 es un DM: se pasa al DM");
  assert.deepEqual(flowOf("pendiente_entrega").public, { mode: "plantilla", templates: ["P6"], base: [], like: false });
  assert.deepEqual(flowOf("pendiente_entrega").private.templates, ["P6"]);
  assert.ok(flowOf("pendiente_entrega").private.ask.includes("autorizacion"));
  assert.deepEqual(flowOf("puntos_dispensacion").public.templates, ["P11", "P3", "P2"]);
  assert.deepEqual([flowOf("positivo_emoji").public.mode, flowOf("positivo_emoji").public.like], ["corta", true]);
  assert.equal(flowOf("datos_personales").public.mode, "ocultar");
  assert.equal(flowOf("no_encaja").public.mode, "contencion");
  assert.deepEqual(flowOf("alto_alcance").alert, { level: "inmediata", when: "siempre" });
  assert.equal(flowOf("politica_spam").record, "bitacora_moderacion");
});

test("los textos derivados conservan los códigos de plantilla", () => {
  const c = flowColumns(flowOf("pendiente_entrega"));
  assert.match(c.public_action!, /\bP6\b/);
  assert.match(c.private_action!, /^P6 DM: pide .*autorización de datos/);
  assert.equal(flowColumns(flowOf("citas")).alert, null);
  assert.equal(flowColumns(flowOf("publicidad_enganosa")).alert, "Avisa al área comercial");
});

test("no deja usar una plantilla que no existe, ni pedir datos sin marcar cuáles", () => {
  const f = flowOf("pendiente_entrega");
  assert.match(validateFlow({ ...f, public: { ...f.public, templates: ["P99"] } }, templates)!, /P99 no existe/);
  assert.match(validateFlow({ ...f, public: { ...f.public, templates: [] } }, templates)!, /créala primero/);
  assert.match(validateFlow({ ...f, private: { mode: "pedir", templates: [], base: [], ask: [] } }, templates)!, /qué datos/);
  assert.match(validateFlow({ ...f, private: { ...f.private, templates: ["P1"] } }, templates)!, /DM P1 no existe/, "P1 es solo pública");
});

test("el formulario solo acepta valores de las listas", () => {
  const form = new FormData();
  form.set("public_mode", "borrar_todo");
  form.append("public_templates", "P6");
  form.append("public_templates", "<script>");
  form.append("ask", "ciudad");
  form.append("ask", "contraseña");
  form.set("record", "hoja_mes");
  const f = flowFromForm(form);
  assert.equal(f.public.mode, "nada");
  assert.deepEqual(f.public.templates, ["P6"]);
  assert.deepEqual(f.private.ask, ["ciudad"]);
  assert.equal(f.record, "hoja_mes");
});
