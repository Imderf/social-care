import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { decryptToken } from "./crypto.ts";
import { findForbidden, listForbidden } from "./forbidden.ts";
import { GoogleError, readSpreadsheet, type SheetReader, type SheetTab } from "./google.ts";
import { maskPersonalData } from "./mask.ts";
import { MetaError, sendMessage } from "./meta.ts";

// Hoja de casos, fase A (decisiones de Imderf, 2026-10-27): la plataforma lee la Hoja que llena el
// equipo (2 veces al día por defecto) y, cuando el caso de una persona que escribió por DM (o por
// comentario o DM, según el cliente) pasa a un estado que avisa, le manda el resultado por DM:
// - dentro de 24 h desde su último mensaje, sale solo (texto fijo del estado, sin IA);
// - entre 24 h y 7 días, va a la Bandeja y lo envía una persona (Meta: etiqueta de agente humano);
// - después de 7 días, o si nunca escribió por DM, espera a que vuelva a escribir.
// Lo que ya estaba en la Hoja la primera vez que se lee no se avisa.

type Row = RowDataPacket & Record<string, any>;
export type CaseState = { value: string; notify: boolean; text: string };
export type CasesConfig = {
  origin: "dm" | "dm_comentario";
  tabs: string[]; // vacío: todas las pestañas
  columns: { caso: string; perfil: string; red: string; estado: string; resultado: string };
  states: CaseState[];
  times: string[]; // HH:MM, hora de Colombia
};

// Textos de aviso: borrador de Ogilvy hasta que Cafam los apruebe.
export const DEFAULT_CASES: CasesConfig = {
  origin: "dm_comentario",
  tabs: [],
  columns: { caso: "Caso", perfil: "Perfil", red: "Red social", estado: "Estado para el usuario", resultado: "Resultado" },
  states: [
    { value: "Pendiente", notify: false, text: "" },
    { value: "En gestión", notify: false, text: "" },
    { value: "Listo para reclamar", notify: true, text: "¡Hola {usuario}! 💙 Te contamos que tu caso {caso} ya está listo: {resultado}" },
    { value: "Entregado", notify: true, text: "¡Hola {usuario}! 💙 Tu caso {caso} quedó resuelto: {resultado}. Gracias por tu paciencia." },
    { value: "No procede", notify: true, text: "¡Hola {usuario}! Revisamos tu caso {caso}: {resultado}. Si tienes dudas, escríbenos por aquí 💙" },
  ],
  times: ["09:00", "16:00"],
};
export const ORIGINS = { dm_comentario: "Comentario o DM", dm: "Solo DM" } as const;
export const ORIGIN_TEXT = { dm_comentario: "comentario o DM", dm: "DM" } as const;
const VARS = ["usuario", "caso", "resultado"];

export async function getCases(db: Pool, clientId: number): Promise<CasesConfig> {
  const [[r]] = await db.query<Row[]>("SELECT JSON_EXTRACT(settings, '$.cases') AS v FROM clients WHERE id = ?", [clientId]);
  const v = typeof r?.v === "string" ? JSON.parse(r.v) : r?.v;
  return { ...DEFAULT_CASES, ...(v && typeof v === "object" ? v : {}) };
}

