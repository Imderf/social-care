-- Modo prueba: al conectar, una cuenta analiza y propone, pero no publica nada en Meta.
-- El equipo sigue respondiendo desde Meta Business Suite; la plataforma guarda lo que la IA
-- habría hecho y lo que respondió el equipo, y las personas verifican las propuestas.
-- Un tipo de caso pasa a responder de verdad solo cuando se activa a mano (live_enabled)
-- en una cuenta en vivo.

ALTER TABLE accounts
  ADD COLUMN mode ENUM('prueba', 'en_vivo') NOT NULL DEFAULT 'prueba' AFTER status;

ALTER TABLE case_types
  ADD COLUMN live_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER active;

ALTER TABLE interactions
  ADD COLUMN mode ENUM('prueba', 'en_vivo') NOT NULL DEFAULT 'prueba' AFTER decision,
  ADD COLUMN proposed_reply TEXT NULL AFTER mode, -- lo que la IA respondería (en vivo: lo que publicó)
  ADD COLUMN proposed_template VARCHAR(20) NULL AFTER proposed_reply,
  ADD COLUMN human_reply TEXT NULL AFTER proposed_template; -- lo que respondió el equipo (llega por webhook)

-- Una verificación por interacción; volver a marcarla la reemplaza.
CREATE TABLE verifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  interaction_id BIGINT UNSIGNED NOT NULL,
  verdict ENUM('correcta', 'corregir', 'incorrecta') NOT NULL,
  note TEXT NULL,
  user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY verifications_interaction (interaction_id),
  KEY verifications_client (client_id, created_at),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (interaction_id) REFERENCES interactions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4;
