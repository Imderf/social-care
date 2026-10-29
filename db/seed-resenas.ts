// Matriz y plantillas de reseñas de Google para un cliente (v1, borrador de Ogilvy 2026-10-29, por revisar con Cafam).
// Se pueden correr varias veces: actualiza por código. Uso: npm run db:seed:resenas -- <id del cliente>
import mysql from "mysql2/promise";

type Q = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type CaseType = [code: string, name: string, autonomy: "automatica" | "humana" | "escala", action: string, description: string, examples?: string[]];

export const REVIEW_TYPES: CaseType[] = [
  ["resena_positiva", "Reseña positiva con comentario", "automatica", "R1 o R2: agradecer y, si hace falta, responder a lo que dijo", "4 o 5 estrellas con un comentario amable, sin queja ni pregunta.", ["Excelente atención, me entregaron todo rápido", "Muy buen servicio, gracias"]],
  ["resena_sin_texto", "Reseña solo con estrellas", "automatica", "R3, R4 o R5, rotando", "4 o 5 estrellas sin comentario."],
  ["resena_neutra", "Reseña de 3 estrellas o con una sugerencia", "humana", "R6", "Opinión mixta, sin queja grave: algo estuvo bien y algo se puede mejorar.", ["Buen servicio pero se demoraron un poco"]],
  ["resena_queja", "Reseña negativa o con una queja", "humana", "R7", "1 a 3 estrellas con una queja por la atención, el tiempo de espera, la entrega o el servicio.", ["Me hicieron esperar más de una hora y no me dieron solución"]],
  ["resena_critica", "Reseña con riesgo (salud, legal, insulto, datos)", "escala", "Nada automático", "Menciona un problema de salud, una tutela o denuncia, insultos, datos personales o a un medio de comunicación."],
  ["resena_no_encaja", "Reseña que no encaja o con baja confianza", "escala", "Nada automático", "No encaja en ningún tipo o la IA no está segura."],
];

type Template = [code: string, name: string, body: string, whenToUse: string];

export const REVIEW_TEMPLATES: Template[] = [
  ["R1", "Agradecimiento a una reseña positiva", "¡Hola {nombre}! Gracias por tomarte el tiempo de contarnos tu experiencia. 💙 Nos alegra mucho que hayas tenido una buena atención. ¡Te esperamos pronto!", "La reseña es positiva y habla de la atención o el servicio."],
  ["R2", "Agradecimiento a una reseña positiva (variante)", "¡Hola {nombre}! Qué bueno leer tus palabras: nos motivan a seguir mejorando cada día. 💙 Gracias por elegirnos.", "La reseña es positiva y habla de la experiencia en general."],
  ["R3", "Gracias por calificar", "¡Hola {nombre}! Gracias por calificarnos. 💙 Nos alegra mucho que tu experiencia haya sido buena. ¡Te esperamos pronto!", "Reseña solo con estrellas."],
  ["R4", "Gracias por calificar (variante)", "¡Hola {nombre}! Gracias por tu calificación, es muy valiosa para nosotros. 💙 Aquí estaremos cuando nos necesites.", "Reseña solo con estrellas."],
  ["R5", "Gracias por calificar (variante)", "¡Hola {nombre}! Muchas gracias por tu calificación. 💙 Seguimos trabajando para atenderte cada vez mejor.", "Reseña solo con estrellas."],
  ["R6", "Opinión mixta o sugerencia", "¡Hola {nombre}! Gracias por compartirnos tu opinión. 💙 Tomamos nota de lo que nos cuentas para seguir mejorando nuestro servicio.", "La reseña tiene algo bueno y algo por mejorar, o trae una sugerencia."],
  ["R7", "Reseña con una queja", "¡Hola {nombre}! Lamentamos que tu experiencia no haya sido la mejor. 💙 Tu opinión es importante y la compartimos con el equipo de la sede para revisar lo que pasó. Gracias por contárnoslo.", "La reseña es negativa o trae una queja por el servicio."],
];

export async function seedReviewConfig(db: Q, clientId: number) {
  for (const [i, [code, name, autonomy, action, description, examples = []]] of REVIEW_TYPES.entries()) {
    await db.query(
      `INSERT INTO case_types (client_id, position, code, name, description, examples, autonomy, public_action, applies_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'resenas')
       ON DUPLICATE KEY UPDATE position = VALUES(position), name = VALUES(name), description = VALUES(description), examples = VALUES(examples),
         autonomy = VALUES(autonomy), public_action = VALUES(public_action), applies_to = 'resenas'`,
      [clientId, 100 + i, code, name, description, JSON.stringify(examples), autonomy, action],
    );
  }
  for (const [code, name, body, whenToUse] of REVIEW_TEMPLATES) {
    await db.query(
      `INSERT INTO templates (client_id, code, name, channel, body, when_to_use, applies_to) VALUES (?, ?, ?, 'publico', ?, ?, 'resenas')
       ON DUPLICATE KEY UPDATE name = VALUES(name), body = VALUES(body), when_to_use = VALUES(when_to_use), applies_to = 'resenas'`,
      [clientId, code, name, body, whenToUse],
    );
  }
}

if (import.meta.main) {
  const clientId = Number(process.argv[2]);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    console.error("Uso: npm run db:seed:resenas -- <id del cliente>");
    process.exit(1);
  }
  const conn = await mysql.createConnection(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/social_care");
  await seedReviewConfig(conn as unknown as Q, clientId);
  console.log(`Matriz y plantillas de reseñas listas para el cliente ${clientId}.`);
  await conn.end();
}