// Devuelve el problema, o null si guardó.
export async function setCases(db: Pool, clientId: number, v: CasesConfig) {
  if (!(v.origin in ORIGINS)) return "Elige de qué canales se siguen los casos.";
  if (!v.times.length || v.times.length > 4 || v.times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return "Pon de 1 a 4 horarios de lectura, como 09:00.";
  if (Object.values(v.columns).some((c) => !c.trim() || c.length > 80)) return "Escribe el nombre de cada columna tal como está en la Hoja.";
  if (!v.states.length || v.states.length > 15) return "Pon de 1 a 15 estados.";
  for (const s of v.states) {
    if (!s.value.trim() || s.value.length > 100) return "Cada estado lleva un nombre corto.";
    if (s.notify && !s.text.trim()) return `El estado «${s.value}» avisa: escribe el texto del aviso.`;
    const unknown = [...s.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).find((x) => !VARS.includes(x));
    if (unknown) return `«{${unknown}}» no existe. Las variables son {usuario}, {caso} y {resultado}.`;
    if (s.text.length > 1000) return "Un aviso tiene máximo 1.000 caracteres.";
  }
  await db.query("UPDATE clients SET settings = JSON_SET(settings, '$.cases', JSON_EXTRACT(?, '$')) WHERE id = ?", [JSON.stringify(v), clientId]);
  return null;
}

export const getConnection = async (db: Pool, clientId: number) =>
  (await db.query<Row[]>("SELECT * FROM google_connections WHERE client_id = ?", [clientId]))[0][0] ?? null;

const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

// Filas de una pestaña: la de títulos es la primera (de las 10 primeras) que tiene la columna del caso.
export function parseTab(tab: SheetTab, cols: CasesConfig["columns"]) {
  const head = tab.rows.slice(0, 10).findIndex((r) => r.some((c) => fold(c) === fold(cols.caso)));
  if (head < 0) return [];
  const at = (name: string) => tab.rows[head].findIndex((c) => fold(c) === fold(name));
  const i = { caso: at(cols.caso), perfil: at(cols.perfil), red: at(cols.red), estado: at(cols.estado), resultado: at(cols.resultado) };
  if (i.perfil < 0 || i.estado < 0) return [];
  return tab.rows
    .slice(head + 1)
    .map((r) => ({ caso: String(r[i.caso] ?? "").trim(), perfil: String(r[i.perfil] ?? "").trim(), red: i.red < 0 ? "" : String(r[i.red] ?? ""), estado: String(r[i.estado] ?? "").trim(), resultado: i.resultado < 0 ? "" : String(r[i.resultado] ?? "").trim() }))
    .filter((r) => r.caso && r.perfil);
}

// El estado se reconoce por cómo empieza el texto: «Pendiente de entrega» reconoce «Pendiente de
// entrega, se solicitó al punto…» (la Hoja de Cafam mezcla el estado con la bitácora). Gana el más largo.
export const stateOf = (text: string | null | undefined, states: CaseState[]) =>
  states.filter((s) => s.value && fold(text).startsWith(fold(s.value))).sort((a, b) => b.value.length - a.value.length)[0] ?? null;

const platformOf = (red: string) => (/insta|^ig$/i.test(red.trim()) ? "ig" : /face|^fb$|messenger/i.test(red.trim()) ? "fb" : null);

// La persona de la fila: mismo usuario (sin @, sin mayúsculas ni tildes), misma red si la fila la
// dice, y que haya escrito por los canales elegidos. Si no, la fila no es de un caso de redes.
async function matchContact(db: Pool, clientId: number, row: { perfil: string; red: string }, origin: CasesConfig["origin"]) {
  const platform = platformOf(row.red);
  const kinds = origin === "dm" ? ["dm"] : ["dm", "comentario"];
  const [[c]] = await db.query<Row[]>(
    `SELECT c.id FROM contacts c
     WHERE c.client_id = ? AND (? IS NULL OR c.platform = ?) AND TRIM(LEADING '@' FROM TRIM(c.username)) = ?
       AND EXISTS (SELECT 1 FROM interactions i WHERE i.contact_id = c.id AND i.client_id = c.client_id AND i.kind IN (?) AND NOT i.analysis_only)
     ORDER BY (SELECT MAX(received_at) FROM interactions i WHERE i.contact_id = c.id) DESC LIMIT 1`,
    [clientId, platform, platform, row.perfil.trim().replace(/^@/, ""), kinds],
  );
  return c ? Number(c.id) : null;
}

export async function syncSheet(db: Pool, clientId: number, read: SheetReader = readSpreadsheet, now = new Date()) {
  const conn = await getConnection(db, clientId);
  if (!conn?.spreadsheet_id) return null;
  const cfg = await getCases(db, clientId);
  const done = async (summary: string) => {
    await db.query("UPDATE google_connections SET last_sync_at = ?, last_sync_summary = ? WHERE client_id = ?", [now, summary.slice(0, 255), clientId]);
  };
  let tabs: SheetTab[];
  try {
    tabs = (await read(decryptToken(conn.refresh_token_encrypted), conn.spreadsheet_id, cfg.tabs)).tabs;
  } catch (e) {
    // Sin acceso (token revocado, Hoja borrada o ya no compartida): se intenta en el siguiente turno.
    const why = e instanceof GoogleError && (e.status === 401 || e.status === 403 || e.status === 400) ? "Sin acceso a la Hoja: vuelve a conectar Google o elige la Hoja otra vez." : `No se pudo leer la Hoja: ${(e as Error).message}`;
    await done(why);
    return { error: why };
  }
  const r = { leidas: 0, casos: 0, cambios: 0, avisos: 0 };
  for (const tab of tabs) {
    for (const row of parseTab(tab, cfg.columns)) {
      r.leidas++;
      const contactId = await matchContact(db, clientId, row, cfg.origin);
      if (!contactId) continue;
      r.casos++;
      const result = row.resultado ? maskPersonalData(row.resultado).slice(0, 1000) : null;
      const [[prev]] = await db.query<Row[]>("SELECT id, status FROM sheet_cases WHERE client_id = ? AND tab = ? AND case_number = ?", [clientId, tab.title, row.caso.slice(0, 50)]);
      if (!prev) {
        await db.query("INSERT INTO sheet_cases (client_id, tab, case_number, profile, contact_id, status, result) VALUES (?, ?, ?, ?, ?, ?, ?)", [
          clientId, tab.title.slice(0, 100), row.caso.slice(0, 50), row.perfil.slice(0, 255), contactId, row.estado.slice(0, 100) || null, result,
        ]);
        continue;
      }
      await db.query("UPDATE sheet_cases SET profile = ?, contact_id = ?, result = ? WHERE id = ?", [row.perfil.slice(0, 255), contactId, result, prev.id]);
      // Cambio = otro estado (o, si no es uno de los configurados, otro texto). Editar la nota de la
      // bitácora dentro del mismo estado no cuenta.
      const key = (t: string | null) => stateOf(t, cfg.states)?.value ?? fold(t);
      if (key(prev.status) === key(row.estado)) {
        await db.query("UPDATE sheet_cases SET status = ? WHERE id = ?", [row.estado.slice(0, 100) || null, prev.id]);
        continue;
      }
      r.cambios++;
      await db.query("UPDATE sheet_cases SET status = ?, status_changed_at = ? WHERE id = ?", [row.estado.slice(0, 100) || null, now, prev.id]);
      const state = stateOf(row.estado, cfg.states);
      if (state?.notify && (await createNotice(db, clientId, prev.id, state, { caso: row.caso, resultado: result ?? "" }, contactId, now))) r.avisos++;
    }
  }
  await done(`${r.casos} casos de ${ORIGIN_TEXT[cfg.origin]} (de ${r.leidas} filas) · ${r.cambios} cambios de estado · ${r.avisos} avisos`);
  return r;
}

const DAY = 864e5;

// Arma el aviso y decide por dónde sale. Devuelve false si ya existía (un aviso por caso y estado).
async function createNotice(db: Pool, clientId: number, caseId: number, state: CaseState, v: { caso: string; resultado: string }, contactId: number, now: Date) {
  const [[c]] = await db.query<Row[]>("SELECT platform, username FROM contacts WHERE id = ?", [contactId]);
  const name = String(c?.username ?? "").trim();
  const user = name ? (c.platform === "ig" ? `@${name.replace(/^@/, "")}` : name) : "";
  const text = state.text
    .replaceAll("{usuario}", user)
    .replaceAll("{caso}", v.caso)
    .replaceAll("{resultado}", v.resultado)
    .replace(/¡Hola\s+!/, "¡Hola!")
    .trim();
  // Sin resultado (el texto lo pide) o con palabras prohibidas: que lo revise una persona.
  const needsPerson = (state.text.includes("{resultado}") && !v.resultado) || findForbidden(text, await listForbidden(db, clientId)).length > 0;
  const [[dm]] = await db.query<Row[]>(
    `SELECT i.id, i.received_at, a.mode FROM interactions i JOIN accounts a ON a.id = i.account_id
     WHERE i.client_id = ? AND i.contact_id = ? AND i.kind = 'dm' AND NOT i.analysis_only ORDER BY i.received_at DESC LIMIT 1`,
    [clientId, contactId],
  );
  const age = dm ? now.getTime() - new Date(dm.received_at).getTime() : Infinity;
  const delivery = !dm ? "sin_dm" : age > 7 * DAY ? "esperando" : needsPerson || age > DAY || dm.mode !== "en_vivo" ? "bandeja" : "enviar";
  const why = needsPerson ? "Revisa el texto (falta el resultado o tiene palabras prohibidas) y envíalo."
    : dm?.mode !== "en_vivo" ? "La cuenta está en modo prueba: envíalo desde Meta."
    : "Envíalo tú: pasaron más de 24 h desde su último mensaje (Meta lo permite como agente humano hasta 7 días).";
  const [res] = await db.query<ResultSetHeader>(
    "INSERT IGNORE INTO case_notices (client_id, sheet_case_id, status, text, delivery, interaction_id) VALUES (?, ?, ?, ?, ?, ?)",
    [clientId, caseId, state.value.slice(0, 100), text, delivery, dm?.id ?? null],
  );
  if (!res.affectedRows) return false;
  await route(db, clientId, res.insertId, delivery, why);
  return true;
}

async function route(db: Pool, clientId: number, noticeId: number, delivery: string, why: string) {
  if (delivery === "enviar") {
    await db.query("INSERT INTO jobs (type, payload) VALUES ('notice_send', JSON_OBJECT('notice_id', ?))", [noticeId]);
  } else if (delivery === "bandeja") {
    const [[n]] = await db.query<Row[]>(
      "SELECT n.interaction_id, n.text, n.status, s.case_number FROM case_notices n JOIN sheet_cases s ON s.id = n.sheet_case_id WHERE n.id = ?",
      [noticeId],
    );
    const [e] = await db.query<ResultSetHeader>("INSERT INTO escalations (client_id, interaction_id, reason, priority, suggested_draft) VALUES (?, ?, ?, 'normal', ?)", [
      clientId, n.interaction_id, `Aviso del caso ${n.case_number}: ${n.status}. ${why}`.slice(0, 255), n.text,
    ]);
    await db.query("UPDATE case_notices SET escalation_id = ? WHERE id = ?", [e.insertId, noticeId]);
  }
}

// La persona volvió a escribir por DM: los avisos que esperaban salen por esta conversación.
export async function releaseWaitingNotices(db: Pool, clientId: number, contactId: number, interactionId: number) {
  const [rows] = await db.query<Row[]>(
    `SELECT n.id, a.mode FROM case_notices n JOIN sheet_cases s ON s.id = n.sheet_case_id JOIN interactions i ON i.id = ? JOIN accounts a ON a.id = i.account_id
     WHERE n.client_id = ? AND s.contact_id = ? AND n.delivery IN ('esperando', 'sin_dm')`,
    [interactionId, clientId, contactId],
  );
  for (const r of rows) {
    const delivery = r.mode === "en_vivo" ? "enviar" : "bandeja";
    await db.query("UPDATE case_notices SET delivery = ?, interaction_id = ? WHERE id = ?", [delivery, interactionId, r.id]);
    await route(db, clientId, r.id, delivery, "La cuenta está en modo prueba: envíalo desde Meta.");
  }
  return rows.length;
}

// Envía un aviso. Antes de llamar a Meta queda «enviando»: si Meta no contesta, no se repite solo.
// Pasadas 24 h desde el último mensaje de la persona (el más reciente, no el del aviso) va con la
// etiqueta de agente humano (solo cuando lo envía una persona desde la Bandeja).
export async function sendNotice(db: Pool, noticeId: number, meta = { sendMessage }, now = new Date()) {
  const [[n]] = await db.query<Row[]>(
    `SELECT n.id, n.text, n.escalation_id, a.page_id, a.meta_id AS account_meta_id, a.token_encrypted, a.mode, c.meta_user_id,
            (SELECT MAX(x.received_at) FROM interactions x WHERE x.contact_id = i.contact_id AND x.account_id = i.account_id AND x.kind = 'dm') AS received_at
     FROM case_notices n JOIN interactions i ON i.id = n.interaction_id JOIN accounts a ON a.id = i.account_id JOIN contacts c ON c.id = i.contact_id
     WHERE n.id = ?`,
    [noticeId],
  );
  if (!n) return null;
  const [claim] = await db.query<ResultSetHeader>("UPDATE case_notices SET delivery = 'enviando' WHERE id = ? AND delivery = 'enviar'", [noticeId]);
  if (!claim.affectedRows) return null;
  if (n.mode !== "en_vivo" || !n.token_encrypted) {
    await db.query("UPDATE case_notices SET delivery = 'fallido' WHERE id = ?", [noticeId]);
    throw new Error("La cuenta no está en asistido o no tiene token");
  }
  const tag = now.getTime() - new Date(n.received_at).getTime() > DAY && n.escalation_id ? "HUMAN_AGENT" : undefined;
  try {
    const mid = await meta.sendMessage(n.page_id ?? n.account_meta_id, n.meta_user_id, n.text, decryptToken(n.token_encrypted), tag);
    await db.query("UPDATE case_notices SET delivery = 'enviado', sent_at = ?, meta_response_id = ? WHERE id = ?", [now, mid, noticeId]);
    if (n.escalation_id) await db.query("UPDATE escalations SET resolved_at = COALESCE(resolved_at, ?) WHERE id = ?", [now, n.escalation_id]);
  } catch (e) {
    if (e instanceof MetaError) await db.query("UPDATE case_notices SET delivery = 'fallido' WHERE id = ?", [noticeId]);
    throw e;
  }
  return { sent: true, tag: tag ?? null };
}

// Desde la Bandeja: la persona envía (o corrige y envía) el aviso. Hasta 7 días desde el último
// mensaje; después Meta no deja escribirle y el aviso vuelve a esperar a que escriba.
export async function sendNoticeFromInbox(db: Pool, clientId: number, noticeId: number, text: string, now = new Date()) {
  const [[n]] = await db.query<Row[]>(
    "SELECT n.id, i.received_at FROM case_notices n JOIN interactions i ON i.id = n.interaction_id WHERE n.id = ? AND n.client_id = ? AND n.delivery IN ('bandeja', 'fallido')",
    [noticeId, clientId],
  );
  if (!n) return "El aviso ya se envió o no está pendiente.";
  if (now.getTime() - new Date(n.received_at).getTime() > 7 * DAY) return "Pasaron más de 7 días desde su último mensaje: Meta ya no deja escribirle. El aviso sale cuando vuelva a escribir.";
  await db.query("UPDATE case_notices SET text = ?, delivery = 'enviar' WHERE id = ?", [text, noticeId]);
  await db.query("INSERT INTO jobs (type, payload) VALUES ('notice_send', JSON_OBJECT('notice_id', ?))", [noticeId]);
  return null;
}

// Turno de lectura más reciente (hora de Colombia, UTC-5 sin horario de verano) que ya pasó.
export function lastSlot(times: string[], now = new Date()) {
  const bogota = new Date(now.getTime() - 5 * 3600e3);
  const slots = times.flatMap((t) => {
    const [h, m] = t.split(":").map(Number);
    return [0, 1].map((back) => Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate() - back, h, m) + 5 * 3600e3);
  });
  const past = slots.filter((s) => s <= now.getTime());
  return past.length ? new Date(Math.max(...past)) : null;
}

