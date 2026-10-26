import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isValidSignature } from "../src/lib/meta-signature.ts";

const secret = "app-secret";
const body = Buffer.from('{"object":"page","entry":[{"id":"1","changes":[{"field":"feed"}]}]}');
const sign = (b: Buffer, s = secret) => "sha256=" + createHmac("sha256", s).update(b).digest("hex");

test("acepta la firma correcta", () => {
  assert.equal(isValidSignature(body, sign(body), secret), true);
});

test("rechaza cuerpo alterado, otra llave, encabezado ausente o sin secreto configurado", () => {
  assert.equal(isValidSignature(Buffer.from(body.toString() + " "), sign(body), secret), false);
  assert.equal(isValidSignature(body, sign(body, "otra"), secret), false);
  assert.equal(isValidSignature(body, null, secret), false);
  assert.equal(isValidSignature(body, "sha1=abc", secret), false);
  assert.equal(isValidSignature(body, sign(body), undefined), false);
});
