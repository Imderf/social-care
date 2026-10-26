// Etapa asistida y aprendizaje: aceptar, corregir y descartar borradores; publicar en Meta (con un
// Meta falso); no contar el eco propio como del equipo; graduar y frenar tipos de caso; ejemplos.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { dismissSuggestion, excludeExample, knowledgeSuggestions, learnedExamples, refreshGraduation, reviewProposal, setAccountMode, undoReview } from "../src/lib/learning.ts";
import { addKnowledge } from "../src/lib/data.ts";
import { publishAction } from "../src/lib/publish.ts";
import { processMetaEvent } from "../src/lib/meta-events.ts";
import { classifyInteraction } from "../src/lib/classify.ts";
import { seedConfig } from "../db/seed-cafam.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let live = 0; // cuenta en asistido
let test_ = 0; // cuenta en modo prueba
let contact = 0;
let emoji = 0; // tipo positivo_emoji
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
let n = 0;
const proposal = (account: number, reply = "¡Gracias @lu.m! 💙", decision = "responder") =>
  insert(
    "INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked, case_type_id, decision, proposed_reply) VALUES (?, ?, 'comentario', ?, ?, '💙', ?, ?, ?)",
    [client, account, `c${++n}`, contact, emoji, decision, reply],
  );
const fakeMeta = () => {
  const calls: string[] = [];
  return {
    calls,
    meta: {
      replyToComment: async (_p: string, id: string, text: string) => (calls.push(`responder ${id} ${text}`), `r_${id}`),
      hideComment: async (_p: string, id: string) => (calls.push(`ocultar ${id}`), null),
      sendMessage: async (_page: string, to: string, text: string) => (calls.push(`dm ${to} ${text}`), `mid_${to}`),
    },
  };
};

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('Droguería A')", []);
  await seedConfig(db as any, client);
  emoji = (await rows("SELECT id FROM case_types WHERE client_id = ? AND code = 'positivo_emoji'", [client]))[0].id;
  live = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'fb', '111', '111', 'Página', ?)", [client, encryptToken("tok")]);
  test_ = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted) VALUES (?, 'ig', '222', '111', '@cuenta', ?)", [client, encryptToken("tok")]);
  await setAccountMode(db, client, live, "en_vivo");
  contact = await insert("INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, 'fb', 'u1', 'lu.m')", [client]);
});
after(() => db.end());

test("en asistido, aceptar publica una sola vez; el eco propio no cuenta como del equipo", async () => {
  const id = await proposal(live);
  assert.deepEqual(await reviewProposal(db, client, id, {}), { verdict: "correcta", published: true });
  assert.equal((await reviewProposal(db, client, id, {}))?.published, false, "aprobar dos veces no publica dos veces");
  const [action] = await rows("SELECT id, type, status, actor, JSON_UNQUOTE(payload->'$.text') AS text FROM actions WHERE interaction_id = ?", [id]);
  assert.deepEqual([action.type, action.status, action.actor, action.text], ["responder", "pendiente", "persona", "¡Gracias @lu.m! 💙"]);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM jobs WHERE type = 'publish'"))[0].n, 1);

  const { calls, meta } = fakeMeta();
  await publishAction(db, action.id, meta);
  assert.deepEqual(calls, [`responder c${n} ¡Gracias @lu.m! 💙`]);
  const [i] = await rows("SELECT answered_by, first_response_at FROM interactions WHERE id = ?", [id]);
  assert.equal(i.answered_by, "ia");
  assert.ok(i.first_response_at);
  assert.equal(await publishAction(db, action.id, meta), null, "una acción hecha no se repite");

  const echo = { object: "page", entry: [{ id: "111", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: `r_c${n}`, post_id: "111_p", parent_id: `c${n}`, from: { id: "111", name: "Página" }, message: "¡Gracias @lu.m! 💙" } }] }] };
  const ev = await insert("INSERT INTO webhook_events (dedupe_key, payload) VALUES (UUID(), ?)", [JSON.stringify(echo)]);
  assert.equal((await processMetaEvent(db, ev)).replies, 0);
  assert.equal((await rows("SELECT human_reply FROM interactions WHERE id = ?", [id]))[0].human_reply, null);
});

test("corregir publica lo corregido y queda como ejemplo; descartar no publica y pasa a la bandeja", async () => {
  const fixed = await proposal(live);
  assert.equal((await reviewProposal(db, client, fixed, { text: "¡Gracias a ti, @lu.m! 💙 Aquí estamos." }))?.verdict, "corregir");
  assert.equal((await rows("SELECT JSON_UNQUOTE(payload->'$.text') AS t FROM actions WHERE interaction_id = ?", [fixed]))[0].t, "¡Gracias a ti, @lu.m! 💙 Aquí estamos.");
  const ex = await learnedExamples(db, client);
  assert.equal(ex[0].reply, "¡Gracias a ti, {usuario}! 💙 Aquí estamos.", "el ejemplo va sin el usuario");

  const dropped = await proposal(live);
  assert.deepEqual(await reviewProposal(db, client, dropped, { discard: true, note: "no aplica" }), { verdict: "incorrecta", published: false });
  assert.equal((await rows("SELECT COUNT(*) AS n FROM actions WHERE interaction_id = ?", [dropped]))[0].n, 0);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM escalations WHERE interaction_id = ?", [dropped]))[0].n, 1);
});

