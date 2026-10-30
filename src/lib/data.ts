import type { Pool, RowDataPacket } from "mysql2/promise";
import { type KnowledgeTopic, TOPICS } from "./flow.ts";

// Lecturas y escrituras del panel. Todas reciben clientId y filtran por él: MySQL no tiene RLS
// (la prueba de aislamiento está en tests/data.test.ts).

type Row = RowDataPacket & Record<string, any>;
const all = async (db: Pool, sql: string, params: unknown[]) => (await db.query<Row[]>(sql, params))[0];

export type Client = { id: number; name: string; is_demo: number };

// El administrador ve todos; las demás personas, solo los suyos (listClientsOf).
// Los del selector: sin los archivados.
export const listClients = async (db: Pool) =>
  (await all(db, "SELECT id, name, COALESCE(JSON_CONTAINS(settings, 'true', '$.demo'), 0) AS is_demo FROM clients WHERE archived_at IS NULL ORDER BY is_demo, id", [])) as Client[];

// Los clientes de una persona que no es administradora: solo los que se le asignaron (sin los archivados).
export const listClientsOf = async (db: Pool, userId: number) =>
  (await all(db, `SELECT c.id, c.name, COALESCE(JSON_CONTAINS(c.settings, 'true', '$.demo'), 0) AS is_demo
                  FROM clients c JOIN client_members m ON m.client_id = c.id AND m.user_id = ?
                  WHERE c.archived_at IS NULL ORDER BY is_demo, c.id`, [userId])) as Client[];

// Administración de clientes: todos, con sus cuentas y su configuración.
export const listAllClients = (db: Pool) =>
  all(db, `SELECT c.id, c.name, c.archived_at, c.created_at,
                  (SELECT COUNT(*) FROM accounts a WHERE a.client_id = c.id AND a.status = 'conectada') AS accounts,
                  (SELECT COUNT(*) FROM case_types t WHERE t.client_id = c.id AND t.active) AS case_types,
                  (SELECT COUNT(*) FROM templates t WHERE t.client_id = c.id AND t.active) AS templates,
                  (SELECT COUNT(*) FROM interactions i WHERE i.client_id = c.id) AS interactions
           FROM clients c ORDER BY c.archived_at IS NOT NULL, c.id`, []);

// Crea un cliente vacío o con la configuración de otro (matriz, plantillas vigentes y base de
// conocimiento). Los datos (interacciones, cuentas, aprendizaje) nunca se copian.
export async function createClient(db: Pool, name: string, copyFrom: number | null) {
  const [r] = await db.query<any>("INSERT INTO clients (name) VALUES (?)", [name]);
  const id = r.insertId as number;
  if (copyFrom) {
    const cols = "position, code, name, description, examples, autonomy, threshold, public_action, private_action, record_target, alert, flow, active, applies_to";
    await db.query(`INSERT INTO case_types (client_id, ${cols}) SELECT ?, ${cols} FROM case_types WHERE client_id = ?`, [id, copyFrom]);
    await db.query("INSERT INTO templates (client_id, code, name, channel, body, when_to_use, applies_to) SELECT ?, code, name, channel, body, when_to_use, applies_to FROM templates WHERE client_id = ? AND active", [id, copyFrom]);
    await db.query("INSERT INTO knowledge_items (client_id, topic, title, content, valid_until) SELECT ?, topic, title, content, valid_until FROM knowledge_items WHERE client_id = ? AND active", [id, copyFrom]);
    await db.query("INSERT INTO lists (client_id, kind, value, note) SELECT ?, kind, value, note FROM lists WHERE client_id = ?", [id, copyFrom]);
    // Los niveles de influencia también son configuración.
    const [[src]] = await db.query<any[]>("SELECT JSON_EXTRACT(settings, '$.influence') AS v FROM clients WHERE id = ?", [copyFrom]);
    if (src?.v) await db.query("UPDATE clients SET settings = JSON_SET(settings, '$.influence', JSON_EXTRACT(?, '$')) WHERE id = ?", [typeof src.v === "string" ? src.v : JSON.stringify(src.v), id]);
  }
  return id;
}

// Crear cliente desde el panel. Quien no es administrador solo copia la configuración de un cliente suyo y queda
// como miembro del nuevo (si no, no podría entrar en él ni verlo).
export async function createClientBy(db: Pool, who: { id: number; role: string }, name: string, copyFrom: number | null) {
  const admin = who.role === "admin";
  if (copyFrom && !admin) {
    const own = await all(db, "SELECT 1 FROM client_members WHERE user_id = ? AND client_id = ?", [who.id, copyFrom]);
    if (!own.length) copyFrom = null;
  }
  const id = await createClient(db, name, copyFrom);
  if (!admin) await db.query("INSERT INTO client_members (client_id, user_id, role) VALUES (?, ?, ?)", [id, who.id, who.role]);
  return id;
}

