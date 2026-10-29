-- Google Business Profile: las reseñas de las sedes entran como interacciones de tipo «resena».
-- Cada sede es una cuenta (plataforma `gbp`) y el permiso de Google (token de renovación, cifrado) vive por cliente.
-- Los tipos de caso y las plantillas llevan a qué canal aplican: las de reseñas no se mezclan con las de redes.

ALTER TABLE accounts MODIFY platform ENUM('fb', 'ig', 'gbp') NOT NULL;
ALTER TABLE contacts MODIFY platform ENUM('fb', 'ig', 'gbp') NOT NULL;
ALTER TABLE interactions MODIFY kind ENUM('comentario', 'dm', 'resena') NOT NULL, ADD COLUMN rating TINYINT UNSIGNED NULL AFTER text_masked;
ALTER TABLE case_types ADD COLUMN applies_to ENUM('redes', 'resenas') NOT NULL DEFAULT 'redes' AFTER active;
ALTER TABLE templates ADD COLUMN applies_to ENUM('redes', 'resenas') NOT NULL DEFAULT 'redes' AFTER active;

-- Cuenta de Google que administra las fichas (login con Google, permiso business.manage).
CREATE TABLE gbp_connections (
  client_id BIGINT UNSIGNED PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  connected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_sync_at TIMESTAMP(3) NULL,
  last_sync_summary VARCHAR(255) NULL,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;
