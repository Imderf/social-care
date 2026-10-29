// Hoja de casos, fase A: leer la Hoja que llena el equipo y avisar a la persona cuando su caso cambia
// a un estado que avisa, según la ventana de Meta (24 h solo, 7 días con una persona, después espera).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptToken } from "../src/lib/crypto.ts";
import { DEFAULT_CASES, dueSyncs, getCases, lastSlot, parseTab, releaseWaitingNotices, sendNotice, setCases, stateOf, syncSheet } from "../src/lib/cases.ts";
import { GoogleError, type SheetTab } from "../src/lib/google.ts";
import { cannotSend, sendFromInbox } from "../src/lib/inbox.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
let client = 0;
let account = 0;
let n = 0;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];
const insert = async (q: string, p: unknown[]) => (await db.query<ResultSetHeader>(q, p))[0].insertId;
const H = 3600e3;
const NOW = new Date("2026-10-27T15:00:00Z");
const person = async (username: string, kinds: { kind: "dm" | "comentario"; hoursAgo: number }[]) => {
  const c = await insert("INSERT INTO contacts (client_id, platform, meta_user_id, username) VALUES (?, 'ig', ?, ?)", [client, `u${++n}`, username]);
  for (const k of kinds) {
    const at = new Date(NOW.getTime() - k.hoursAgo * H);
    await insert("INSERT INTO interactions (client_id, account_id, contact_id, kind, meta_id, text_masked, received_at, window_expires_at) VALUES (?, ?, ?, ?, ?, 'Hola', ?, ?)", [
      client, account, c, k.kind, `m${++n}`, at, k.kind === "dm" ? new Date(at.getTime() + 24 * H) : null,
    ]);
  }
  return c;
};
let sheet: string[][] = [];
const reader = async () => ({ name: "Casos", tabs: [{ title: "Octubre 2026", rows: sheet }] });
const header = ["Fecha", "Caso", "Perfil", "Red social", "Cédula", "Estado para el usuario", "Resultado"];
const row = (caso: string, perfil: string, estado: string, resultado = "", red = "Instagram") => ["27/10", caso, perfil, red, "1000000001", estado, resultado];
const fakeMeta = () => {
  const calls: { text: string; tag?: string }[] = [];
  return { calls, meta: { sendMessage: async (_p: string, _to: string, text: string, _t: string, tag?: string) => (calls.push({ text, tag }), `mid_${calls.length}`) } };
};

before(async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
  process.env.SESSION_SECRET ||= randomBytes(32).toString("base64");
  db = await freshTestDb();
  client = await insert("INSERT INTO clients (name) VALUES ('Droguería')", []);
  account = await insert("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, mode, token_encrypted) VALUES (?, 'ig', 'I1', 'P1', '@marca', 'en_vivo', ?)", [client, encryptToken("t")]);
  await insert("INSERT INTO google_connections (client_id, email, refresh_token_encrypted, spreadsheet_id) VALUES (?, 'social@marca.co', ?, 'hoja123')", [client, encryptToken("r")]);
});
after(() => db.end());

test("la fila de títulos puede no ser la primera y los nombres no distinguen tildes ni mayúsculas", () => {
  const tab: SheetTab = { title: "T", rows: [["Casos de octubre"], [], ["fecha", "CASO", "perfil", "red social", "estado para el usuario", "resultado"], ["1", "7", "@ana.m", "IG", "Entregado", "Ok"], ["2", "", "@x", "IG", "Pendiente"]] };
  assert.deepEqual(parseTab(tab, DEFAULT_CASES.columns), [{ caso: "7", perfil: "@ana.m", red: "IG", estado: "Entregado", resultado: "Ok" }]);
  assert.deepEqual(parseTab({ title: "T", rows: [["Otra cosa"]] }, DEFAULT_CASES.columns), []);
});

test("la configuración se valida: horarios, textos de los estados que avisan y variables", async () => {
  assert.match((await setCases(db, client, { ...DEFAULT_CASES, times: ["9am"] }))!, /horarios/);
  assert.match((await setCases(db, client, { ...DEFAULT_CASES, states: [{ value: "Entregado", notify: true, text: "" }] }))!, /escribe el texto/);
  assert.match((await setCases(db, client, { ...DEFAULT_CASES, states: [{ value: "Entregado", notify: true, text: "Hola {nombre}" }] }))!, /\{nombre\}/);
  assert.equal(await setCases(db, client, { ...DEFAULT_CASES, origin: "dm" }), null);
  assert.equal((await getCases(db, client)).origin, "dm");
});