// Archivar saca al cliente del selector y desconecta sus cuentas (dejan de entrar mensajes);
// restaurar lo vuelve a mostrar. Las cuentas se reconectan desde Cuentas conectadas.
export async function setClientArchived(db: Pool, id: number, archived: boolean) {
  await db.query("UPDATE clients SET archived_at = IF(?, COALESCE(archived_at, CURRENT_TIMESTAMP(3)), NULL) WHERE id = ?", [archived, id]);
  if (archived) await db.query("UPDATE accounts SET status = 'desconectada', mode = 'prueba', live_since = NULL WHERE client_id = ?", [id]);
}

export async function getClient(db: Pool, id?: number) {
  const clients = await listClients(db);
  return clients.find((c) => c.id === id) ?? clients[0];
}

// Qué hizo (en vivo) o haría (en prueba) la IA con cada interacción.
export type Decision = "responder" | "escalar" | "ocultar";
export const DECISIONS: Decision[] = ["responder", "escalar", "ocultar"];
export const ACCURACY_TARGET = 0.9; // meta del plan para activar un tipo de caso
export const MIN_VERIFIED = 20; // verificaciones mínimas antes de juzgar la precisión

const DAY_MS = 864e5;
const CO_OFFSET_MS = 5 * 36e5; // Colombia, UTC-5 fijo
const dayKey = (d: Date) => new Date(d.getTime() - CO_OFFSET_MS).toISOString().slice(0, 10);

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// Métricas del resumen para los últimos `days` días, comparadas con los `days` anteriores.
export const SENTIMENTS = ["positivo", "neutral", "negativo"] as const;
type Sentiment = (typeof SENTIMENTS)[number];
const sentimentCounts = () => ({ positivo: 0, neutral: 0, negativo: 0, total: 0 });

// Lo que dice la gente: sentimiento por día, por canal y por tipo de pieza, y las publicaciones con
// más conversación. Incluye el historial importado, que se trae justo para esto.
export async function getInsights(db: Pool, clientId: number, days: number, now = new Date()) {
  const startToday = new Date(Date.parse(dayKey(now)) + CO_OFFSET_MS);
  const from = new Date(startToday.getTime() - (days - 1) * DAY_MS);
  const rows = await all(
    db,
    `SELECT i.received_at, i.sentiment, i.kind, a.platform, p.id AS post, p.type AS post_type, p.origin AS post_origin, p.permalink, p.caption
     FROM interactions i JOIN accounts a ON a.id = i.account_id
     LEFT JOIN posts p ON p.account_id = i.account_id AND p.meta_id = i.post_id
     WHERE i.client_id = ? AND i.received_at >= ?`,
    [clientId, from],
  );
  const add = (c: ReturnType<typeof sentimentCounts>, s: Sentiment | null) => {
    c.total++;
    if (s) c[s]++;
  };
  const daily = Array.from({ length: days }, (_, i) => ({ day: dayKey(new Date(from.getTime() + i * DAY_MS)), positivo: 0, neutral: 0, negativo: 0 }));
  const byDay = new Map(daily.map((x) => [x.day, x]));
  const totals = sentimentCounts();
  const channels = new Map<string, ReturnType<typeof sentimentCounts>>();
  const pieces = new Map<string, ReturnType<typeof sentimentCounts>>();
  const posts = new Map<number, { platform: string; type: string | null; origin: string | null; permalink: string | null; caption: string | null; counts: ReturnType<typeof sentimentCounts> }>();
  for (const r of rows) {
    const s = r.sentiment as Sentiment | null;
    add(totals, s);
    const dd = byDay.get(dayKey(r.received_at));
    if (dd && s) dd[s]++;
    const ch = `${r.platform}|${r.kind}`;
    add(channels.get(ch) ?? channels.set(ch, sentimentCounts()).get(ch)!, s);
    if (r.kind === "comentario") {
      const pt = r.post_type ?? "sin_dato";
      add(pieces.get(pt) ?? pieces.set(pt, sentimentCounts()).get(pt)!, s);
    }
    if (r.post) {
      const p = posts.get(r.post) ?? posts.set(r.post, { platform: r.platform, type: r.post_type, origin: r.post_origin, permalink: r.permalink, caption: r.caption, counts: sentimentCounts() }).get(r.post)!;
      add(p.counts, s);
    }
  }
  const sorted = <T extends { counts?: { total: number }; total?: number }>(list: T[]) => list.sort((x, y) => (y.counts?.total ?? y.total ?? 0) - (x.counts?.total ?? x.total ?? 0));
  return {
    daily,
    totals,
    unclassified: totals.total - totals.positivo - totals.neutral - totals.negativo,
    channels: sorted([...channels].map(([k, c]) => ({ platform: k.split("|")[0], kind: k.split("|")[1], ...c }))),
    pieces: sorted([...pieces].map(([type, c]) => ({ type, ...c }))),
    topPosts: sorted([...posts].map(([id, p]) => ({ id, ...p }))).slice(0, 8),
  };
}

