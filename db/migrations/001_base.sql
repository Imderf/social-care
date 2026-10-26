-- Base multicliente, eventos crudos de Meta y cola de trabajos (MySQL 8).
-- Las tablas de negocio (accounts, interactions, actions…) llegan en el sprint 1.
-- Sin RLS en MySQL: toda consulta a tablas de negocio filtra por client_id en el código.

CREATE TABLE clients (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  settings JSON NOT NULL DEFAULT (JSON_OBJECT()), -- zona horaria, horario de atención, % de muestreo
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) DEFAULT CHARSET = utf8mb4; -- tildes y emojis en comentarios

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) DEFAULT CHARSET = utf8mb4;

CREATE TABLE client_members (
  client_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('admin', 'operador', 'verificador') NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (client_id, user_id),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4;

-- Meta reintenta con el mismo cuerpo, así que la llave es el sha256 del cuerpo.
-- La idempotencia por id de comentario o mensaje la hace el worker. Se purgan a los 7 días.
CREATE TABLE webhook_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dedupe_key CHAR(64) NOT NULL UNIQUE,
  meta_object VARCHAR(20) NULL, -- page | instagram
  payload JSON NOT NULL,
  received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at TIMESTAMP(3) NULL,
  KEY webhook_events_received (received_at)
) DEFAULT CHARSET = utf8mb4;

-- Cola: se toma con FOR UPDATE SKIP LOCKED (src/lib/queue.ts).
CREATE TABLE jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  payload JSON NOT NULL DEFAULT (JSON_OBJECT()),
  status ENUM('pending', 'running', 'done', 'dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  run_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at TIMESTAMP(3) NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY jobs_ready (status, run_at)
) DEFAULT CHARSET = utf8mb4;
