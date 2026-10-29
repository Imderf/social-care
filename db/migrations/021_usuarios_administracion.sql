-- Administración de usuarios: rol, estado, cambio obligatorio de contraseña y registro de lo que hace la administración.
-- Los usuarios que ya existían quedan como administradores (hasta hoy todos lo eran).
ALTER TABLE users
  ADD COLUMN role ENUM('admin', 'operador', 'verificador') NOT NULL DEFAULT 'admin' AFTER password_hash,
  ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER role,
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER active,
  ADD COLUMN last_login_at TIMESTAMP(3) NULL AFTER must_change_password;

-- Quién creó, restableció, cambió o desactivó a quién. Sin contraseñas ni datos sensibles.
CREATE TABLE user_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT UNSIGNED NULL,
  target_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  detail VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY user_events_created (created_at),
  FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (target_id) REFERENCES users (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4;