// Clientes con Hoja elegida que tienen una lectura pendiente (nunca leída o el último turno ya pasó).
export async function dueSyncs(db: Pool, now = new Date()) {
  const [rows] = await db.query<Row[]>(
    `SELECT g.client_id, g.last_sync_at, JSON_EXTRACT(c.settings, '$.cases.times') AS times FROM google_connections g JOIN clients c ON c.id = g.client_id
     WHERE g.spreadsheet_id IS NOT NULL AND c.archived_at IS NULL`,
  );
  return rows
    .filter((r) => {
      const times = (typeof r.times === "string" ? JSON.parse(r.times) : r.times) ?? DEFAULT_CASES.times;
      const slot = lastSlot(times, now);
      return !r.last_sync_at || (slot && new Date(r.last_sync_at) < slot);
    })
    .map((r) => Number(r.client_id));
}

// Para la pantalla: los casos que sigue la plataforma, con su persona y su último aviso.
export const listSheetCases = async (db: Pool, clientId: number, limit = 100) =>
  (
    await db.query<Row[]>(
      `SELECT s.id, s.tab, s.case_number, s.profile, s.status, s.result, s.status_changed_at, s.first_seen_at, s.contact_id, c.platform, c.username,
              n.status AS notice_status, n.delivery, n.sent_at, n.escalation_id
       FROM sheet_cases s LEFT JOIN contacts c ON c.id = s.contact_id
       LEFT JOIN case_notices n ON n.id = (SELECT MAX(id) FROM case_notices WHERE sheet_case_id = s.id)
       WHERE s.client_id = ? ORDER BY COALESCE(s.status_changed_at, s.first_seen_at) DESC LIMIT ?`,
      [clientId, limit],
    )
  )[0];