test("solo se siguen los casos de quien escribió por los canales elegidos; lo que ya estaba no se avisa", async () => {
  await person("ana.m", [{ kind: "dm", hoursAgo: 2 }]);
  await person("solo.comenta", [{ kind: "comentario", hoursAgo: 2 }]);
  sheet = [header, row("1", "@ana.m", "Entregado", "Ya puedes reclamar"), row("2", "@solo.comenta", "Pendiente"), row("3", "@llamada.telefonica", "Pendiente")];
  const r = await syncSheet(db, client, reader, NOW);
  assert.deepEqual(r, { leidas: 3, casos: 1, cambios: 0, avisos: 0 }, "origen «solo DM»: el que solo comentó y el de la llamada no se leen");
  assert.equal((await rows("SELECT COUNT(*) AS n FROM case_notices"))[0].n, 0, "Entregado desde el principio: no se avisa");
  assert.ok(!(await rows("SELECT * FROM sheet_cases WHERE case_number = '1'"))[0].result.includes("1000000001"));

  await setCases(db, client, { ...DEFAULT_CASES, origin: "dm_comentario" });
  assert.equal((await syncSheet(db, client, reader, NOW) as any).casos, 2, "con comentario o DM, también el que comentó");
});

test("dentro de 24 h el aviso sale solo, una vez, con el texto del estado", async () => {
  const c = await person("luisa.p", [{ kind: "dm", hoursAgo: 3 }]);
  sheet = [header, row("10", "luisa.p", "Pendiente")];
  await syncSheet(db, client, reader, NOW);
  sheet = [header, row("10", "luisa.p", "Entregado", "reclámalo en Centenario")];
  const r = await syncSheet(db, client, reader, NOW);
  assert.equal((r as any).avisos, 1);
  const [notice] = await rows("SELECT n.* FROM case_notices n JOIN sheet_cases s ON s.id = n.sheet_case_id WHERE s.contact_id = ?", [c]);
  assert.equal(notice.delivery, "enviar");
  assert.equal(notice.text, "¡Hola @luisa.p! 💙 Tu caso 10 quedó resuelto: reclámalo en Centenario. Gracias por tu paciencia.");
  const { calls, meta } = fakeMeta();
  assert.deepEqual(await sendNotice(db, notice.id, meta, NOW), { sent: true, tag: null });
  assert.equal(await sendNotice(db, notice.id, meta, NOW), null, "no se repite");
  assert.equal(calls.length, 1);
  assert.equal((await rows("SELECT delivery FROM case_notices WHERE id = ?", [notice.id]))[0].delivery, "enviado");
  await syncSheet(db, client, reader, NOW);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM case_notices WHERE id = ?", [notice.id]))[0].n, 1, "leer otra vez no crea otro aviso");
});

test("entre 24 h y 7 días va a la Bandeja y una persona lo envía como agente humano; después de 7 días espera", async () => {
  const late = await person("tres.dias", [{ kind: "dm", hoursAgo: 72 }]);
  const old = await person("diez.dias", [{ kind: "dm", hoursAgo: 240 }]);
  const noDm = await person("solo.comento", [{ kind: "comentario", hoursAgo: 5 }]);
  const noResult = await person("sin.resultado", [{ kind: "dm", hoursAgo: 1 }]);
  sheet = [header, row("20", "tres.dias", "Pendiente"), row("21", "diez.dias", "Pendiente"), row("22", "solo.comento", "Pendiente"), row("23", "sin.resultado", "Pendiente")];
  await syncSheet(db, client, reader, NOW);
  sheet = [header, row("20", "tres.dias", "Entregado", "listo"), row("21", "diez.dias", "Entregado", "listo"), row("22", "solo.comento", "Entregado", "listo"), row("23", "sin.resultado", "Entregado")];
  await syncSheet(db, client, reader, NOW);
  const of = async (c: number) => (await rows("SELECT n.* FROM case_notices n JOIN sheet_cases s ON s.id = n.sheet_case_id WHERE s.contact_id = ?", [c]))[0];
  assert.equal((await of(late)).delivery, "bandeja");
  assert.equal((await of(old)).delivery, "esperando");
  assert.equal((await of(noDm)).delivery, "sin_dm");
  assert.equal((await of(noResult)).delivery, "bandeja", "el texto pide el resultado y la Hoja no lo tiene");

  const n3 = await of(late);
  const [e] = await rows("SELECT id, reason, suggested_draft FROM escalations WHERE id = ?", [n3.escalation_id]);
  assert.match(e.reason, /Aviso del caso 20: Entregado\. Envíalo tú/);
  assert.match(e.suggested_draft, /caso 20 quedó resuelto/);
  const blocked = cannotSend({ mode: "en_vivo", analysis_only: 0, kind: "dm", window_expires_at: new Date(Date.now() - 48 * H), notice_id: n3.id });
  assert.equal(blocked, null, "aviso en la Bandeja dentro de 7 días: se puede enviar");
  assert.match(cannotSend({ mode: "en_vivo", analysis_only: 0, kind: "dm", window_expires_at: new Date(Date.now() - 48 * H) })!, /24 h/, "un DM normal pasado de 24 h sigue sin poder");
  assert.match(cannotSend({ mode: "en_vivo", analysis_only: 0, kind: "dm", window_expires_at: new Date(Date.now() - 8 * 24 * H), notice_id: n3.id })!, /7 días/);

  // La Bandeja usa la hora real; el último mensaje se acerca a hoy para que esté dentro de los 7 días.
  await db.query("UPDATE interactions SET received_at = NOW(3) - INTERVAL 3 DAY, window_expires_at = NOW(3) - INTERVAL 2 DAY WHERE contact_id = ?", [late]);
  assert.deepEqual(await sendFromInbox(db, client, e.id, { text: "¡Hola @tres.dias! Tu caso 20 quedó resuelto 💙" }), { ok: true });
  const { calls, meta } = fakeMeta();
  assert.deepEqual(await sendNotice(db, n3.id, meta), { sent: true, tag: "HUMAN_AGENT" });
  assert.equal(calls[0].text, "¡Hola @tres.dias! Tu caso 20 quedó resuelto 💙", "sale lo que corrigió la persona");
  assert.ok((await rows("SELECT resolved_at FROM escalations WHERE id = ?", [e.id]))[0].resolved_at, "la tarjeta se cierra");

  // Diez días: cuando vuelve a escribir, el aviso sale por esa conversación.
  const fresh = await insert("INSERT INTO interactions (client_id, account_id, contact_id, kind, meta_id, text_masked, received_at, window_expires_at) VALUES (?, ?, ?, 'dm', ?, 'Hola otra vez', NOW(3), NOW(3) + INTERVAL 1 DAY)", [client, account, old, `m${++n}`]);
  assert.equal(await releaseWaitingNotices(db, client, old, fresh), 1);
  assert.equal((await of(old)).delivery, "enviar");
});

