import type { Pool, RowDataPacket } from "mysql2/promise";
import { ACCURACY_TARGET, MIN_VERIFIED, getAccuracyByType, saveVerification } from "./data.ts";
import { forbiddenError } from "./forbidden.ts";
import { cancelPending, enqueuePublish } from "./publish.ts";

// Aprendizaje por cliente. Mientras la cuenta está en asistido, una persona acepta, corrige o
// descarta cada borrador; eso es a la vez la verificación que mide el acierto y el ejemplo del que
// aprende la IA. Cada tipo de caso pasa a responder solo cuando se cumplen los días de aprendizaje
// y el acierto, y vuelve a pedir aprobación si el acierto baja.

type Row = RowDataPacket & Record<string, any>;
export const DEFAULT_LEARNING_DAYS = 7;

// Recalcula qué tipos responden solos. Devuelve los que cambiaron.
// ponytail: el acierto es el histórico del tipo; si hace falta frenar más rápido, usar las últimas N.
export async function refreshGraduation(db: Pool, clientId: number) {
  const [[c]] = await db.query<Row[]>(
    `SELECT COALESCE(JSON_EXTRACT(settings, '$.learning_days'), ?) AS days,
            (SELECT MIN(live_since) FROM accounts WHERE client_id = clients.id AND mode = 'en_vivo') AS since
     FROM clients WHERE id = ?`,
    [DEFAULT_LEARNING_DAYS, clientId],
  );
  if (!c) return [];
  const learned = !!c.since && Date.now() - new Date(c.since).getTime() >= Number(c.days) * 864e5;
  const changed: { id: number; name: string; live: boolean }[] = [];
  for (const t of await getAccuracyByType(db, clientId)) {
    const live = learned && t.verified >= MIN_VERIFIED && (t.accuracy ?? 0) >= ACCURACY_TARGET;
    const [r] = await db.query<any>("UPDATE case_types SET live_enabled = ? WHERE id = ? AND client_id = ? AND live_enabled <> ?", [live, t.id, clientId, live]);
    if (r.affectedRows) changed.push({ id: t.id, name: t.name, live });
  }
  return changed;
}

const DISCARDED = "La persona descartó el borrador de la IA";

// Lo que decide la persona sobre un borrador. Si cambió el texto, cuenta como corrección y lo
// corregido es lo que se publica. En asistido, aceptar publica y descartar lo deja en la bandeja.
export async function reviewProposal(db: Pool, clientId: number, interactionId: number, r: { text?: string | null; discard?: boolean; hide?: boolean; note?: string | null }) {
  const [[i]] = await db.query<Row[]>(
    `SELECT i.id, i.kind, i.decision, i.proposed_reply, i.ai_redrafts, (a.mode = 'en_vivo' AND i.answered_by IS NULL AND NOT i.analysis_only) AS can_publish
     FROM interactions i JOIN accounts a ON a.id = i.account_id
     WHERE i.id = ? AND i.client_id = ? AND i.decision IN ('responder', 'ocultar')`,
    [interactionId, clientId],
  );
  if (!i) return null;
  // Publica solo si la cuenta está en asistido y el mensaje no está respondido ni es solo de análisis.
  const live = !!Number(i.can_publish);

  // Ocultar en vez de lo que propuso la IA: si ella no propuso ocultar, se equivocó de decisión.
  if (r.hide && i.kind !== "dm") {
    await saveVerification(db, clientId, i.id, i.decision === "ocultar" ? "correcta" : "incorrecta", r.note ?? (i.decision === "ocultar" ? null : "La persona lo ocultó"));
    const published = live && (await enqueuePublish(db, clientId, i.id, "ocultar", null, "persona"));
    await refreshGraduation(db, clientId);
    return { verdict: i.decision === "ocultar" ? ("correcta" as const) : ("incorrecta" as const), published };
  }

  if (r.discard) {
    await saveVerification(db, clientId, i.id, "incorrecta", r.note ?? null);
    if (live) {
      await db.query(
        `INSERT INTO escalations (client_id, interaction_id, reason, priority)
         SELECT ?, ?, ?, 'normal' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM escalations WHERE interaction_id = ?)`,
        [clientId, i.id, DISCARDED, i.id],
      );
    }
    await refreshGraduation(db, clientId);
    return { verdict: "incorrecta" as const, published: false };
  }

  const text = i.decision === "responder" ? (r.text ?? i.proposed_reply ?? "").trim() : null;
  // Nada aprobado lleva palabras prohibidas: ni se publica ni le enseña a la IA.
  const banned = await forbiddenError(db, clientId, text);
  if (banned) return { verdict: null, published: false, error: banned };
  // Si hubo que pedirle otra propuesta a la IA, el primer borrador no servía: también es corrección.
  const corrected = i.decision === "responder" && (text !== (i.proposed_reply ?? "").trim() || i.ai_redrafts > 0);
  const verdict = corrected ? ("corregir" as const) : ("correcta" as const);
  await saveVerification(db, clientId, i.id, verdict, r.note ?? null);
  await db.query("UPDATE verifications SET corrected_reply = ? WHERE interaction_id = ? AND client_id = ?", [corrected ? text : null, i.id, clientId]);

  const published = live && !!(i.decision === "ocultar" || text)
    && (await enqueuePublish(db, clientId, i.id, i.decision === "ocultar" ? "ocultar" : i.kind === "dm" ? "dm" : "responder", text, "persona"));
  await refreshGraduation(db, clientId);
  return { verdict, published };
}

