-- Perfil de quien escribe (pedido de Imderf, 2026-10-26): tipo de cuenta, biografía y cuándo se
-- consultó, para clasificar persona del común o influenciador. accounts guarda el token de usuario
-- del sistema de la conexión, que pide Business Discovery de Instagram.
ALTER TABLE contacts
  ADD COLUMN account_type ENUM('personal', 'empresa_creador', 'pagina', 'persona') NULL AFTER verified,
  ADD COLUMN bio VARCHAR(500) NULL AFTER account_type,
  ADD COLUMN profile_checked_at TIMESTAMP(3) NULL AFTER bio;
ALTER TABLE accounts ADD COLUMN user_token_encrypted TEXT NULL AFTER token_encrypted;
