// Cliente mínimo de la Graph API de Meta y del inicio de sesión para empresas (Facebook Login for
// Business). La configuración del login (META_LOGIN_CONFIG_ID) define el token: de usuario del
// sistema de integración, atado al portafolio del cliente y sin vencimiento por defecto.

const version = () => process.env.META_GRAPH_VERSION || "v26.0";

export const SUBSCRIBED_FIELDS = "feed,messages,message_echoes,mention";

// Qué falta para poder conectar; vacío = listo.
export function missingMetaConfig() {
  return ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "APP_BASE_URL", "TOKEN_ENCRYPTION_KEY"].filter((k) => !process.env[k]);
}

export const redirectUri = () => `${process.env.APP_BASE_URL}/api/meta/callback`;
// Mientras el panel no tenga login vive solo en local (PANEL_URL); en el servidor es el mismo dominio.
export const panelUrl = () => process.env.PANEL_URL || process.env.APP_BASE_URL!;

export function loginUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri(),
    config_id: process.env.META_LOGIN_CONFIG_ID!,
    response_type: "code",
    override_default_response_type: "true",
    state,
  });
  return `https://www.facebook.com/${version()}/dialog/oauth?${params}`;
}

// Sin "parameter properties": el worker corre este archivo con Node, que solo quita los tipos.
export class MetaError extends Error {
  code?: number;
  subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
}

