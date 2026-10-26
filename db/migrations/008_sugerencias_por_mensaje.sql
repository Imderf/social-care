-- Las sugerencias para la base salen de las correcciones y de las respuestas del equipo en Meta, así
-- que "descartada" se marca en la interacción, como learning_excluded.
ALTER TABLE interactions ADD COLUMN kb_dismissed BOOLEAN NOT NULL DEFAULT FALSE AFTER learning_excluded;
UPDATE interactions i JOIN verifications v ON v.interaction_id = i.id SET i.kb_dismissed = TRUE WHERE v.kb_dismissed;
ALTER TABLE verifications DROP COLUMN kb_dismissed;
