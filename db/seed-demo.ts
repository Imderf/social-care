// Cliente demo en MODO PRUEBA, para ver el panel con volumen mientras no hay cuentas reales.
// Cada comentario trae lo que la IA haría (sin publicar), lo que respondió el equipo desde Meta y,
// en parte, la verificación del equipo. Textos inventados y genéricos (no son datos de Cafam).
// Se borra y se recrea cada vez, siempre igual (semilla fija), con fechas relativas a hoy.
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { seedConfig } from "./seed-cafam.ts";

const NAME = "Demo · Droguería de ejemplo";

// código del tipo de caso → peso relativo y textos de ejemplo (ya enmascarados).
const MIX: [string, number, string[]][] = [
  ["pendiente_entrega", 26, ["Llevo dos semanas esperando mi medicamento y siempre dicen que no hay", "Me dejaron pendiente la insulina desde el 3 de octubre, ¿qué hago?", "Fui otra vez a la sede del centro y no me entregaron la fórmula completa"]],
  ["envia_datos", 6, ["Hola, mis datos: [nombre], CC [documento], cel [celular], correo [correo]. Adjunto la fórmula", "Ya les envié todo lo que me pidieron"]],
  ["citas", 10, ["No hay citas en la plataforma desde hace un mes", "¿Cómo agendo cita para reclamar en Villavicencio?", "Tengo cita el lunes festivo, ¿atienden?"]],
  ["caso_abierto", 7, ["Ya les escribí la semana pasada y no me han respondido nada", "¿Hay novedades de mi caso?"]],
  ["puntos_dispensacion", 8, ["¿Dónde puedo reclamar mis medicamentos en el sur?", "¿Qué puntos atienden a usuarios de la EPS en el Meta?"]],
  ["horarios_sedes", 9, ["¿A qué hora abren el sábado?", "¿La sede de la quinta sigue abierta o la cerraron?", "¿Atienden el festivo?"]],
  ["domicilios", 4, ["¿Tienen domicilio para adultos mayores?", "Mi mamá no puede ir, ¿le pueden llevar los medicamentos?"]],
  ["otra_persona_reclama", 3, ["¿Mi hijo puede reclamar por mí?", "¿Qué necesita llevar mi esposa para reclamar mi fórmula?"]],
  ["precio_producto", 3, ["¿Cuánto vale el protector solar de 50?", "¿Tienen la crema que salió en el video?"]],
  ["empleo", 3, ["Hola, quisiera enviar mi hoja de vida", "¿Están contratando auxiliares de farmacia?"]],
  ["positivo_emoji", 8, ["💙", "👍👍", "Muy buena atención en la sede del norte, gracias", "❤️"]],
  ["queja_insulto", 3, ["Pésimo servicio, son unos incompetentes, llevo un mes sin mi medicamento", "Qué falta de respeto con los usuarios"]],
  ["publicidad_enganosa", 1, ["El precio de la promoción no es el que cobran en la tienda"]],
  ["concursos", 1, ["¿Cuándo anuncian los ganadores del concurso?"]],
  ["colaboraciones", 0.5, ["Hola, hago contenido de salud y me gustaría trabajar con ustedes"]],
  ["politica_spam", 2, ["Gana dinero desde casa, escríbeme al privado", "Ese gobierno tiene la culpa de todo"]],
  ["competencia", 1, ["En la droguería de enfrente sí me entregaron todo"]],
  ["repetitivo", 1, ["¿Y mi medicamento?"]],
  ["datos_personales", 1, ["Mi cédula es [documento] y mi celular [celular], llámenme ya"]],
  ["alto_alcance", 0.4, ["Vamos a hacer una nota en el noticiero sobre las entregas de medicamentos"]],
  ["crisis", 0.2, ["Mi papá terminó en urgencias porque no le entregaron el medicamento a tiempo"]],
  ["no_encaja", 3, ["Holaaa", "¿Venden boletas para el concierto?"]],
];

