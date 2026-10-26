// Flujo de un tipo de caso, armado por selecciones en el editor de la matriz. Las plantillas se
// eligen de las que existen (si falta una, se crea primero en Plantillas). Del flujo salen los textos
// de public_action, private_action, record_target y alert, que leen la tabla y la IA.

// Temas de la Base de conocimiento (knowledge_items.topic). Cada tipo de caso elige de cuáles saca datos.
export const TOPICS = {
  sede: "Sedes",
  horario: "Horarios",
  festivo: "Festivos",
  enlace: "Enlaces",
  requisito: "Requisitos",
  cobertura: "Domicilios y cobertura",
  dispensacion: "Puntos de dispensación por ciudad",
} as const;
export type KnowledgeTopic = keyof typeof TOPICS;
const ALL_TOPICS = Object.keys(TOPICS) as KnowledgeTopic[];

// Variables de una plantilla que llena la base ({ciudad}, {puntos}); {usuario} y {nombre} no cuentan.
export const templateVars = (body: string | null | undefined) => [...new Set(body?.match(/\{(?!usuario\}|nombre\})[\p{L}_]+\}/gu) ?? [])];

// «plantilla»: plantillas, temas de la base o ambos. La plantilla pone el texto y el tono; la base, el dato.
export const PUBLIC_MODES = {
  plantilla: "Con plantilla o datos de la base",
  corta: "Respuesta corta, sin plantilla",
  caso_fondo: "La plantilla del caso de fondo",
  contencion: "Contención: avisa que sigue por DM",
  ocultar: "Ocultar el comentario",
  nada: "Nada automático",
} as const;

export const PRIVATE_MODES = {
  plantilla: "Con plantilla o datos de la base",
  pedir: "Pide datos, sin plantilla",
  seguimiento: "Estado del caso desde la Hoja",
  aviso_ocultado: "Avisa que se ocultó por seguridad y sigue el caso",
  caso_fondo: "Igual al caso de fondo",
  nada: "No manda DM",
} as const;

// Qué hace la plataforma con cada opción, para que quien arma el flujo lo vea al elegir.
export const PUBLIC_HELP: Record<keyof typeof PUBLIC_MODES, string> = {
  plantilla: "Marca plantillas, temas de la base o ambos. La plantilla pone el texto y el tono; la base pone el dato (ciudad, puntos, horario, enlace). Si el dato no está, pasa a una persona.",
  corta: "La IA escribe una respuesta corta y cordial, sin datos puntuales. Para agradecimientos y emojis.",
  caso_fondo: "Responde como el caso real detrás del mensaje: una queja con insulto se responde como la queja.",
  contencion: "Publica «¡Hola {usuario}! Gracias por escribirnos, te contactamos por mensaje interno 💙» y el caso sigue por DM.",
  ocultar: "Oculta el comentario. Se puede volver a mostrar; no se borra.",
  nada: "No publica nada; el caso pasa a una persona.",
};
export const PRIVATE_HELP: Record<keyof typeof PRIVATE_MODES, string> = {
  plantilla: "Manda por DM la plantilla, los datos de la base que marques o ambos, y le pide a la persona lo que marques abajo.",
  pedir: "La IA escribe un DM corto que pide los datos que marques, con el tono de las plantillas.",
  seguimiento: "Busca el caso abierto de la persona en la Hoja del cliente y le cuenta en qué va (se conecta con Google Sheets en el sprint 3).",
  aviso_ocultado: "Le escribe «Por tu seguridad ocultamos tu comentario» y sigue el caso por DM.",
  caso_fondo: "Usa el DM del caso real detrás del mensaje.",
  nada: "No manda mensaje privado.",
};

export const ASK_FIELDS = {
  ciudad: "ciudad",
  sede: "droguería o sede",
  fecha: "fecha",
  nombre: "nombre completo",
  contacto: "teléfono o correo",
  documento: "documento",
  formula: "foto de la fórmula",
  evidencia: "evidencia (foto o enlace)",
  autorizacion: "autorización de datos",
} as const;