export async function getDashboard(db: Pool, clientId: number, days: number, now = new Date()) {
  const startToday = new Date(Date.parse(dayKey(now)) + CO_OFFSET_MS);
  const from = new Date(startToday.getTime() - (days - 1) * DAY_MS);
  const prevFrom = new Date(from.getTime() - days * DAY_MS);

  const rows = await all(
    db,
    `SELECT i.received_at, i.first_response_at, i.answered_by, i.decision, i.kind, a.platform, ct.name AS case_type, v.verdict
     FROM interactions i
     JOIN accounts a ON a.id = i.account_id
     LEFT JOIN case_types ct ON ct.id = i.case_type_id
     LEFT JOIN verifications v ON v.interaction_id = i.id
     WHERE i.client_id = ? AND i.received_at >= ?`,
    [clientId, prevFrom],
  );
  const current = rows.filter((r) => r.received_at >= from);
  const previous = rows.filter((r) => r.received_at < from);

  const daily = Array.from({ length: days }, (_, i) => ({
    day: dayKey(new Date(from.getTime() + i * DAY_MS)),
    responder: 0,
    escalar: 0,
    ocultar: 0,
  }));
  const byDay = new Map(daily.map((d) => [d.day, d]));
  for (const r of current) {
    const d = byDay.get(dayKey(r.received_at));
    if (d && DECISIONS.includes(r.decision)) d[r.decision as Decision]++;
  }

  const totals = (list: Row[]) => {
    const t = { received: list.length, responder: 0, escalar: 0, ocultar: 0, verified: 0, correct: 0 };
    for (const r of list) {
      if (DECISIONS.includes(r.decision)) t[r.decision as Decision]++;
      if (r.verdict) t.verified++;
      if (r.verdict === "correcta") t.correct++;
    }
    return t;
  };

  const responseTimes = (list: Row[], by: "ia" | "persona") => {
    const secs = list
      .filter((r) => r.answered_by === by && r.first_response_at)
      .map((r) => (new Date(r.first_response_at).getTime() - new Date(r.received_at).getTime()) / 1000)
      .sort((a, b) => a - b);
    return { median: percentile(secs, 0.5), p90: percentile(secs, 0.9), count: secs.length };
  };

  const channels = { fb: 0, ig: 0, gbp: 0, comentario: 0, dm: 0, resena: 0 };
  for (const r of current) {
    channels[r.platform as "fb" | "ig" | "gbp"]++;
    channels[r.kind as "comentario" | "dm" | "resena"]++;
  }

  return {
    days,
    daily,
    current: totals(current),
    previous: totals(previous),
    team: responseTimes(current, "persona"),
    prevTeam: responseTimes(previous, "persona"),
    channels,
  };
}

// Precisión de las propuestas de la IA por tipo de caso, sobre todo lo verificado. Es lo que
// decide si un tipo está listo para responder de verdad.
export async function getAccuracyByType(db: Pool, clientId: number) {
  const rows = await all(
    db,
    `SELECT ct.id, ct.name, ct.autonomy, ct.live_enabled,
            COUNT(i.id) AS proposals,
            COUNT(v.id) AS verified,
            COALESCE(SUM(v.verdict = 'correcta'), 0) AS correct,
            COALESCE(SUM(v.verdict = 'corregir'), 0) AS fix,
            COALESCE(SUM(v.verdict = 'incorrecta'), 0) AS wrong
     FROM case_types ct
     LEFT JOIN interactions i ON i.case_type_id = ct.id AND i.client_id = ct.client_id AND i.decision IN ('responder', 'ocultar')
     LEFT JOIN verifications v ON v.interaction_id = i.id
     WHERE ct.client_id = ? AND ct.autonomy = 'automatica'
     GROUP BY ct.id
     ORDER BY proposals DESC, ct.position`,
    [clientId],
  );
  return rows.map((r) => {
    const verified = Number(r.verified);
    const correct = Number(r.correct);
    const accuracy = verified ? correct / verified : null;
    const status = r.live_enabled
      ? "activo"
      : verified < MIN_VERIFIED
        ? "faltan"
        : accuracy! >= ACCURACY_TARGET
          ? "listo"
          : "bajo";
    return { id: r.id, name: r.name as string, proposals: Number(r.proposals), verified, correct, fix: Number(r.fix), wrong: Number(r.wrong), accuracy, status };
  });
}

// "Hoy" en hora de Colombia (UTC-5 fijo, sin horario de verano).
const TODAY_CO = "DATE(NOW(3) - INTERVAL 5 HOUR) + INTERVAL 5 HOUR";

