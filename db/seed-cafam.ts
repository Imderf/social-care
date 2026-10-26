// Configuración inicial de Droguerías Cafam: matriz v1, plantillas P1–P9 de Luna y enlaces conocidos.
// Fuente: plan y plantillas del vault (2026-10-15). Se puede correr varias veces: actualiza por código.
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

type CaseType = [code: string, name: string, autonomy: "automatica" | "humana" | "escala", pub: string | null, priv: string | null, record: string | null, alert: string | null, examples?: string[], description?: string];

export const CASE_TYPES: CaseType[] = [
  ["pendiente_entrega", "Medicamento pendiente o no entregado", "automatica", "P6 pública", "P6 DM: contexto + autorización + solicitud (único mensaje hasta que conteste). Luego datos faltantes y fórmulas", "Hoja del mes (o Meta si es Villavicencio) + soportes", "Prioridad si hay salud crítica",
    ["Es lo peor que pudo hacer Sanitas, nosotros los usuarios somos los perjudicados, no entregan medicamentos porque dicen que no los tienen"]],
  ["envia_datos", "El usuario envía sus datos", "automatica", null, "P7. Si faltan datos, los pide. Foto de ver una vez: pide foto normal", "Fila nueva en la Hoja, con número de caso", null],
  ["citas", "Citas o agendamiento", "automatica", "P5 pública", "P5 DM (en el Meta, con enlace de agendamiento)", "Hoja del mes, tipo agendamiento", null,
    ["Nunca hay citas en la plataforma, un mes para poder ir a reclamar mis medicamentos. Es absurdo.", "Tengo cita el 12 de octubre y es festivo, ¿atienden?"]],
  ["caso_abierto", "Vuelve a escribir con caso abierto", "automatica", "Contención", "Estado del caso desde la Hoja o plantilla de seguimiento", "Nota fechada en el caso", "Si el caso sigue abierto después del plazo acordado"],
  ["puntos_dispensacion", "Puntos de dispensación (general / Meta)", "automatica", "P11 / P3 / P2 + datos de la base (puntos de dispensación por ciudad)", null, null, null, ["¿Dónde reclamo mis medicamentos?", "¿Cuál es el punto de dispensación en Palmira?", "¿Dónde entregan los medicamentos de Sanitas en Villavicencio?"], "Pregunta dónde reclamar sus medicamentos o por los puntos de dispensación. La respuesta depende de la ciudad"],
  ["horarios_sedes", "Horarios, sedes, festivos", "automatica", "Pública con datos de la base (sedes, horarios, festivos y enlaces)", null, null, "Si no está en la base", ["¿Hay sede en el sur para prepagada?"]],
  ["domicilios", "Domicilios", "automatica", "P1 / P10 + datos de la base (domicilios y cobertura)", null, null, null, ["¿Tienen domicilios?", "¿Me pueden llevar la fórmula a la casa?", "¿Hacen domicilio en Cali?"], "Pregunta si hay domicilio: de los medicamentos que entrega la EPS (dispensación) o de una compra. La respuesta depende de cuál es y de la ciudad"],
  ["otra_persona_reclama", "Otra persona reclama", "automatica", "P4", null, null, null],
  ["precio_producto", "Precio o producto", "automatica", "P9", null, null, null],
  ["empleo", "Empleo / hoja de vida", "automatica", "P8", null, null, null],
  ["positivo_emoji", "Positivo, agradecimiento o solo emoji", "automatica", "Respuesta corta con 💙; me gusta en Facebook", null, null, null, ["💙", "👍", "¡Gracias por la atención!"], "Un corazón, un 👍 u otro emoji en la caja de comentarios también recibe respuesta. Las reacciones a la publicación no."],
  ["queja_insulto", "Queja con insulto", "automatica", "Plantilla del caso de fondo, tono firme y cordial", "Igual al caso de fondo", "Según el caso de fondo", "Amenaza o insulto grave (se oculta y pasa a humana)"],
  ["publicidad_enganosa", "Publicidad engañosa, precios, promociones", "humana", "Contención", "Pide evidencia", "Hoja del mes", "Sí, a comercial"],
  ["concursos", "Concursos y boletas", "humana", null, null, null, "Sí"],
  ["colaboraciones", "Colaboraciones, creadores, instituciones", "humana", null, null, null, "Sí"],
  ["politica_spam", "Política, spam, fuera de tema", "automatica", "Ocultar", null, "Bitácora de moderación", "Resumen diario"],
  ["competencia", "Menciona a la competencia", "automatica", "Ocultar", null, "Bitácora", "Sí"],
  ["repetitivo", "Comentarista repetitivo", "automatica", "Responde el último, oculta los anteriores", null, "Ficha del usuario", "Sí"],
  ["datos_personales", "Datos personales publicados", "automatica", "Ocultar de inmediato", "\"Por tu seguridad ocultamos tu comentario\" y sigue el caso", "Según el caso", "Sí"],
  ["alto_alcance", "Alto alcance", "humana", "Nada automático", "Nada automático", "Según el caso", "Inmediata", [], "Cuenta verificada, empresa o creador con muchos seguidores, mención de un medio o alguien de la lista de vigilancia"],
  ["crisis", "Crisis", "humana", "Nada; pausa la automatización en esa publicación", null, "Bitácora de crisis", "Inmediata", [], "Muerte, emergencia de salud, denuncia o un pico de comentarios en una publicación"],
  ["no_encaja", "No encaja o baja confianza", "escala", "Contención si es queja o pregunta", null, null, "Sí"],
];

