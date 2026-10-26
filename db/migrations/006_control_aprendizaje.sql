-- Control del equipo sobre lo que aprende la IA (2026-10-23):
--   learning_excluded: el equipo quitó este ejemplo; la IA deja de recibirlo (el acierto no cambia).
--   kb_dismissed: el equipo descartó la sugerencia de llevar a la base un dato de esta corrección.
ALTER TABLE verifications
  ADD COLUMN learning_excluded BOOLEAN NOT NULL DEFAULT FALSE AFTER corrected_reply,
  ADD COLUMN kb_dismissed BOOLEAN NOT NULL DEFAULT FALSE AFTER learning_excluded;