test("deshacer devuelve el borrador mientras no se haya publicado", async () => {
  // Descartar por error: vuelve a quedar por revisar y se quita de la bandeja.
  const dropped = await proposal(live);
  await reviewProposal(db, client, dropped, { discard: true });
  assert.equal(await undoReview(db, client, dropped), true);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM verifications WHERE interaction_id = ?", [dropped]))[0].n, 0);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM escalations WHERE interaction_id = ?", [dropped]))[0].n, 0);

  // Aceptar por error: la publicación espera unos segundos y se cancela.
  const accepted = await proposal(live);
  await reviewProposal(db, client, accepted, {});
  const [job] = await rows("SELECT run_at > NOW(3) AS waits FROM jobs WHERE type = 'publish' ORDER BY id DESC LIMIT 1");
  assert.equal(Number(job.waits), 1, "lo que aprueba una persona no sale de inmediato");
  assert.equal(await undoReview(db, client, accepted), true);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM actions WHERE interaction_id = ?", [accepted]))[0].n, 0);
  assert.equal((await reviewProposal(db, client, accepted, {}))?.published, true, "se puede volver a aceptar");

  // Ya publicada: no se deshace desde aquí.
  const [x] = await rows("SELECT id FROM actions WHERE interaction_id = ?", [accepted]);
  await db.query("UPDATE jobs SET status = 'done' WHERE type = 'publish' AND JSON_EXTRACT(payload, '$.action_id') = ?", [x.id]);
  await publishAction(db, x.id, fakeMeta().meta);
  assert.equal(await undoReview(db, client, accepted), false);
});

test("en modo prueba, aceptar solo califica: no publica nada", async () => {
  const id = await proposal(test_);
  assert.deepEqual(await reviewProposal(db, client, id, {}), { verdict: "correcta", published: false });
  assert.equal((await rows("SELECT COUNT(*) AS n FROM actions WHERE interaction_id = ?", [id]))[0].n, 0);
});

test("un tipo responde solo con los días y el acierto; si el acierto baja, vuelve a pedir aprobación", async () => {
  for (let k = 0; k < 20; k++) await reviewProposal(db, client, await proposal(test_), {});
  const isLive = async () => !!(await rows("SELECT live_enabled FROM case_types WHERE id = ?", [emoji]))[0].live_enabled;
  assert.equal(await isLive(), false, "con el acierto pero sin los días, todavía no");

  await db.query("UPDATE accounts SET live_since = NOW(3) - INTERVAL 8 DAY WHERE id = ?", [live]);
  await refreshGraduation(db, client);
  assert.equal(await isLive(), true);

  // Ya graduado: la IA publica sola en la cuenta asistida.
  const id = await insert("INSERT INTO interactions (client_id, account_id, kind, meta_id, contact_id, text_masked) VALUES (?, ?, 'comentario', 'auto1', ?, '💙')", [client, live, contact]);
  const quiet = { salud_critica: false, insulto_grave: false, datos_expuestos: false, competencia: false, crisis: false, menciona_medio_o_figura: false, accion_legal: false };
  const r = await classifyInteraction(db, id, async () => ({
    tipo_caso: "positivo_emoji", confianza: 0.98, cubierto: true, es_queja_o_pregunta: false, sentimiento: "positivo", plantilla_publica: null, plantilla_privada: null, senales: quiet,
    respuesta_publica: "¡Gracias {usuario}! 💙", respuesta_privada: null, motivo_escalamiento: null,
  }));
  assert.equal(r?.published, true);
  assert.equal((await rows("SELECT actor FROM actions WHERE interaction_id = ?", [id]))[0].actor, "ia");

  for (let k = 0; k < 6; k++) await reviewProposal(db, client, await proposal(test_), { discard: true });
  assert.equal(await isLive(), false, "freno: el acierto bajó del 90 %");
});

test("lo aprendido se puede quitar, y los datos nuevos de una corrección se sugieren para la base", async () => {
  const id = await proposal(test_);
  await reviewProposal(db, client, id, { text: "¡Hola @lu.m! Abrimos de 7:00 a. m. a 7:00 p. m.; agenda en https://citas.ejemplo.co 💙" });
  const ex = (await learnedExamples(db, client, 50)).find((e) => e.reply.includes("citas.ejemplo.co"));
  assert.ok(ex, "la corrección es un ejemplo");
  assert.ok(!ex!.reply.includes("lu.m"));

  const sug = await knowledgeSuggestions(db, client);
  assert.ok(sug.some((x) => x.topic === "enlace" && x.value === "https://citas.ejemplo.co"));
  assert.ok(sug.some((x) => x.topic === "horario" && /7:00 a\. m\./.test(x.value)));
  assert.ok(!sug.some((x) => x.value.includes("drogueriascafam.com.co")), "lo que ya está en una plantilla no se sugiere");

  await addKnowledge(db, client, { topic: "enlace", title: "Citas", content: "https://citas.ejemplo.co" });
  assert.ok(!(await knowledgeSuggestions(db, client)).some((x) => x.value === "https://citas.ejemplo.co"), "guardado en la base, deja de sugerirse");
  await dismissSuggestion(db, client, ex!.id);
  assert.ok(!(await knowledgeSuggestions(db, client)).some((x) => x.id === ex!.id), "descartada, no vuelve");

  await excludeExample(db, client, ex!.id);
  assert.ok(!(await learnedExamples(db, client, 50)).some((e) => e.id === ex!.id), "quitado, la IA ya no lo recibe");
});