async function graph<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${version()}/${path}`);
  const body = new URLSearchParams(params);
  // Sin respuesta en 20 s se corta: el worker no se queda colgado esperando a Meta.
  const res = await fetch(method === "GET" ? `${url}?${body}` : url, { ...(method === "POST" ? { method, body } : {}), signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new MetaError(json.error?.message ?? `Graph API respondió ${res.status}`, json.error?.code, json.error?.error_subcode);
  return json as T;
}

export async function exchangeCode(code: string) {
  const { access_token } = await graph<{ access_token: string }>("oauth/access_token", {
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: redirectUri(),
    code,
  });
  return access_token;
}

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

// Páginas que el cliente entregó en el login, con su token de página y su Instagram vinculado.
export async function listPages(userToken: string) {
  const { data } = await graph<{ data: MetaPage[] }>("me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: userToken,
  });
  return data;
}

// Adjuntos en palabras del equipo. La IA solo sabe que llegaron: no ve el archivo (una fórmula o
// una cédula son datos sensibles; en el sprint 3 van directo de Meta al Drive del cliente).
const ATTACHMENTS: Record<string, string> = {
  image: "foto", photo: "foto", video: "video", video_inline: "video", audio: "audio", file: "archivo", sticker: "sticker",
  animated_image_share: "GIF", ephemeral: "foto de ver una vez (no se puede leer: hay que pedirla como foto normal)",
  story_mention: "mención en una historia", share: "publicación compartida", ig_reel: "reel compartido", reel: "reel compartido",
  fallback: "enlace", location: "ubicación",
};
export const attachmentLabel = (types: string[]) =>
  types.length ? `[adjunto: ${types.map((t) => ATTACHMENTS[t] ?? (t.split("/")[0] === "image" ? "foto" : ATTACHMENTS[t.split("/")[0]] ?? "archivo")).join(", ")}]` : "";

// Texto de un comentario de Facebook. El webhook de la página a veces llega sin `message` (pasó con
// un comentario de solo 💙), y esos también hay que responderlos, así que se pide a la API.
export async function fetchCommentText(commentId: string, pageToken: string) {
  const c = await graph<{ message?: string; attachment?: { type?: string } }>(commentId, { fields: "message,attachment{type}", access_token: pageToken });
  return c.message || attachmentLabel(c.attachment?.type ? [c.attachment.type] : []);
}

// Nombre de quien escribe por DM: el webhook de mensajes no lo trae. Si Meta no lo da, queda sin nombre.
export async function fetchUserName(platform: "fb" | "ig", userId: string, pageToken: string) {
  try {
    const u = await graph<{ name?: string; username?: string }>(userId, { fields: platform === "ig" ? "username,name" : "name", access_token: pageToken });
    return (platform === "ig" ? u.username : u.name) ?? null;
  } catch {
    return null;
  }
}

// Perfil de quien comenta o escribe, para saber si es persona del común o influenciador (Meta, 2026-10):
// - Instagram por DM: seguidores y verificación de cualquier cuenta (User Profile API, token de página).
// - Instagram en comentarios: solo las cuentas de empresa o creador tienen datos públicos (Business
//   Discovery: token de usuario de la conexión y permiso instagram_manage_insights). Una cuenta
//   personal responde «no encontrada»: se marca personal, sin seguidores.
// - Facebook en comentarios: si quien comenta es una página, se ven sus seguidores (requiere el permiso
//   Page Public Content Access de App Review; sin él no se sabe). De una persona, nada.
// - Messenger: Meta no da seguidores ni verificación.
export type Profile = { username?: string | null; followers?: number | null; verified?: boolean | null; accountType?: "personal" | "empresa_creador" | "pagina" | "persona" | null; bio?: string | null };

export async function fetchIgDmProfile(igsid: string, pageToken: string): Promise<Profile | null> {
  try {
    const u = await graph<any>(igsid, { fields: "username,follower_count,is_verified_user", access_token: pageToken });
    return { username: u.username ?? null, followers: typeof u.follower_count === "number" ? u.follower_count : null, verified: typeof u.is_verified_user === "boolean" ? u.is_verified_user : null };
  } catch {
    return null;
  }
}

export async function fetchIgBusinessProfile(ownIgId: string, username: string, userToken: string): Promise<Profile | null> {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  try {
    const r = await graph<any>(ownIgId, { fields: `business_discovery.username(${username}){followers_count,biography}`, access_token: userToken });
    const b = r.business_discovery ?? {};
    return { followers: typeof b.followers_count === "number" ? b.followers_count : null, bio: b.biography ?? null, accountType: "empresa_creador" };
  } catch (e) {
    if (e instanceof MetaError && (e.subcode === 2207013 || /cannot find user/i.test(e.message))) return { accountType: "personal" };
    return null; // sin permiso o error de Meta: no se sabe
  }
}

export async function fetchFbAuthorProfile(fromId: string, pageToken: string): Promise<Profile | null> {
  try {
    const p = await graph<any>(fromId, { fields: "followers_count", access_token: pageToken });
    return typeof p.followers_count === "number" ? { followers: p.followers_count, accountType: "pagina" } : { accountType: "persona" };
  } catch {
    // Sin el permiso «Page Public Content Access» Meta no deja leer otras páginas (#10), y a las páginas
    // nuevas tampoco las encuentra por id (#100): un error no dice si es persona o página. No se sabe.
    return null;
  }
}

export const PROFILES = { igDm: fetchIgDmProfile, igBusiness: fetchIgBusinessProfile, fbAuthor: fetchFbAuthorProfile };

// Tipo de pieza en palabras del equipo, a partir de lo que manda Meta.
export function postType(platform: "fb" | "ig", raw: { status_type?: string; permalink?: string | null; media_type?: string; media_product_type?: string }) {
  if (platform === "fb") {
    if (raw.permalink?.includes("/reel/")) return "reel";
    return ({ added_video: "video", added_photos: "foto", mobile_status_update: "estado", shared_story: "compartido", created_event: "evento" } as Record<string, string>)[raw.status_type ?? ""] ?? null;
  }
  const product = raw.media_product_type?.toUpperCase();
  if (product === "REELS") return "reel";
  if (product === "STORY") return "historia";
  if (product === "AD") return "anuncio";
  return ({ CAROUSEL_ALBUM: "carrusel", VIDEO: "video", IMAGE: "foto" } as Record<string, string>)[raw.media_type?.toUpperCase() ?? ""] ?? null;
}

// Datos de una publicación para el Resumen.
export async function fetchPost(platform: "fb" | "ig", id: string, token: string) {
  if (platform === "fb") {
    const p = await graph<any>(id, { fields: "permalink_url,status_type,message,created_time,is_published,is_inline_created", access_token: token });
    return {
      type: postType("fb", { status_type: p.status_type, permalink: p.permalink_url }), origin: postOrigin("fb", p),
      permalink: p.permalink_url ?? null, caption: p.message ?? null, publishedAt: p.created_time ? new Date(p.created_time) : null,
    };
  }
  const p = await graph<any>(id, { fields: "permalink,media_type,media_product_type,caption,timestamp", access_token: token });
  return { type: postType("ig", p), origin: postOrigin("ig", p), permalink: p.permalink ?? null, caption: p.caption ?? null, publishedAt: p.timestamp ? new Date(p.timestamp) : null };
}

export type PostOrigin = "organica" | "pautada" | "anuncio";

// De dónde sale una publicación, para responder solo lo orgánico (Meta, 2026-10):
// - Facebook: un anuncio que no salió en la página tiene is_published = false o is_inline_created.
//   Una publicación orgánica que se pauta es la misma publicación, con los mismos comentarios; el
//   webhook puede traer promotion_status (no está en la referencia de Post v26: es una señal).
//   Mientras está pautada, sus comentarios nuevos no se responden (decisión de Imderf, 2026-10-26).
// - Instagram: el comentario en un anuncio trae media.ad_id, o el media es de tipo AD.
// Null si no hay con qué saberlo.
export function postOrigin(platform: "fb" | "ig", raw: { is_published?: boolean; is_inline_created?: boolean; promotion_status?: string; media_product_type?: string; ad_id?: string }): PostOrigin | null {
  if (platform === "fb") {
    if (raw.is_published === false || raw.is_inline_created === true) return "anuncio";
    if (raw.promotion_status === "active") return "pautada";
    return raw.is_published === true ? "organica" : null;
  }
  if (raw.ad_id || raw.media_product_type?.toUpperCase() === "AD") return "anuncio";
  return raw.media_product_type ? "organica" : null;
}

// Lee todas las páginas de un listado de la Graph API hasta que `stop` diga basta.
export async function graphPages<T>(path: string, params: Record<string, string>, stop: (item: T) => boolean = () => false, max = 40) {
  const out: T[] = [];
  let next: string | null = `https://graph.facebook.com/${version()}/${path}?${new URLSearchParams(params)}`;
  for (let page = 0; next && page < max; page++) {
    const res: Response = await fetch(next, { signal: AbortSignal.timeout(20_000) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new MetaError(json.error?.message ?? `Graph API respondió ${res.status}`, json.error?.code);
    for (const item of json.data ?? []) {
      if (stop(item)) return out;
      out.push(item);
    }
    next = json.paging?.next ?? null;
  }
  return out;
}

// Acciones que publican en Meta. Solo las llama el trabajo "publish" (src/lib/publish.ts), después
// de que una persona aprobó o de que el tipo de caso ya responde solo. Devuelven el id que da Meta.
export async function replyToComment(platform: "fb" | "ig", commentId: string, message: string, token: string) {
  const r = await graph<{ id: string }>(platform === "fb" ? `${commentId}/comments` : `${commentId}/replies`, { message, access_token: token }, "POST");
  return r.id;
}

export async function hideComment(platform: "fb" | "ig", commentId: string, token: string) {
  await graph(commentId, { [platform === "fb" ? "is_hidden" : "hide"]: "true", access_token: token }, "POST");
  return null;
}

// DM dentro de la ventana de 24 h (Messenger e Instagram, con el token de la página). Pasadas las
// 24 h y hasta 7 días, solo una persona, con la etiqueta HUMAN_AGENT (permiso Human Agent de App Review).
export async function sendMessage(pageId: string, recipientId: string, text: string, token: string, tag?: "HUMAN_AGENT") {
  const r = await graph<{ message_id: string }>(`${pageId}/messages`, {
    recipient: JSON.stringify({ id: recipientId }),
    message: JSON.stringify({ text }),
    ...(tag ? { messaging_type: "MESSAGE_TAG", tag } : { messaging_type: "RESPONSE" }),
    access_token: token,
  }, "POST");
  return r.message_id;
}

// Suscribe la página a los webhooks de la app (comentarios, menciones y mensajes).
export async function subscribePage(pageId: string, pageToken: string) {
  await graph(`${pageId}/subscribed_apps`, { subscribed_fields: SUBSCRIBED_FIELDS, access_token: pageToken }, "POST");
}