type Template = [code: string, name: string, channel: "publico" | "dm", body: string, whenToUse?: string];

export const TEMPLATES: Template[] = [
  ["P1", "Domicilio de medicamentos de la EPS", "publico", "¡Hola {usuario}! Esperamos que estés bien. Las entregas a domicilio están disponibles para usuarios priorizados definidos por la EPS, como personas con discapacidad, pacientes de cuidados paliativos, adultos mayores con dependencia y otros grupos establecidos normativamente. Si deseas validar si aplicas para este servicio, debes comunicarte con tu EPS. 💙", "Pregunta por el domicilio de los medicamentos que le entrega su EPS: su fórmula, Sanitas o la dispensación"],
  ["P2", "Puntos de dispensación en el Meta", "publico", "¡Hola {usuario}! Gracias por escribirnos. 💙 Te compartimos la información de nuestros nuevos puntos de dispensación habilitados para usuarios del Meta: https://www.instagram.com/p/Dd894WKjDW2/?img_index=3", "Es del departamento del Meta: Villavicencio u otro municipio del Meta"],
  ["P3", "Puntos de dispensación (general)", "publico", "¡Hola {usuario}! Gracias por escribirnos. 💙 Te compartimos la información de nuestras tiendas y puntos de dispensación: https://www.drogueriascafam.com.co/tiendas", "Pregunta dónde reclamar sus medicamentos o por las tiendas y no dice la ciudad, o su ciudad no está en la base"],
  ["P4", "¿Puede otra persona reclamar mis medicamentos?", "publico", "¡Hola {usuario}! Esperamos que estés muy bien. Sí, esta persona debe asistir con una carta de autorización, indicando que puede reclamar tus medicamentos, con firma y copia de la cédula del usuario (o sea de la persona a la que está a nombre el medicamento)."],
  ["P5", "Queja por falta de citas en la plataforma", "publico", "¡Hola {usuario}! Lamentamos mucho los inconvenientes presentados. Nos comunicaremos contigo por DM para atender tu caso."],
  ["P5", "Queja por falta de citas en la plataforma", "dm", "¡Hola, {nombre}! Vimos tu mensaje en redes sociales, por eso nos comunicamos de inmediato con el área de dispensación para revisar los inconvenientes que nos has reportado con el agendamiento de citas.\n\nQueremos contarte que, tras la revisión, la plataforma se encuentra habilitada y funcionando. Sin embargo, debido a la alta demanda, los espacios disponibles pueden agotarse rápidamente. Por eso, te recomendamos estar pendiente de la habilitación de nuevas fechas, ya que la agenda se actualiza progresivamente, día a día, hasta completar un calendario de 30 días.\n\nSi necesitas reclamar tus medicamentos con urgencia y no encuentras disponibilidad para agendar, puedes acercarte directamente a la farmacia y solicitar un turno presencial.\n\nSeguimos trabajando para mejorar nuestro servicio y brindarte una mejor experiencia. Agradecemos tu paciencia y comprensión. 💙"],
  ["P6", "Queja por medicamentos no entregados", "publico", "¡Hola {usuario}! Lamentamos la situación. Nos comunicaremos contigo por mensaje interno para ayudarte con tu caso."],
  ["P6", "Queja por medicamentos no entregados", "dm", "Hola {nombre}, vimos tu comentario en redes sociales. ¿Nos ayudas con más información de tu caso?\n¿Dónde sucedió?\n¿Cuándo sucedió?\n¿Tu nombre y contacto?\n\nAdicional, queremos saber si lograste reclamar tus medicamentos o si deseas que te ayudemos desde acá a escalar tu solicitud. Si es así, y nos autorizas el tratamiento de tus datos personales, por favor compártenos: Nombre completo, número de documento, celular, correo electrónico, dirección de entrega, ciudad donde te generaron el pendiente, punto de dispensación al que fuiste y fórmulas médicas vigentes.\n\nConsulta el tratamiento de datos: https://www.drogueriascafam.com.co/politica-de-privacidad"],
  ["P7", "El usuario envía sus datos completos", "dm", "¡Hola {nombre}! Esperamos que te encuentres muy bien. 😊\n\nMuchas gracias por enviarnos tus datos completos. Queremos informarte que ya registramos tu caso y lo hemos escalado de inmediato al área encargada de la entrega de dispensación.\n\nEsperamos darte una respuesta y solución en los próximos días. Estaremos muy atentos para comunicarnos contigo apenas tengamos la confirmación.\n\n¡Que tengas un excelente día! 💙"],
  ["P8", "Hoja de vida / empleo", "dm", "¡Hola {nombre}! Esperamos que estés muy bien.\n\nGracias por escribirnos y por compartirnos tu perfil. Entendemos que estás buscando una oportunidad para adquirir experiencia en el mundo laboral. Para conocer las vacantes disponibles y consultar cómo puedes postularte, te invitamos a comunicarte con el Fondo de Empleo Cafam, donde podrán orientarte sobre las oportunidades que se ajusten a tu perfil.\n\n👉 https://www.cafam.com.co/agencia-empleo\n\n¡Te deseamos muchos éxitos en tu búsqueda! 💙"],
  ["P9", "Precio o disponibilidad de un producto", "publico", "¡Hola {usuario}! Esperamos que estés muy bien. Puedes consultar todos nuestros productos con sus precios a través de nuestra página web: https://drogueriascafam.com.co/ 💙"],
  // Borrador de Ogilvy (2026-10-26) mientras Cafam confirma canal y cobertura de domicilios de compras.
  ["P11", "Puntos de dispensación en tu ciudad", "publico", "¡Hola {usuario}! 💙 En {ciudad} puedes reclamar tus medicamentos en estos puntos de dispensación: {puntos}", "Pregunta dónde reclamar sus medicamentos y su ciudad está en la base (Puntos de dispensación por ciudad)"],
  ["P10", "Domicilio de compras", "publico", "¡Hola {usuario}! 💙 Para compras de productos o medicamentos, cuéntanos en qué ciudad estás y te confirmamos si tenemos domicilio allí.", "Quiere comprar un producto o medicamento y pregunta si hay domicilio"],
];