export const RECORDS = {
  ninguno: "No se registra",
  hoja_mes: "Hoja del mes",
  hoja_mes_meta: "Hoja del mes (o la del Meta si es Villavicencio) + soportes",
  nueva_fila: "Fila nueva en la Hoja, con número de caso",
  nota_caso: "Nota fechada en el caso",
  bitacora: "Bitácora",
  bitacora_moderacion: "Bitácora de moderación",
  bitacora_crisis: "Bitácora de crisis",
  ficha: "Ficha del usuario",
  segun_caso: "Según el caso de fondo",
} as const;

export const ALERT_LEVELS = { no: "No avisa", si: "Avisa", inmediata: "Aviso inmediato", diario: "Resumen diario" } as const;
export const ALERT_WHEN = {
  siempre: "siempre",
  salud_critica: "si hay salud crítica",
  insulto_grave: "si hay insulto grave o amenaza",
  no_en_base: "si el dato no está en la base",
  plazo_vencido: "si el caso sigue abierto después del plazo acordado",
  comercial: "al área comercial",
} as const;

// Preguntas abiertas: la respuesta depende de algo que la persona no dijo (¿EPS o compra?, ¿qué
// ciudad?). Por defecto (decisión de Imderf, 2026-10-26): en comentarios, una respuesta que cubre
// los casos; por DM, preguntar primero. Cada tipo de caso lo puede cambiar.
export const AMBIGUOUS = {
  ambas: "Responder cubriendo los casos",
  preguntar: "Preguntar primero",
  persona: "Pasar a una persona",
} as const;
export const AMBIGUOUS_HELP: Record<keyof typeof AMBIGUOUS, string> = {
  ambas: "Una sola respuesta que cubre cada caso con su plantilla («si es de tu EPS…; si es una compra…»). Si para algún caso no hay plantilla, va la contención y lo atiende una persona.",
  preguntar: "Una sola pregunta corta para saber qué caso es, sin dar datos. Cuando la persona contesta, se responde con la plantilla que corresponde (por DM la IA ve la conversación).",
  persona: "No responde nada automático: lo atiende una persona.",
};
export const DEFAULT_AMBIGUOUS = { comentario: "ambas", dm: "preguntar" } as const;
export const ambiguousOf = (flow: unknown): { comentario: keyof typeof AMBIGUOUS; dm: keyof typeof AMBIGUOUS } => ({
  ...DEFAULT_AMBIGUOUS,
  ...(flow && typeof flow === "object" ? ((flow as Flow).ambiguous ?? {}) : {}),
});

type K<T> = keyof T;
export type Flow = {
  public: { mode: K<typeof PUBLIC_MODES>; templates: string[]; base: KnowledgeTopic[]; like: boolean };
  private: { mode: K<typeof PRIVATE_MODES>; templates: string[]; base: KnowledgeTopic[]; ask: K<typeof ASK_FIELDS>[] };
  record: K<typeof RECORDS>;
  alert: { level: K<typeof ALERT_LEVELS>; when: K<typeof ALERT_WHEN> };
  ambiguous?: { comentario: K<typeof AMBIGUOUS>; dm: K<typeof AMBIGUOUS> };
};

const codes = (t: string | null) => [...new Set(t?.match(/\bP\d+\b/g) ?? [])];
const has = (t: string | null, re: RegExp) => !!t && re.test(t);
const BASE = /\bbase\b/i;
// Temas nombrados después de «base» en el texto de la acción; «base de conocimiento» sin temas = todos.
const topicsIn = (t: string | null): KnowledgeTopic[] => {
  if (!t || !BASE.test(t)) return [];
  const rest = t.slice(t.search(BASE)).toLowerCase();
  const named = ALL_TOPICS.filter((k) => rest.includes(TOPICS[k].toLowerCase()));
  return named.length ? named : ALL_TOPICS;
};

// Flujos guardados antes del 2026-10-26: «Con un dato de la base» era una opción aparte (hoy es
// plantilla con todos los temas y sin plantillas) y no había temas por tipo de caso.
function withTopics(f: Flow): Flow {
  const legacyBase = (f.public.mode as string) === "base";
  return {
    ...f,
    public: { ...f.public, mode: legacyBase ? "plantilla" : f.public.mode, base: f.public.base ?? (legacyBase ? ALL_TOPICS : []) },
    private: { ...f.private, base: f.private.base ?? [] },
  };
}

// Temas de la base que puede usar la respuesta de un canal. El caso de fondo usa los de ese caso.
export const allowedTopics = (part: { mode: string; base: KnowledgeTopic[] } | undefined): KnowledgeTopic[] =>
  !part || part.mode === "caso_fondo" ? ALL_TOPICS : part.mode === "plantilla" ? part.base : [];

