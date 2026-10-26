-- Cuántas veces el equipo pidió a la IA otra propuesta para la misma interacción. Si la pidió, el
-- borrador original no servía: al aceptar cuenta como corrección, no como correcta.
ALTER TABLE interactions ADD COLUMN ai_redrafts INT NOT NULL DEFAULT 0 AFTER proposed_template;