const LINKS: [title: string, content: string][] = [
  ["Tiendas y puntos de dispensación", "https://www.drogueriascafam.com.co/tiendas"],
  ["Agendamiento de citas (Meta)", "https://agendamientodroguerias.cafam.com.co"],
  ["Política de tratamiento de datos", "https://www.drogueriascafam.com.co/politica-de-privacidad"],
  ["Agencia de empleo Cafam", "https://www.cafam.com.co/agencia-empleo"],
];

// Matriz y plantillas de un cliente (se reutiliza para el cliente demo).
export async function seedConfig(db: mysql.Connection, clientId: number) {
  for (const [i, [code, label, autonomy, pub, priv, record, alert, examples = [], description = null]] of CASE_TYPES.entries()) {
    await db.query(
      `INSERT INTO case_types (client_id, position, code, name, description, examples, autonomy, public_action, private_action, record_target, alert)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE position = VALUES(position), name = VALUES(name), description = VALUES(description), examples = VALUES(examples), autonomy = VALUES(autonomy),
         public_action = VALUES(public_action), private_action = VALUES(private_action), record_target = VALUES(record_target), alert = VALUES(alert)`,
      [clientId, i + 1, code, label, description, JSON.stringify(examples), autonomy, pub, priv, record, alert],
    );
  }
  for (const [code, label, channel, body, whenToUse = null] of TEMPLATES) {
    await db.query(
      `INSERT INTO templates (client_id, code, name, channel, body, when_to_use) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), body = VALUES(body), when_to_use = VALUES(when_to_use)`,
      [clientId, code, label, channel, body, whenToUse],
    );
  }
}

export async function seedCafam(uri: string) {
  const db = await mysql.createConnection({ uri });
  try {
    const name = "Droguerías Cafam";
    const [found] = await db.query<RowDataPacket[]>("SELECT id FROM clients WHERE name = ?", [name]);
    const clientId =
      found[0]?.id ??
      (await db.query<ResultSetHeader>("INSERT INTO clients (name, settings) VALUES (?, ?)", [
        name,
        JSON.stringify({ zona_horaria: "America/Bogota", muestreo: 0.1 }),
      ]))[0].insertId;

    await seedConfig(db, clientId);
    await db.query("DELETE FROM knowledge_items WHERE client_id = ? AND topic = 'enlace'", [clientId]);
    for (const [title, content] of LINKS) {
      await db.query("INSERT INTO knowledge_items (client_id, topic, title, content) VALUES (?, 'enlace', ?, ?)", [clientId, title, content]);
    }
    console.log(`Cafam listo (cliente ${clientId}): ${CASE_TYPES.length} tipos de caso, ${TEMPLATES.length} plantillas, ${LINKS.length} enlaces`);
  } finally {
    await db.end();
  }
}

if (import.meta.main) await seedCafam(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/social_care");