// Para los tipos que todavía no tienen flujo guardado: se lee del texto que ya tenían. Con las
// plantillas del cliente, un código que solo existe en el otro canal se pasa a ese canal (en Cafam,
// "Empleo" decía P8 en público, pero P8 es un DM): el público queda en contención.
export function inferFlow(
  t: { public_action: string | null; private_action: string | null; record_target: string | null; alert: string | null; flow?: unknown },
  templates?: { code: string; channel: string }[],
): Flow {
  if (t.flow && typeof t.flow === "object") return withTopics(t.flow as Flow);
  const f = inferFromText(t);
  if (!templates) return f;
  const inChannel = (c: string, ch: string) => templates.some((x) => x.code === c && x.channel === ch);
  const moved = f.public.templates.filter((c) => !inChannel(c, "publico") && inChannel(c, "dm"));
  if (moved.length) {
    f.public.templates = f.public.templates.filter((c) => !moved.includes(c));
    if (!f.public.templates.length) f.public.mode = "contencion";
    if (f.private.mode === "nada" || f.private.mode === "plantilla") f.private = { ...f.private, mode: "plantilla", templates: [...new Set([...f.private.templates, ...moved])] };
  }
  return f;
}

function inferFromText(t: { public_action: string | null; private_action: string | null; record_target: string | null; alert: string | null }): Flow {
  const pub = t.public_action;
  const priv = t.private_action;
  const publicMode: Flow["public"]["mode"] = codes(pub).length ? "plantilla"
    : has(pub, /ocult/i) ? "ocultar"
    : has(pub, /contenci/i) ? "contencion"
    : has(pub, BASE) ? "plantilla"
    : has(pub, /caso de fondo/i) ? "caso_fondo"
    : has(pub, /corta/i) ? "corta"
    : "nada";
  const privateMode: Flow["private"]["mode"] = codes(priv).length || has(priv, BASE) ? "plantilla"
    : has(priv, /ocultamos|seguridad/i) ? "aviso_ocultado"
    : has(priv, /estado del caso|seguimiento/i) ? "seguimiento"
    : has(priv, /caso de fondo/i) ? "caso_fondo"
    : has(priv, /pide|solicita/i) ? "pedir"
    : "nada";
  const ask = (Object.keys(ASK_FIELDS) as K<typeof ASK_FIELDS>[]).filter((f) =>
    ({ autorizacion: /autoriza/i, formula: /fórmula|formula/i, evidencia: /evidencia/i, ciudad: /ciudad|dónde/i, fecha: /fecha|cuándo/i } as Record<string, RegExp>)[f]?.test(priv ?? ""),
  );
  const r = t.record_target ?? "";
  const record: Flow["record"] = !r ? "ninguno"
    : /villavicencio|meta/i.test(r) ? "hoja_mes_meta"
    : /fila nueva/i.test(r) ? "nueva_fila"
    : /nota fechada/i.test(r) ? "nota_caso"
    : /crisis/i.test(r) ? "bitacora_crisis"
    : /moderaci/i.test(r) ? "bitacora_moderacion"
    : /bit[aá]cora/i.test(r) ? "bitacora"
    : /ficha/i.test(r) ? "ficha"
    : /seg[uú]n el caso/i.test(r) ? "segun_caso"
    : "hoja_mes";
  const a = t.alert ?? "";
  const level: Flow["alert"]["level"] = !a || /^no$/i.test(a) ? "no" : /inmediata/i.test(a) ? "inmediata" : /resumen diario/i.test(a) ? "diario" : "si";
  const when: Flow["alert"]["when"] = /salud/i.test(a) ? "salud_critica" : /insulto|amenaza/i.test(a) ? "insulto_grave" : /no est[aá] en la base/i.test(a) ? "no_en_base"
    : /plazo/i.test(a) ? "plazo_vencido" : /comercial/i.test(a) ? "comercial" : "siempre";
  return {
    public: { mode: publicMode, templates: codes(pub), base: topicsIn(pub), like: has(pub, /me gusta/i) },
    private: { mode: privateMode, templates: codes(priv), base: topicsIn(priv), ask },
    record,
    alert: { level, when },
  };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

// Los textos que leen la tabla y la IA. Llevan los códigos de plantilla (P6) para que el código
// pueda revisar que la IA solo use las plantillas del tipo de caso, y los temas de la base que puede
// usar: «P1 / P10 pública + datos de la base (domicilios y cobertura)», o «Pública con datos de la base (…)».
const sources = (p: { templates: string[]; base: KnowledgeTopic[] }, channel: string) => {
  const base = p.base.length ? `datos de la base (${list(p.base.map((k) => TOPICS[k].toLowerCase()))})` : "";
  return p.templates.length ? `${p.templates.join(" / ")} ${channel}${base ? ` + ${base}` : ""}` : `${channel.charAt(0).toUpperCase()}${channel.slice(1)} con ${base}`;
};

export function flowColumns(f: Flow) {
  const like = f.public.like ? "; me gusta en Facebook" : "";
  const asked = f.private.ask.map((x) => ASK_FIELDS[x]);
  return {
    public_action: f.public.mode === "plantilla" ? `${sources(f.public, "pública")}${like}` : `${PUBLIC_MODES[f.public.mode]}${like}`,
    private_action:
      f.private.mode === "nada" ? null
      : f.private.mode === "plantilla" ? `${sources(f.private, "DM")}${asked.length ? `: pide ${list(asked)}` : ""}`
      : f.private.mode === "pedir" ? `Pide ${list(asked) || "los datos del caso"}`
      : PRIVATE_MODES[f.private.mode],
    record_target: f.record === "ninguno" ? null : RECORDS[f.record],
    alert: f.alert.level === "no" ? null : `${ALERT_LEVELS[f.alert.level]}${f.alert.when === "siempre" ? "" : ` ${ALERT_WHEN[f.alert.when]}`}`,
  };
}

// Revisa lo elegido contra las plantillas vigentes del cliente. Devuelve el problema, o null.
export function validateFlow(f: Flow, templates: { code: string; channel: string; body?: string | null }[]) {
  const find = (code: string, channel: string) => templates.find((t) => t.code === code && t.channel === channel);
  for (const [p, channel, name] of [[f.public, "publico", "pública"], [f.private, "dm", "de DM"]] as const) {
    if (p.mode !== "plantilla") continue;
    if (!p.templates.length && !p.base.length) return `Marca al menos una plantilla ${name} o un tema de la base de conocimiento. Si falta la plantilla, créala primero en Plantillas.`;
    const missing = p.templates.find((c) => !find(c, channel));
    if (missing) return `La plantilla ${name} ${missing} no existe o está desactivada.`;
    const needs = p.base.length ? null : p.templates.find((c) => templateVars(find(c, channel)?.body).length);
    if (needs) return `La plantilla ${needs} usa ${list(templateVars(find(needs, channel)?.body))}: marca de qué temas de la base salen esos datos.`;
  }
  if (f.private.mode === "pedir" && !f.private.ask.length) return "Marca qué datos pide el DM.";
  return null;
}

// Lee el flujo del formulario del editor. Solo acepta valores de las listas de arriba.
export function flowFromForm(form: FormData): Flow {
  const one = <T extends object>(name: string, options: T, fallback: keyof T) => {
    const v = String(form.get(name));
    return (v in options ? v : fallback) as keyof T;
  };
  const many = <T extends object>(name: string, options?: T) => form.getAll(name).map(String).filter((v) => (options ? v in options : /^[A-Z0-9_]{1,20}$/.test(v)));
  return {
    public: { mode: one("public_mode", PUBLIC_MODES, "nada"), templates: many("public_templates"), base: many("public_base", TOPICS) as KnowledgeTopic[], like: form.get("like") === "on" },
    private: {
      mode: one("private_mode", PRIVATE_MODES, "nada"),
      templates: many("private_templates"),
      base: many("private_base", TOPICS) as KnowledgeTopic[],
      ask: many("ask", ASK_FIELDS) as Flow["private"]["ask"],
    },
    record: one("record", RECORDS, "ninguno"),
    alert: { level: one("alert_level", ALERT_LEVELS, "no"), when: one("alert_when", ALERT_WHEN, "siempre") },
    ambiguous: { comentario: one("amb_comentario", AMBIGUOUS, "ambas"), dm: one("amb_dm", AMBIGUOUS, "preguntar") },
  };
}