// Plantilla que usaría la IA por tipo de caso (código y canal), o texto propio.
const REPLY: Record<string, { code?: string; channel?: "publico" | "dm"; text?: string }> = {
  pendiente_entrega: { code: "P6", channel: "publico" },
  envia_datos: { code: "P7", channel: "dm" },
  citas: { code: "P5", channel: "publico" },
  puntos_dispensacion: { code: "P3", channel: "publico" },
  domicilios: { code: "P1", channel: "publico" },
  otra_persona_reclama: { code: "P4", channel: "publico" },
  precio_producto: { code: "P9", channel: "publico" },
  empleo: { code: "P8", channel: "dm" },
  queja_insulto: { code: "P6", channel: "publico" },
  repetitivo: { code: "P6", channel: "publico" },
  positivo_emoji: { text: "¡Gracias por escribirnos, {usuario}! 💙" },
  caso_abierto: { text: "¡Hola {usuario}! Gracias por escribirnos, te contactamos por mensaje interno para darte el estado de tu caso 💙" },
};
const HIDE = new Set(["politica_spam", "competencia", "datos_personales"]);
const CRITICAL = new Set(["alto_alcance", "crisis"]);
// Precisión simulada de la IA por tipo (para que la tabla de verificación muestre de todo).
const ACCURACY: Record<string, number> = {
  pendiente_entrega: 0.94, envia_datos: 0.91, citas: 0.78, caso_abierto: 0.84, puntos_dispensacion: 0.97, domicilios: 0.95,
  otra_persona_reclama: 0.96, precio_producto: 0.92, empleo: 0.96, positivo_emoji: 0.98, queja_insulto: 0.72, repetitivo: 0.9,
  politica_spam: 0.95, competencia: 0.9, datos_personales: 1,
};
const FIX_NOTES = ["Faltó el enlace de agendamiento del Meta", "El usuario es de Cali, no del Meta", "Tono muy frío para una queja de salud", "Debía ir por DM, no en público", "Usó la plantilla de otro tipo de caso"];
const HANDLES = [
  "mariacamila.r", "jdavid_88", "lucho.gomez", "sandra.p.ortiz", "carlitos_cali", "yeimy_c", "andresfelipe23", "dianam_", "jorge.e.rios", "paola.villa",
  "don.alvaro62", "natis.gb", "kevin.ospina", "mafe.torres", "sebasm", "claudia.r.h", "juanpa_mtz", "valen.c", "fercho_77", "luzmarina.s",
  "danielaq", "oscar.h.b", "stefy.mz", "ricardo.cali", "gloria.velez", "camilo.andres", "lina_mar", "edwin.r", "angie.p", "betty.villavo",
];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemo(uri: string, now = new Date()) {
  const db = await mysql.createConnection({ uri, timezone: "Z" });
  await db.query("SET time_zone = '+00:00'");
  const rand = rng(42);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const insert = async (sql: string, params: unknown[]) => (await db.query<ResultSetHeader>(sql, params))[0].insertId;

  try {
    await db.beginTransaction();
    await db.query("DELETE FROM clients WHERE JSON_CONTAINS(settings, 'true', '$.demo')");
    const clientId = await insert("INSERT INTO clients (name, settings) VALUES (?, ?)", [NAME, JSON.stringify({ demo: true, zona_horaria: "America/Bogota" })]);
    await seedConfig(db, clientId);

    const [typeRows] = await db.query<RowDataPacket[]>("SELECT id, code, autonomy FROM case_types WHERE client_id = ?", [clientId]);
    const types = new Map(typeRows.map((t) => [t.code as string, t]));
    const [tplRows] = await db.query<RowDataPacket[]>("SELECT code, channel, body FROM templates WHERE client_id = ?", [clientId]);
    const template = (code: string, channel: string) => tplRows.find((t) => t.code === code && t.channel === channel)?.body as string | undefined;

    const accounts = {
      fb: await insert("INSERT INTO accounts (client_id, platform, meta_id, name, mode, last_webhook_at) VALUES (?, 'fb', 'demo-fb', 'Droguería Demo', 'prueba', ?)", [clientId, now]),
      ig: await insert("INSERT INTO accounts (client_id, platform, meta_id, name, mode, last_webhook_at) VALUES (?, 'ig', 'demo-ig', '@drogueria.demo', 'prueba', ?)", [clientId, now]),
    };
    const contacts: { id: number; platform: "fb" | "ig"; username: string }[] = [];
    for (const [i, username] of HANDLES.entries()) {
      const platform = i % 5 === 0 ? "fb" : "ig";
      contacts.push({ id: await insert("INSERT INTO contacts (client_id, platform, meta_user_id, username, followers) VALUES (?, ?, ?, ?, ?)", [clientId, platform, `demo-user-${i}`, username, Math.round(between(40, 2500))]), platform, username });
    }
    const media = await insert("INSERT INTO contacts (client_id, platform, meta_user_id, username, followers, verified) VALUES (?, 'ig', 'demo-media', 'noticias.valle', 85400, TRUE)", [clientId]);

    // Publicaciones de ejemplo (sin enlace: no existen en Meta) para el Resumen.
    const POSTS: [type: string, caption: string][] = [
      ["reel", "Así funciona la entrega de medicamentos a domicilio"],
      ["carrusel", "Nuevos puntos de dispensación en Cali y Bogotá"],
      ["foto", "Horarios especiales del puente festivo"],
      ["video", "Cómo agendar tu cita en línea"],
      ["reel", "Consejos para reclamar tus medicamentos sin filas"],
      ["foto", "Gracias por elegirnos 💙"],
    ];
    for (const account of Object.values(accounts)) {
      for (const [i, [type, caption]] of POSTS.entries()) {
        await insert("INSERT INTO posts (client_id, account_id, meta_id, type, caption, published_at) VALUES (?, ?, ?, ?, ?, ?)", [
          clientId, account, `demo-post-${i}`, type, caption, new Date(now.getTime() - (30 - i * 5) * 864e5),
        ]);
      }
    }
    // Sentimiento según el tipo de caso, con algo de ruido como en la vida real.
    const NEGATIVE = new Set(["pendiente_entrega", "citas", "queja_insulto", "publicidad_enganosa", "crisis", "caso_abierto", "competencia"]);
    const sentimentFor = (code: string) => {
      const base = code === "positivo_emoji" ? "positivo" : NEGATIVE.has(code) ? "negativo" : "neutral";
      return rand() < 0.12 ? (["positivo", "neutral", "negativo"] as const)[Math.floor(rand() * 3)] : base;
    };

    const totalWeight = MIX.reduce((s, m) => s + m[1], 0);
    const pickType = () => {
      let r = rand() * totalWeight;
      for (const m of MIX) if ((r -= m[1]) <= 0) return m;
      return MIX[0];
    };

    let n = 0;
    for (let d = 29; d >= 0; d--) {
      const dayStart = new Date(Date.parse(new Date(now.getTime() - 5 * 36e5 - d * 864e5).toISOString().slice(0, 10)) + 5 * 36e5);
      const weekday = new Date(dayStart.getTime() + 12 * 36e5).getUTCDay();
      const spike = d === 9 ? 2.2 : d === 3 ? 1.6 : 1; // días con picos de quejas
      const volume = Math.round((weekday === 0 ? 14 : weekday === 6 ? 22 : 34) * spike * between(0.85, 1.15));

      for (let k = 0; k < volume; k++) {
        const received = new Date(dayStart.getTime() + between(7, 22) * 36e5);
        if (received > now) continue;
        const [code, , texts] = pickType();
        const type = types.get(code)!;
        const platform = code === "alto_alcance" || rand() < 0.8 ? "ig" : "fb";
        const kind = code === "envia_datos" || code === "empleo" || rand() < 0.2 ? "dm" : "comentario";
        const contact = code === "alto_alcance" ? { id: media, username: "noticias.valle" } : pick(contacts.filter((c) => c.platform === platform));
        const ageH = (now.getTime() - received.getTime()) / 36e5;
        const fill = (t: string) => t.replace("{usuario}", `@${contact.username}`).replace("{nombre}", contact.username.split(/[._]/)[0]);

        // Lo que haría la IA.
        let decision: "responder" | "escalar" | "ocultar";
        let confidence = between(0.86, 0.99);
        let escalation: { reason: string; priority: string } | null = null;
        if (HIDE.has(code)) decision = "ocultar";
        else if (code === "horarios_sedes") {
          decision = "escalar";
          escalation = { reason: "El dato no está en la base de conocimiento (sedes y horarios sin cargar)", priority: "normal" };
        } else if (type.autonomy === "automatica" && rand() < 0.88) decision = "responder";
        else {
          decision = "escalar";
          if (type.autonomy === "automatica") confidence = between(0.55, 0.84);
          escalation = CRITICAL.has(code)
            ? { reason: code === "crisis" ? "Posible crisis: salud del usuario en riesgo" : "Alto alcance: cuenta verificada de un medio de comunicación", priority: "critica" }
            : type.autonomy === "humana"
              ? { reason: "Tipo de caso que siempre atiende una persona", priority: "alta" }
              : type.autonomy === "escala"
                ? { reason: "La IA no lo pudo clasificar", priority: "normal" }
                : { reason: `Baja confianza en el tipo de caso (${Math.round(confidence * 100)} %)`, priority: "normal" };
        }
        const r = REPLY[code];
        const proposed = decision === "responder" && r ? fill(r.text ?? template(r.code!, r.channel!) ?? "") : null;

        // Lo que hizo el equipo desde Meta (en prueba nada se publica desde la plataforma).
        const pending = escalation && (CRITICAL.has(code) ? ageH < 48 : ageH < 30 && rand() < 0.8);
        const teamHours = between(0.2, 6);
        const answered = !pending && decision !== "ocultar" && ageH > teamHours;
        const humanReply = answered
          ? proposed ?? fill("¡Hola {usuario}! Gracias por escribirnos. Te enviamos un mensaje interno para revisar tu caso 💙")
          : null;
        const firstResponse = answered ? new Date(received.getTime() + teamHours * 36e5) : null;

        const interactionId = await insert(
          `INSERT INTO interactions (client_id, account_id, kind, meta_id, post_id, contact_id, text_masked, case_type_id, confidence, sentiment,
             decision, mode, proposed_reply, proposed_template, human_reply, answered_by, received_at, first_response_at, window_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prueba', ?, ?, ?, ?, ?, ?, ?)`,
          [clientId, accounts[platform], kind, `demo-${++n}`, kind === "comentario" ? `demo-post-${Math.floor(rand() * rand() * 6)}` : null, contact.id, pick(texts), type.id,
            confidence.toFixed(3), sentimentFor(code), decision, proposed, r?.code ?? null, humanReply, answered ? "persona" : null, received, firstResponse,
            kind === "dm" ? new Date(received.getTime() + 864e5) : null],
        );

        if (escalation) {
          const draft = proposed ?? (code === "caso_abierto" || type.autonomy === "automatica" ? fill(REPLY.caso_abierto.text!) : null);
          await db.query(
            "INSERT INTO escalations (client_id, interaction_id, reason, priority, suggested_draft, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [clientId, interactionId, escalation.reason, escalation.priority, draft, received, firstResponse],
          );
        }

        // El equipo verificó parte de las propuestas de más de un día.
        if ((decision === "responder" || decision === "ocultar") && ageH > 24 && rand() < 0.55) {
          const ok = rand() < (ACCURACY[code] ?? 0.9);
          const verdict = ok ? "correcta" : rand() < 0.6 ? "corregir" : "incorrecta";
          await db.query("INSERT INTO verifications (client_id, interaction_id, verdict, note, created_at) VALUES (?, ?, ?, ?, ?)", [
            clientId, interactionId, verdict, ok ? null : pick(FIX_NOTES), new Date(received.getTime() + between(24, 40) * 36e5),
          ]);
        }
      }
    }
    await db.commit();
    console.log(`Demo listo (cliente ${clientId}, modo prueba): ${n} interacciones de ejemplo en 30 días`);
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    await db.end();
  }
}

if (import.meta.main) await seedDemo(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/social_care");
