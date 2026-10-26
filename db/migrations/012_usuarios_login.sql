-- Ingreso al panel con usuario y contraseña (scrypt). El correo deja de ser obligatorio.
ALTER TABLE users
  ADD COLUMN username VARCHAR(60) NULL UNIQUE AFTER id,
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER name,
  MODIFY email VARCHAR(255) NULL;