// Deshace una revisión mientras no se haya publicado: quita la verificación, el escalamiento que
// creó al descartar y la publicación que todavía esperaba su turno. Devuelve false si ya salió (o
// el worker ya la está publicando): retirarla de Meta es una acción humana, desde Meta.
export async function undoReview(db: Pool, clientId: number, interactionId: number) {
  if ((await cancelPending(db, clientId, interactionId)) === "publicada") return false;
  const [v] = await db.query<any>("DELETE FROM verifications WHERE interaction_id = ? AND client_id = ?", [interactionId, clientId]);
  await db.query("DELETE FROM escalations WHERE interaction_id = ? AND client_id = ? AND reason = ? AND resolved_at IS NULL", [interactionId, clientId, DISCARDED]);
  await refreshGraduation(db, clientId);
  return v.affectedRows > 0;
}

// Ejemplos de cómo responde este cliente, para que la IA los imite: primero las correcciones, luego
// las respuestas reales del equipo en Meta (del historial o del día a día) y al final lo aceptado sin
// cambios. Van sin el usuario ({usuario}). Los que el equipo quitó no van.
export type Example = { id: number; code: string; name: string; origin: "corregir" | "equipo" | "correcta"; at: Date; text: string; reply: string };

export async function learnedExamples(db: Pool, clientId: number, perType = 3): Promise<Example[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT i.id, v.verdict AS origin, v.created_at AS at, ct.code, ct.name, i.text_masked, COALESCE(v.corrected_reply, i.proposed_reply) AS reply,
            c.username, IF(v.verdict = 'corregir', 0, 2) AS rank_
     FROM verifications v JOIN interactions i ON i.id = v.interaction_id AND i.client_id = v.client_id
     JOIN case_types ct ON ct.id = i.case_type_id LEFT JOIN contacts c ON c.id = i.contact_id
     WHERE v.client_id = ? AND v.verdict IN ('correcta', 'corregir') AND i.decision = 'responder' AND NOT i.learning_excluded
       AND COALESCE(v.corrected_reply, i.proposed_reply) IS NOT NULL
     UNION ALL
     SELECT i.id, 'equipo', i.first_response_at, ct.code, ct.name, i.text_masked, i.human_reply, c.username, 1
     FROM interactions i JOIN case_types ct ON ct.id = i.case_type_id LEFT JOIN contacts c ON c.id = i.contact_id
     WHERE i.client_id = ? AND i.answered_by = 'persona' AND i.human_reply IS NOT NULL AND NOT i.learning_excluded
       AND NOT EXISTS (SELECT 1 FROM verifications v2 WHERE v2.interaction_id = i.id)
     ORDER BY rank_, at DESC LIMIT 120`,
    [clientId, clientId],
  );
  const count: Record<string, number> = {};
  return rows
    .filter((r) => (count[r.code] = (count[r.code] ?? 0) + 1) <= perType)
    .map((r) => ({ id: r.id, code: r.code, name: r.name, origin: r.origin, at: r.at, text: r.text_masked, reply: unfillUser(r.reply, r.username) }));
}

const unfillUser = (text: string, username: string | null) =>
  username ? text.replaceAll(`@${username}`, "{usuario}").replaceAll(username, "{usuario}") : text;

// Quitar un ejemplo: la IA deja de imitarlo. El acierto medido no cambia.
export async function excludeExample(db: Pool, clientId: number, interactionId: number) {
  await db.query("UPDATE interactions SET learning_excluded = TRUE WHERE id = ? AND client_id = ?", [interactionId, clientId]);
}

// Datos puntuales que el equipo escribió (al corregir o al responder en Meta) y que no están en la base ni en las plantillas:
// enlaces, horarios y direcciones. Se sugieren para guardarlos; guardarlos o descartarlos los quita.
const FINDERS: { topic: "enlace" | "horario" | "sede"; re: RegExp }[] = [
  { topic: "enlace", re: /https?:\/\/[^\s)]+/gi },
  { topic: "horario", re: /\b\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/gi },
  { topic: "sede", re: /\b(?:calle|cll|cl|carrera|cra|kr|avenida|av|diagonal|dg|transversal|tv)\.?\s*\d+[a-z]?\s*(?:bis)?\s*(?:#|no\.?|n°)\s*\d+[a-z]?\s*-\s*\d+/gi },
];

export async function knowledgeSuggestions(db: Pool, clientId: number) {
  const [rows] = await db.query<Row[]>(
    `SELECT i.id, COALESCE(v.corrected_reply, IF(i.answered_by = 'persona', i.human_reply, NULL)) AS corrected_reply, ct.name AS case_type, c.username
     FROM interactions i LEFT JOIN verifications v ON v.interaction_id = i.id
     LEFT JOIN case_types ct ON ct.id = i.case_type_id LEFT JOIN contacts c ON c.id = i.contact_id
     WHERE i.client_id = ? AND NOT i.kb_dismissed AND (v.corrected_reply IS NOT NULL OR (i.answered_by = 'persona' AND i.human_reply IS NOT NULL))
     ORDER BY COALESCE(v.created_at, i.first_response_at) DESC LIMIT 100`,
    [clientId],
  );
  if (!rows.length) return [];
  const [known] = await db.query<Row[]>(
    `SELECT body AS t FROM templates WHERE client_id = ? AND active
     UNION ALL SELECT CONCAT(title, ' ', content) FROM knowledge_items WHERE client_id = ? AND active`,
    [clientId, clientId],
  );
  const knownText = known.map((k) => k.t).join("\n").toLowerCase();
  const out: { id: number; topic: string; value: string; sentence: string; caseType: string | null }[] = [];
  for (const r of rows) {
    const text = unfillUser(r.corrected_reply, r.username);
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    for (const { topic, re } of FINDERS) {
      for (const value of text.match(re) ?? []) {
        if (knownText.includes(value.toLowerCase()) || out.some((o) => o.value.toLowerCase() === value.toLowerCase())) continue;
        out.push({ id: r.id, topic, value, sentence: (sentences.find((x) => x.includes(value)) ?? value).trim(), caseType: r.case_type });
      }
    }
  }
  return out;
}

export async function dismissSuggestion(db: Pool, clientId: number, interactionId: number) {
  await db.query("UPDATE interactions SET kb_dismissed = TRUE WHERE id = ? AND client_id = ?", [interactionId, clientId]);
}

// Días de aprendizaje del cliente y desde cuándo hay una cuenta en asistido.
export async function getLearning(db: Pool, clientId: number) {
  const [[r]] = await db.query<Row[]>(
    `SELECT COALESCE(JSON_EXTRACT(settings, '$.learning_days'), ?) AS days,
            (SELECT MIN(live_since) FROM accounts WHERE client_id = clients.id AND mode = 'en_vivo') AS since
     FROM clients WHERE id = ?`,
    [DEFAULT_LEARNING_DAYS, clientId],
  );
  return { days: Number(r?.days ?? DEFAULT_LEARNING_DAYS), since: (r?.since as Date | null) ?? null };
}

export async function setLearningDays(db: Pool, clientId: number, days: number) {
  await db.query("UPDATE clients SET settings = JSON_SET(settings, '$.learning_days', ?) WHERE id = ?", [days, clientId]);
  await refreshGraduation(db, clientId);
}

// Prueba ↔ asistido. Al entrar a asistido arranca el periodo de aprendizaje; al volver a prueba se
// reinicia, y los tipos que respondían solos vuelven a pedir aprobación.
export async function setAccountMode(db: Pool, clientId: number, accountId: number, mode: "prueba" | "en_vivo") {
  // Responder reseñas de Google todavía no existe: esas cuentas se quedan en prueba.
  if (mode === "en_vivo" && (await db.query<any[]>("SELECT 1 FROM accounts WHERE id = ? AND client_id = ? AND platform = 'gbp'", [accountId, clientId]))[0].length) return;
  await db.query(
    `UPDATE accounts SET mode = ?, live_since = IF(? = 'en_vivo', COALESCE(live_since, CURRENT_TIMESTAMP(3)), NULL)
     WHERE id = ? AND client_id = ?`,
    [mode, mode, accountId, clientId],
  );
  await refreshGraduation(db, clientId);
}