test("sin acceso a la Hoja se anota el motivo y se intenta en el siguiente turno", async () => {
  const denied = async () => Promise.reject(new GoogleError("forbidden", 403));
  const r = await syncSheet(db, client, denied, NOW);
  assert.match((r as any).error, /Sin acceso a la Hoja/);
  assert.match((await rows("SELECT last_sync_summary FROM google_connections WHERE client_id = ?", [client]))[0].last_sync_summary, /Sin acceso/);
});

test("turnos: 2 lecturas al día en hora de Colombia, sin repetir el turno ya leído", async () => {
  const times = ["09:00", "16:00"];
  assert.equal(lastSlot(times, new Date("2026-10-27T13:00:00Z"))?.toISOString(), "2026-10-26T21:00:00.000Z", "a las 8:00 de Colombia, el último turno fue ayer a las 16:00");
  assert.equal(lastSlot(times, new Date("2026-10-27T14:30:00Z"))?.toISOString(), "2026-10-27T14:00:00.000Z");
  await db.query("UPDATE google_connections SET last_sync_at = ? WHERE client_id = ?", [new Date("2026-10-27T14:10:00Z"), client]);
  assert.deepEqual(await dueSyncs(db, new Date("2026-10-27T15:00:00Z")), [], "ya se leyó en el turno de las 9:00");
  assert.deepEqual(await dueSyncs(db, new Date("2026-10-27T21:05:00Z")), [client], "pasó el turno de las 16:00");
});

test("el estado se reconoce por cómo empieza la celda; editar la bitácora dentro del mismo estado no avisa", async () => {
  const states = [{ value: "Pendiente de entrega", notify: false, text: "" }, { value: "Entregado", notify: true, text: "¡Hola {usuario}! Tu caso {caso} quedó resuelto 💙" }];
  assert.equal(stateOf("Pendiente de entrega, se solicitó al punto la fórmula", states)?.value, "Pendiente de entrega");
  assert.equal(stateOf("ENTREGADO, acetaminofén 500 mg", states)?.value, "Entregado");
  assert.equal(stateOf("Agendamiento", states), null);
  await setCases(db, client, { ...DEFAULT_CASES, origin: "dm_comentario", states });
  await person("bitacora.p", [{ kind: "dm", hoursAgo: 1 }]);
  sheet = [header, row("30", "bitacora.p", "Pendiente de entrega, se solicita al punto")];
  await syncSheet(db, client, reader, NOW);
  sheet = [header, row("30", "bitacora.p", "Pendiente de entrega, se solicitó al punto y se llamó")];
  assert.equal((await syncSheet(db, client, reader, NOW) as any).cambios, 0, "solo cambió la nota");
  sheet = [header, row("30", "bitacora.p", "ENTREGADO el 27/10")];
  assert.equal((await syncSheet(db, client, reader, NOW) as any).avisos, 1);
});
