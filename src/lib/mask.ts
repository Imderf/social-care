// Enmascarado de datos personales antes de guardar el texto y antes de mandarlo a la IA.
// El orden importa: primero correos y teléfonos, después los números largos (documentos).
// [teléfono] (fijo) no hace ocultar el comentario: suele ser la línea de la marca.
const RULES: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]"],
  [/(?<!\d)(\+?57[\s.-]?)?3\d{2}(?:[\s.-]?\d){7}(?!\d)/g, "[celular]"], // 310 555 1234, 300-123-45-67
  [/(?<!\d)(\+?57[\s.-]?)?\(?60\d\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, "[teléfono]"], // (601) 234 5678, 6013077000
  // 1.234.567.890, 52,345,678, 1 234 567 890. No toca precios: «$1.250.000», «1.250.000 pesos», «125.000».
  [/(?<!\$\s?)(?<![\d$])\d{1,3}([.,\s]\d{3}){2,3}(?!\d)(?!\s*(pesos|cop|mil)\b)/gi, "[documento]"],
  [/(?<!\$\s?)(?<![\d$])\d{6,10}(?!\d)(?!\s*(pesos|cop|mil)\b)/gi, "[documento]"],
  [/\b(calle|cll|cl|carrera|cra|kr|kra|avenida|av|diagonal|dg|transversal|tv)\.?\s*\d+\s*[a-z]?(\s*\b(bis|sur|norte|este|oeste)\b\s*[a-z]?\b)*\s*(#|no\.?|n°)\s*\d+\s*[a-z]?\s*-\s*\d+/gi, "[dirección]"],
];
// Un número con su contexto (pedido, guía, radicado, factura, NIT) no es un dato de la persona.
const KEEP = /\b(pedido|orden|factura|gu[ií]a|radicado|referencia|nit|c[oó]digo)\b[\s.:#°ºnNoO]*\d[\d.-]*\d/gi;

const mask = (text: string) => RULES.reduce((t, [re, label]) => t.replace(re, label), text);

export function maskPersonalData(text: string) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(KEEP)) {
    out += mask(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + mask(text.slice(last));
}
