import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "../src/lib/crypto.ts";
import { maskPersonalData } from "../src/lib/mask.ts";

const KEY = randomBytes(32).toString("base64");

test("cifra y descifra un token; un token alterado o con otra llave falla", () => {
  const stored = encryptToken("EAAB-token-de-pagina", KEY);
  assert.notEqual(stored, "EAAB-token-de-pagina");
  assert.ok(!stored.includes("EAAB"));
  assert.equal(decryptToken(stored, KEY), "EAAB-token-de-pagina");
  assert.notEqual(encryptToken("x", KEY), encryptToken("x", KEY), "cada cifrado usa un iv nuevo");

  const [v, iv, tag, data] = stored.split(".");
  const tampered = [v, iv, tag, data.slice(0, -2) + (data.endsWith("A") ? "BB" : "AA")].join(".");
  assert.throws(() => decryptToken(tampered, KEY));
  assert.throws(() => decryptToken(stored, randomBytes(32).toString("base64")));
  assert.throws(() => encryptToken("x", "corta"), /32 bytes/);
});

test("enmascara documentos, celulares, correos y direcciones", () => {
  const cases: [string, string][] = [
    ["Mi cédula es 1234567890 y mi cel 3001234567", "Mi cédula es [documento] y mi cel [celular]"],
    ["CC 1.023.456.789, llámenme al 300 123 4567", "CC [documento], llámenme al [celular]"],
    ["escríbanme a maria.perez+cafam@gmail.com", "escríbanme a [correo]"],
    ["+57 310-555-1234", "[celular]"],
    ["vivo en la Calle 45 # 12-30 apto 2", "vivo en la [dirección] apto 2"],
    ["Cra 7 No. 32-16", "[dirección]"],
  ];
  for (const [input, expected] of cases) assert.equal(maskPersonalData(input), expected, input);
});

test("no toca fechas, horas, montos cortos ni emojis", () => {
  for (const text of ["Tengo cita el 12 de octubre a las 3:30", "Vale $25.000", "Llevo 15 días", "💙👍", "¿Atienden el 20/10?"]) {
    assert.equal(maskPersonalData(text), text);
  }
});

test("formatos con espacios, comas o «Sur» también se enmascaran; la línea fija queda como teléfono", () => {
  const cases: [string, string][] = [
    ["CC 1 234 567 890", "CC [documento]"],
    ["mi cédula 52,345,678", "mi cédula [documento]"],
    ["llámame al 300-123-45-67", "llámame al [celular]"],
    ["Llamé a la línea 6013077000 y nadie contesta", "Llamé a la línea [teléfono] y nadie contesta"],
    ["fijo (601) 234 5678", "fijo [teléfono]"],
    ["Vivo en la Calle 45 Sur # 12-34", "Vivo en la [dirección]"],
    ["Cra. 7 Bis A # 45-10", "[dirección]"],
  ];
  for (const [input, expected] of cases) assert.equal(maskPersonalData(input), expected, input);
});

test("pedidos, guías, NIT, precios, fechas y dosis no son datos de la persona", () => {
  for (const text of [
    "Mi pedido 12345678 no ha llegado",
    "Guía 700012345678 sin movimiento",
    "NIT 860.013.570-6",
    "Me cobraron 1.250.000 pesos",
    "Vale $1.250.000",
    "Vale $ 1.250.000",
    "Me costó 125.000",
    "Desde el 26-10-2026",
    "La fórmula dice 1000 mg cada 8 horas",
  ]) assert.equal(maskPersonalData(text), text);
});
