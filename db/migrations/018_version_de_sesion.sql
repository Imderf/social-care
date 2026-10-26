-- Cambiar la contraseña sube la versión y cierra las sesiones abiertas de ese usuario.
ALTER TABLE users ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 1;