export async function getOverview(db: Pool, clientId: number) {
  const [[today], [open], [accounts], [config], [queue], [toVerify]] = await Promise.all([
    all(db, `SELECT COUNT(*) AS received FROM interactions WHERE client_id = ? AND received_at >= ${TODAY_CO}`, [clientId]),
    all(db, `SELECT COUNT(*) AS n, COALESCE(SUM(priority = 'critica'), 0) AS critical, MIN(created_at) AS oldest
             FROM escalations WHERE client_id = ? AND resolved_at IS NULL`, [clientId]),
    all(db, `SELECT COUNT(*) AS n, COALESCE(SUM(status = 'conectada'), 0) AS connected, COALESCE(SUM(mode = 'en_vivo'), 0) AS live,
                    MAX(last_webhook_at) AS last_webhook
             FROM accounts WHERE client_id = ?`, [clientId]),
    all(db, `SELECT (SELECT COUNT(*) FROM case_types WHERE client_id = ?) AS case_types,
                    (SELECT COUNT(*) FROM case_types WHERE client_id = ? AND autonomy = 'automatica') AS automatic,
                    (SELECT COUNT(*) FROM templates WHERE client_id = ?) AS templates,
                    (SELECT COUNT(*) FROM knowledge_items WHERE client_id = ?) AS knowledge`, [clientId, clientId, clientId, clientId]),
    // Infraestructura compartida (no es dato de un cliente).
    all(db, "SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'dead'), 0) AS dead FROM jobs", []),
    all(db, `SELECT COUNT(*) AS n FROM interactions i LEFT JOIN verifications v ON v.interaction_id = i.id
             WHERE i.client_id = ? AND i.decision IN ('responder', 'ocultar') AND v.id IS NULL AND (i.source = 'webhook' OR (NOT i.analysis_only AND i.answered_by IS NULL))`, [clientId]),
  ]);
  return {
    receivedToday: Number(today.received),
    openEscalations: Number(open.n),
    criticalEscalations: Number(open.critical),
    oldestEscalationAt: open.oldest as Date | null,
    accounts: Number(accounts.n),
    connectedAccounts: Number(accounts.connected),
    liveAccounts: Number(accounts.live),
    lastWebhookAt: accounts.last_webhook as Date | null,
    caseTypes: Number(config.case_types),
    automaticTypes: Number(config.automatic),
    templates: Number(config.templates),
    knowledge: Number(config.knowledge),
    queuePending: Number(queue.pending),
    queueDead: Number(queue.dead),
    toVerify: Number(toVerify.n),
  };
}

export const listCaseTypes = (db: Pool, clientId: number) =>
  all(db, "SELECT * FROM case_types WHERE client_id = ? ORDER BY position", [clientId]);

export const getCaseType = async (db: Pool, clientId: number, id: number) =>
  (await all(db, "SELECT * FROM case_types WHERE id = ? AND client_id = ?", [id, clientId]))[0] ?? null;

export const AUTONOMIES = ["automatica", "humana", "escala"] as const;
export type CaseTypeInput = {
  name: string; description: string | null; examples: string[]; autonomy: (typeof AUTONOMIES)[number]; threshold: number;
  public_action: string | null; private_action: string | null; record_target: string | null; alert: string | null; active: boolean;
  flow?: object | null; // lo elegido en el editor; los cuatro textos de arriba salen de aquí (src/lib/flow.ts)
};

// Clave estable del tipo de caso (la usa la IA): sale del nombre, sin tildes, y no se repite.
const slug = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "tipo";

