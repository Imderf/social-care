-- Configuración por cliente (matriz, plantillas, base de conocimiento, listas) y operación
-- (cuentas, contactos, interacciones, acciones, escalamientos). Toda tabla lleva client_id.
-- Conversaciones de DM, casos, verificaciones y bitácora llegan en el sprint 3.

CREATE TABLE case_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  position INT NOT NULL,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  examples JSON NOT NULL DEFAULT (JSON_ARRAY()),
  autonomy ENUM('automatica', 'humana', 'escala') NOT NULL,
  threshold DECIMAL(3, 2) NOT NULL DEFAULT 0.85,
  public_action TEXT NULL,
  private_action TEXT NULL,
  record_target TEXT NULL,
  alert TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY case_types_code (client_id, code),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

-- Variables en el texto: {usuario} (respuesta pública) y {nombre} (DM).
CREATE TABLE templates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(200) NOT NULL,
  channel ENUM('publico', 'dm') NOT NULL,
  body TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY templates_code (client_id, code, channel, version),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

-- Lo único de donde la IA saca datos puntuales (sedes, horarios, festivos, enlaces, requisitos).
CREATE TABLE knowledge_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  topic ENUM('sede', 'horario', 'festivo', 'enlace', 'requisito') NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  valid_until DATE NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

CREATE TABLE lists (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('competidor', 'vigilancia', 'crisis') NOT NULL,
  value VARCHAR(255) NOT NULL,
  UNIQUE KEY lists_value (client_id, kind, value),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

-- Página de Facebook o Instagram profesional conectada. El token va cifrado (AES-256-GCM).
CREATE TABLE accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('fb', 'ig') NOT NULL,
  meta_id VARCHAR(64) NOT NULL, -- id de la página o del usuario de Instagram
  page_id VARCHAR(64) NULL, -- página vinculada (para Instagram)
  name VARCHAR(200) NOT NULL,
  token_encrypted TEXT NULL,
  status ENUM('conectada', 'error', 'desconectada') NOT NULL DEFAULT 'conectada',
  last_webhook_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY accounts_meta (platform, meta_id),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

CREATE TABLE contacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('fb', 'ig') NOT NULL,
  meta_user_id VARCHAR(64) NOT NULL, -- PSID / IGSID / id del comentarista
  username VARCHAR(200) NULL,
  followers INT NULL,
  verified BOOLEAN NULL,
  flags JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY contacts_meta (client_id, platform, meta_user_id),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

-- Un comentario o DM. El texto se guarda enmascarado; la idempotencia es por id de Meta.
CREATE TABLE interactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('comentario', 'dm') NOT NULL,
  meta_id VARCHAR(100) NOT NULL,
  post_id VARCHAR(100) NULL,
  permalink VARCHAR(500) NULL,
  contact_id BIGINT UNSIGNED NULL,
  text_masked TEXT NULL,
  case_type_id BIGINT UNSIGNED NULL,
  confidence DECIMAL(4, 3) NULL,
  signals JSON NULL,
  decision ENUM('responder', 'escalar', 'ocultar', 'ignorar') NULL,
  answered_by ENUM('ia', 'persona') NULL,
  received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  first_response_at TIMESTAMP(3) NULL,
  window_expires_at TIMESTAMP(3) NULL,
  UNIQUE KEY interactions_meta (account_id, meta_id),
  KEY interactions_received (client_id, received_at),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL,
  FOREIGN KEY (case_type_id) REFERENCES case_types (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4;

CREATE TABLE actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  interaction_id BIGINT UNSIGNED NOT NULL,
  type ENUM('responder', 'ocultar', 'me_gusta', 'respuesta_privada', 'dm', 'registrar', 'subir') NOT NULL,
  payload JSON NOT NULL DEFAULT (JSON_OBJECT()),
  status ENUM('pendiente', 'hecha', 'fallida') NOT NULL DEFAULT 'pendiente',
  meta_response_id VARCHAR(100) NULL,
  actor ENUM('ia', 'persona') NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY actions_interaction (interaction_id),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (interaction_id) REFERENCES interactions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4;

CREATE TABLE escalations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  interaction_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  priority ENUM('critica', 'alta', 'normal') NOT NULL DEFAULT 'normal',
  assigned_to BIGINT UNSIGNED NULL,
  suggested_draft TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at TIMESTAMP(3) NULL,
  KEY escalations_open (client_id, resolved_at),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (interaction_id) REFERENCES interactions (id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4;
