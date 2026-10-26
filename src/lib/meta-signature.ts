import { createHmac, timingSafeEqual } from "node:crypto";

// Meta firma cada POST de webhook con HMAC SHA-256 del cuerpo crudo y el App Secret:
// encabezado X-Hub-Signature-256: sha256=<hex>.
export function isValidSignature(body: Buffer, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const received = Buffer.from(header.slice("sha256=".length));
  return received.length === expected.length && timingSafeEqual(received, expected);
}