// Crea (id = null) o edita un tipo de caso. Si deja de ser automático, deja de responder solo.
export async function saveCaseType(db: Pool, clientId: number, id: number | null, t: CaseTypeInput) {
  const values = [t.name, t.description, JSON.stringify(t.examples), t.autonomy, t.threshold, t.public_action, t.private_action, t.record_target, t.alert, t.active,
    t.flow ? JSON.stringify(t.flow) : null];
  if (id) {
    await db.query(
      `UPDATE case_types SET name = ?, description = ?, examples = ?, autonomy = ?, threshold = ?, public_action = ?, private_action = ?,
         record_target = ?, alert = ?, active = ?, flow = ?, live_enabled = IF(? = 'automatica', live_enabled, FALSE) WHERE id = ? AND client_id = ?`,
      [...values, t.autonomy, id, clientId],
    );
    return id;
  }
  const existing = await all(db, "SELECT code, position FROM case_types WHERE client_id = ?", [clientId]);
  const codes = new Set(existing.map((r) => r.code));
  let code = slug(t.name);
  for (let n = 2; codes.has(code); n++) code = `${slug(t.name)}_${n}`;
  const position = Math.max(0, ...existing.map((r) => Number(r.position))) + 1;
  const [r] = await db.query<any>(
    `INSERT INTO case_types (client_id, position, code, name, description, examples, autonomy, threshold, public_action, private_action, record_target, alert, active, flow)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [clientId, position, code, ...values],
  );
  return r.insertId as number;
}

export const listTemplates = (db: Pool, clientId: number) =>
  all(db, "SELECT * FROM templates WHERE client_id = ? AND active ORDER BY CAST(SUBSTRING(code, 2) AS UNSIGNED), code, channel DESC", [clientId]);

// Todas las versiones, para el historial y para las plantillas desactivadas.
export const listTemplateVersions = (db: Pool, clientId: number) =>
  all(db, "SELECT id, code, name, channel, body, when_to_use, version, active, updated_at FROM templates WHERE client_id = ? ORDER BY code, channel, version DESC", [clientId]);

// Editar una plantilla crea una versión nueva y desactiva la vigente: queda el historial de qué
// texto estaba activo cuando la IA respondió algo. Crear una nueva es lo mismo desde la versión 1.
export async function saveTemplate(db: Pool, clientId: number, t: { code: string; channel: "publico" | "dm"; name: string; body: string; whenToUse?: string | null }) {
  const [cur] = await all(db, "SELECT COALESCE(MAX(version), 0) AS v FROM templates WHERE client_id = ? AND code = ? AND channel = ?", [clientId, t.code, t.channel]);
  await db.query("UPDATE templates SET active = FALSE WHERE client_id = ? AND code = ? AND channel = ?", [clientId, t.code, t.channel]);
  await db.query("INSERT INTO templates (client_id, code, name, channel, body, when_to_use, version) VALUES (?, ?, ?, ?, ?, ?, ?)", [clientId, t.code, t.name, t.channel, t.body, t.whenToUse || null, Number(cur.v) + 1]);
}

// Activar deja vigente la última versión; desactivar saca la plantilla del uso sin borrarla.
export async function setTemplateActive(db: Pool, clientId: number, code: string, channel: string, active: boolean) {
  await db.query("UPDATE templates SET active = FALSE WHERE client_id = ? AND code = ? AND channel = ?", [clientId, code, channel]);
  if (active) {
    await db.query(
      `UPDATE templates SET active = TRUE WHERE client_id = ? AND code = ? AND channel = ?
       AND version = (SELECT v FROM (SELECT MAX(version) AS v FROM templates WHERE client_id = ? AND code = ? AND channel = ?) m)`,
      [clientId, code, channel, clientId, code, channel],
    );
  }
}

// Lo que llegó en los últimos días y no se pudo responder con una plantilla o con la base: preguntas
// abiertas, datos que faltan o mensajes sin tipo de caso. Para que el equipo vea qué plantillas crear.
export async function listUncovered(db: Pool, clientId: number, days = 30) {
  const rows = await all(
    db,
    `SELECT COALESCE(ct.name, 'Sin tipo de caso') AS case_type, i.text_masked, i.received_at
     FROM escalations e JOIN interactions i ON i.id = e.interaction_id AND i.client_id = e.client_id
     LEFT JOIN case_types ct ON ct.id = i.case_type_id
     WHERE e.client_id = ? AND e.created_at >= NOW() - INTERVAL ? DAY
       AND (e.reason LIKE '%no sale completa de una plantilla%' OR e.reason LIKE '%Pregunta abierta%' OR e.reason LIKE 'La IA no lo pudo clasificar%' OR ct.code = 'no_encaja')
     ORDER BY i.received_at DESC LIMIT 300`,
    [clientId, days],
  );
  const groups = new Map<string, { caseType: string; count: number; examples: string[] }>();
  for (const r of rows) {
    const g = groups.get(r.case_type) ?? groups.set(r.case_type, { caseType: r.case_type, count: 0, examples: [] }).get(r.case_type)!;
    g.count++;
    if (g.examples.length < 2 && r.text_masked) g.examples.push(r.text_masked);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 8);
}

export const listKnowledge = (db: Pool, clientId: number) =>
  all(db, "SELECT * FROM knowledge_items WHERE client_id = ? AND active ORDER BY topic, title", [clientId]);

export const KNOWLEDGE_TOPICS = Object.keys(TOPICS) as KnowledgeTopic[];
export type { KnowledgeTopic };

export async function addKnowledge(db: Pool, clientId: number, k: { topic: KnowledgeTopic; title: string; content: string; validUntil?: string | null }) {
  await db.query("INSERT INTO knowledge_items (client_id, topic, title, content, valid_until) VALUES (?, ?, ?, ?, ?)", [
    clientId, k.topic, k.title, k.content, k.validUntil || null,
  ]);
}

// Se desactiva en vez de borrar: queda el registro de qué sabía la IA y cuándo.
export async function removeKnowledge(db: Pool, clientId: number, id: number) {
  await db.query("UPDATE knowledge_items SET active = FALSE WHERE id = ? AND client_id = ?", [id, clientId]);
}

export const listAccounts = (db: Pool, clientId: number) =>
  all(db, "SELECT id, platform, meta_id, name, status, mode, last_webhook_at, backfilled_at, created_at, user_token_encrypted IS NOT NULL AS has_user_token FROM accounts WHERE client_id = ? ORDER BY platform, name", [clientId]);

// Desconectar: deja de recibir y de publicar en esa cuenta; lo que ya llegó se queda. Se vuelve a
// conectar con «Conectar con Facebook», que también sirve para actualizar permisos sin desconectar.
export const disconnectAccount = (db: Pool, clientId: number, id: number) =>
  db.query("UPDATE accounts SET status = 'desconectada' WHERE id = ? AND client_id = ?", [id, clientId]);

export const listOpenEscalations = (db: Pool, clientId: number) =>
  all(db, `SELECT e.id, e.reason, e.priority, e.suggested_draft, e.created_at, i.id AS interaction_id, i.contact_id, i.kind, i.rating,
                  i.text_masked, i.permalink, i.window_expires_at, i.confidence, i.mode, i.proposed_reply, i.analysis_only, a.platform,
                  a.mode AS account_mode, a.name AS account, ct.name AS case_type, ct.public_action, c.username, c.followers, c.verified, c.account_type, c.bio,
                  IF(n.id IS NULL, x.type, 'dm') AS action_type, IF(n.id IS NULL, x.status, IF(n.delivery IN ('enviar', 'enviando'), 'pendiente', NULL)) AS action_status,
                  po.origin AS post_origin, n.id AS notice_id
           FROM escalations e
           JOIN interactions i ON i.id = e.interaction_id AND i.client_id = e.client_id
           JOIN accounts a ON a.id = i.account_id
           LEFT JOIN posts po ON po.account_id = i.account_id AND po.meta_id = i.post_id
           LEFT JOIN actions x ON x.interaction_id = i.id AND x.type IN ('responder', 'ocultar', 'dm')
           LEFT JOIN case_notices n ON n.escalation_id = e.id
           LEFT JOIN case_types ct ON ct.id = i.case_type_id
           LEFT JOIN contacts c ON c.id = i.contact_id
           WHERE e.client_id = ? AND e.resolved_at IS NULL
           ORDER BY FIELD(e.priority, 'critica', 'alta', 'normal'), e.created_at`, [clientId]);

// Otras interacciones del mismo usuario, con lo que la IA propuso y lo que respondió el equipo.
export const listContactHistory = (db: Pool, clientId: number, contactId: number, excludeId: number, limit = 6) =>
  all(db, `SELECT i.id, i.kind, i.rating, i.text_masked, i.decision, i.mode, i.proposed_reply, i.proposed_template, i.human_reply,
                  i.answered_by, i.received_at, a.platform, ct.name AS case_type, v.verdict,
                  (SELECT x.status FROM actions x WHERE x.interaction_id = i.id AND x.type = 'ocultar' ORDER BY x.id DESC LIMIT 1) AS hide_status
           FROM interactions i
           JOIN accounts a ON a.id = i.account_id
           LEFT JOIN case_types ct ON ct.id = i.case_type_id
           LEFT JOIN verifications v ON v.interaction_id = i.id
           WHERE i.client_id = ? AND i.contact_id = ? AND i.id <> ?
           ORDER BY i.received_at DESC LIMIT ?`, [clientId, contactId, excludeId, limit]);

// Personas que han escrito: comentarios y DM agrupados por usuario de Meta, la más reciente primero.
// Los comentarios del historial que Meta entrega sin autor (sin_id:) no se pueden agrupar y no entran.
export const listContacts = (db: Pool, clientId: number, search = "", limit = 100) =>
  all(db, `SELECT c.id, c.platform, c.username, c.followers, c.verified, c.account_type, COUNT(*) AS total,
                  SUM(i.kind = 'comentario') AS comments, SUM(i.kind = 'dm') AS dms, SUM(i.answered_by IS NOT NULL) AS answered,
                  SUM(i.sentiment = 'positivo') AS positivo, SUM(i.sentiment = 'neutral') AS neutral, SUM(i.sentiment = 'negativo') AS negativo,
                  MIN(i.received_at) AS first_at, MAX(i.received_at) AS last_at,
                  (SELECT COUNT(*) FROM escalations e JOIN interactions x ON x.id = e.interaction_id
                   WHERE x.contact_id = c.id AND e.resolved_at IS NULL) AS open_cases
           FROM contacts c JOIN interactions i ON i.contact_id = c.id
           WHERE c.client_id = ? AND c.meta_user_id NOT LIKE 'sin\\_id:%' AND (? = '' OR c.username LIKE ?)
           GROUP BY c.id ORDER BY last_at DESC LIMIT ?`, [clientId, search, `%${search}%`, limit]);

export const countUnidentified = async (db: Pool, clientId: number) =>
  Number((await all(db, `SELECT COUNT(*) AS n FROM interactions i JOIN contacts c ON c.id = i.contact_id
                         WHERE i.client_id = ? AND c.meta_user_id LIKE 'sin\\_id:%'`, [clientId]))[0].n);

export const getContact = async (db: Pool, clientId: number, id: number) =>
  (await all(db, "SELECT id, platform, username, followers, verified, account_type, bio, profile_checked_at, created_at FROM contacts WHERE client_id = ? AND id = ?", [clientId, id]))[0];

// Todo lo que una persona ha escrito a las cuentas del cliente, comentarios y DM, con lo que hizo la
// IA, lo que respondió el equipo, la publicación donde comentó y su caso en la bandeja.
export const listContactTimeline = (db: Pool, clientId: number, contactId: number, limit = 300) =>
  all(db, `SELECT i.id, i.kind, i.rating, i.text_masked, i.decision, i.mode, i.proposed_reply, i.proposed_template, i.human_reply,
                  i.answered_by, i.confidence, i.sentiment, i.received_at, i.first_response_at, i.permalink, i.analysis_only,
                  a.platform, a.name AS account, ct.name AS case_type, v.verdict,
                  p.caption AS post_caption, p.permalink AS post_permalink, p.type AS post_type, p.origin AS post_origin,
                  (SELECT e.id FROM escalations e WHERE e.interaction_id = i.id ORDER BY e.id DESC LIMIT 1) AS escalation_id,
                  (SELECT e.priority FROM escalations e WHERE e.interaction_id = i.id ORDER BY e.id DESC LIMIT 1) AS priority,
                  (SELECT e.resolved_at IS NULL FROM escalations e WHERE e.interaction_id = i.id ORDER BY e.id DESC LIMIT 1) AS open_case,
                  (SELECT x.status FROM actions x WHERE x.interaction_id = i.id AND x.type = 'ocultar' ORDER BY x.id DESC LIMIT 1) AS hide_status
           FROM interactions i
           JOIN accounts a ON a.id = i.account_id
           LEFT JOIN case_types ct ON ct.id = i.case_type_id
           LEFT JOIN verifications v ON v.interaction_id = i.id
           LEFT JOIN posts p ON p.account_id = i.account_id AND p.meta_id = i.post_id
           WHERE i.client_id = ? AND i.contact_id = ?
           ORDER BY i.received_at DESC LIMIT ?`, [clientId, contactId, limit]);

export const INTERACTION_FILTERS = {
  todas: "1 = 1",
  responder: "i.decision = 'responder'",
  escalar: "i.decision = 'escalar'",
  ocultar: "i.decision = 'ocultar'",
  sin_respuesta: "i.answered_by IS NULL AND (i.decision IS NULL OR i.decision <> 'ocultar')",
  // El registro de lo que publicó la plataforma (la IA sola o una persona aceptando su borrador) y lo que respondió el equipo.
  ia: "i.answered_by = 'ia'",
  equipo: "i.answered_by = 'persona'",
} as const;

export const listInteractions = (db: Pool, clientId: number, filter: keyof typeof INTERACTION_FILTERS = "todas", search = "", limit = 100) =>
  all(db, `SELECT i.id, i.kind, i.rating, i.text_masked, i.decision, i.mode, i.proposed_reply, i.proposed_template, i.human_reply,
                  i.answered_by, i.confidence, i.received_at, i.first_response_at, i.permalink, a.platform,
                  ct.name AS case_type, c.username, IF(c.meta_user_id LIKE 'sin\\_id:%', NULL, c.id) AS contact_id, v.verdict, po.origin AS post_origin,
                  (SELECT x.status FROM actions x WHERE x.interaction_id = i.id AND x.type = 'ocultar' ORDER BY x.id DESC LIMIT 1) AS hide_status
           FROM interactions i
           JOIN accounts a ON a.id = i.account_id
           LEFT JOIN case_types ct ON ct.id = i.case_type_id
           LEFT JOIN contacts c ON c.id = i.contact_id
           LEFT JOIN verifications v ON v.interaction_id = i.id
           LEFT JOIN posts po ON po.account_id = i.account_id AND po.meta_id = i.post_id
           WHERE i.client_id = ? AND ${INTERACTION_FILTERS[filter]}
             AND (? = '' OR i.text_masked LIKE ? OR c.username LIKE ?)
           ORDER BY i.received_at DESC LIMIT ?`, [clientId, search, `%${search}%`, `%${search}%`, limit]);

// Propuestas de la IA para verificar: respuestas y ocultamientos que haría.
export const PROPOSAL_FILTERS = {
  // Lo recién revisado se queda unos minutos para poder ver qué pasó y deshacerlo. Del historial
  // solo entra lo que todavía se puede responder.
  pendientes: "(v.id IS NULL OR v.created_at > NOW(3) - INTERVAL 10 MINUTE) AND (i.source = 'webhook' OR (NOT i.analysis_only AND i.answered_by IS NULL))",
  // Historial que el equipo ya respondió: para comparar la propuesta con la respuesta real.
  historial: "v.id IS NULL AND i.source = 'historial' AND i.answered_by = 'persona'",
  verificadas: "v.id IS NOT NULL",
  todas: "NOT (i.analysis_only AND i.answered_by IS NULL)",
} as const;

export const listProposals = (db: Pool, clientId: number, filter: keyof typeof PROPOSAL_FILTERS = "pendientes", limit = 40) =>
  all(db, `SELECT i.id, i.kind, i.rating, i.text_masked, i.decision, i.mode, i.proposed_reply, i.proposed_template, i.ai_redrafts, i.human_reply,
                  i.answered_by, i.confidence, i.received_at, i.first_response_at, a.platform, ct.name AS case_type,
                  ct.public_action, ct.private_action, c.username, v.verdict, v.note, v.corrected_reply, a.mode AS account_mode, x.status AS action_status, i.source,
                  (a.mode = 'en_vivo' AND i.answered_by IS NULL AND NOT i.analysis_only) AS can_publish
           FROM interactions i
           JOIN accounts a ON a.id = i.account_id
           LEFT JOIN case_types ct ON ct.id = i.case_type_id
           LEFT JOIN contacts c ON c.id = i.contact_id
           LEFT JOIN verifications v ON v.interaction_id = i.id
           LEFT JOIN actions x ON x.interaction_id = i.id AND x.type IN ('responder', 'ocultar', 'dm')
           WHERE i.client_id = ? AND i.decision IN ('responder', 'ocultar') AND ${PROPOSAL_FILTERS[filter]}
           ORDER BY i.received_at DESC LIMIT ?`, [clientId, limit]);

export type Verdict = "correcta" | "corregir" | "incorrecta";
export const VERDICTS: Verdict[] = ["correcta", "corregir", "incorrecta"];

// Guarda o reemplaza la verificación. El SELECT asegura que la interacción sea del cliente:
// si no lo es, no inserta nada. Devuelve si guardó.
export async function saveVerification(db: Pool, clientId: number, interactionId: number, verdict: Verdict, note: string | null) {
  const [res] = await db.query<any>(
    `INSERT INTO verifications (client_id, interaction_id, verdict, note)
     SELECT client_id, id, ?, ? FROM interactions WHERE id = ? AND client_id = ?
     ON DUPLICATE KEY UPDATE verdict = VALUES(verdict), note = VALUES(note), created_at = CURRENT_TIMESTAMP(3)`,
    [verdict, note, interactionId, clientId],
  );
  return res.affectedRows > 0;
}

// Guarda una página o un Instagram conectado. Una cuenta pertenece a un solo cliente: si ya está
// conectada a otro, no se toca. Al reconectar se conserva el modo (prueba o asistido).
export async function saveConnectedAccount(
  db: Pool,
  clientId: number,
  a: { platform: "fb" | "ig"; metaId: string; pageId: string; name: string; tokenEncrypted: string; userTokenEncrypted?: string | null },
) {
  const [existing] = await all(db, "SELECT id, client_id, status FROM accounts WHERE platform = ? AND meta_id = ?", [a.platform, a.metaId]);
  // Conectada a otro cliente: no se toca. Desconectada (por ejemplo, de un cliente archivado): pasa a
  // este cliente en modo prueba; lo que ya había recibido se queda con el cliente anterior.
  if (existing && existing.client_id !== clientId && existing.status !== "desconectada") return "otro_cliente" as const;
  if (existing) {
    await db.query(
      // MySQL asigna de izquierda a derecha: modo y live_since se calculan antes de cambiar el cliente.
      `UPDATE accounts SET mode = IF(client_id = ?, mode, 'prueba'), live_since = IF(client_id = ?, live_since, NULL),
         client_id = ?, name = ?, page_id = ?, token_encrypted = ?, user_token_encrypted = COALESCE(?, user_token_encrypted), status = 'conectada' WHERE id = ?`,
      [clientId, clientId, clientId, a.name, a.pageId, a.tokenEncrypted, a.userTokenEncrypted ?? null, existing.id],
    );
  } else {
    await db.query("INSERT INTO accounts (client_id, platform, meta_id, page_id, name, token_encrypted, user_token_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      clientId, a.platform, a.metaId, a.pageId, a.name, a.tokenEncrypted, a.userTokenEncrypted ?? null,
    ]);
  }
  return "ok" as const;
}
