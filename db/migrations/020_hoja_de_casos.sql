-- Hoja de casos (Google Sheets), fase A: leer la Hoja que llena el equipo y avisar a la persona
-- cuando su caso cambia a un estado que avisa (decisiones de Imderf, 2026-10-27).

-- Cuenta de Google de cada cliente (login con Google, permiso drive.file: solo la Hoja que se elige
-- en el selector de Google). El token de renovación va cifrado, como los de Meta.
CREATE TABLE google_connections (
  client_id BIGINT UNSIGNED PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  spreadsheet_id VARCHAR(100) NULL,
  spreadsheet_name VARCHAR(255) NULL,
  connected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_sync_at TIMESTAMP(3) NULL,
  last_sync_summary VARCHAR(255) NULL,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

-- Una fila por caso de la Hoja que es de una persona que escribió por los canales elegidos.
-- Solo lo necesario para avisar: número, perfil, estado y resultado (enmascarado). Nada de cédulas.
CREATE TABLE sheet_cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  tab VARCHAR(100) NOT NULL,
  case_number VARCHAR(50) NOT NULL,
  profile VARCHAR(255) NULL,
  contact_id BIGINT UNSIGNED NULL,
  status VARCHAR(100) NULL,
  result TEXT NULL,
  first_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  status_changed_at TIMESTAMP(3) NULL,
  UNIQUE KEY sheet_cases_case (client_id, tab, case_number),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4;

-- Aviso a la persona cuando su caso llega a un estado que avisa. Uno por caso y estado.
-- enviar: dentro de 24 h, sale solo · bandeja: entre 24 h y 7 días, lo envía una persona como agente
-- humano · esperando: más de 7 días, sale cuando la persona vuelva a escribir · sin_dm: nunca escribió
-- por DM · enviando / enviado / fallido: el envío.
CREATE TABLE case_notices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  sheet_case_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(100) NOT NULL,
  text TEXT NOT NULL,
  delivery ENUM('enviar', 'enviando', 'enviado', 'fallido', 'bandeja', 'esperando', 'sin_dm') NOT NULL,
  interaction_id BIGINT UNSIGNED NULL, -- el DM de la persona por donde sale el aviso
  escalation_id BIGINT UNSIGNED NULL, -- la tarjeta de la Bandeja, si lo envía una persona
  meta_response_id VARCHAR(100) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at TIMESTAMP(3) NULL,
  UNIQUE KEY case_notices_once (sheet_case_id, status),
  KEY case_notices_delivery (client_id, delivery),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (sheet_case_id) REFERENCES sheet_cases (id) ON DELETE CASCADE,
  FOREIGN KEY (interaction_id) REFERENCES interactions (id) ON DELETE SET NULL,
  FOREIGN KEY (escalation_id) REFERENCES escalations (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4;
