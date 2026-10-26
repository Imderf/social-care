-- Historial al conectar, sentimiento y publicaciones (decisiones de Imderf, 2026-10-23).
--
-- Al conectar una cuenta se elige si traer los últimos 30 días o solo lo nuevo:
--   * lo que el equipo ya respondió sirve para aprender (su respuesta es un ejemplo) y para medir;
--   * lo no respondido de los últimos 7 días (comentarios) o dentro de la ventana de 24 h (DM) va a
--     Pruebas para responderlo;
--   * lo más antiguo queda solo para análisis (analysis_only): nunca se propone publicar.
ALTER TABLE interactions
  ADD COLUMN source ENUM('webhook', 'historial') NOT NULL DEFAULT 'webhook' AFTER mode,
  ADD COLUMN analysis_only BOOLEAN NOT NULL DEFAULT FALSE AFTER source,
  ADD COLUMN sentiment ENUM('positivo', 'neutral', 'negativo') NULL AFTER signals,
  ADD COLUMN learning_excluded BOOLEAN NOT NULL DEFAULT FALSE AFTER ai_redrafts;

ALTER TABLE accounts ADD COLUMN backfilled_at TIMESTAMP(3) NULL AFTER live_since;

-- El ejemplo que se quita es la interacción (puede venir de una revisión o de una respuesta del
-- equipo en Meta), así que la marca pasa de verifications a interactions.
UPDATE interactions i JOIN verifications v ON v.interaction_id = i.id SET i.learning_excluded = TRUE WHERE v.learning_excluded;
ALTER TABLE verifications DROP COLUMN learning_excluded;

-- Publicaciones en las que se comenta: tipo de pieza, enlace y texto, para el Resumen.
CREATE TABLE posts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  meta_id VARCHAR(100) NOT NULL,
  type VARCHAR(40) NULL, -- reel, video, foto, carrusel, historia, estado, compartido, anuncio
  permalink VARCHAR(500) NULL,
  caption VARCHAR(300) NULL,
  published_at TIMESTAMP(3) NULL,
  fetched_at TIMESTAMP(3) NULL,
  UNIQUE KEY posts_meta (account_id, meta_id),
  KEY posts_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;
