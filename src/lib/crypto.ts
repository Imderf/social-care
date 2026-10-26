import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Tokens de Meta cifrados en la base con AES-256-GCM. La llave (32 bytes en base64) vive solo en
// TOKEN_ENCRYPTION_KEY. Formato guardado: v1.<iv>.<tag>.<cifrado>, todo en base64url.

function key(raw = process.env.TOKEN_ENCRYPTION_KEY) {
  const k = Buffer.from(raw ?? "", "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32)");
  return k;
}

export function encryptToken(plain: string, rawKey?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptToken(stored: string, rawKey?: string) {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Token cifrado con formato desconocido");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
