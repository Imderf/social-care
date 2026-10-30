-- Rol «colaborador»: todo lo del cliente asignado (Bandeja, Pruebas y configuración), sin Clientes ni Usuarios.
-- Las personas ya creadas conservan su rol; la administración puede cambiarlo desde Usuarios.
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin', 'operador', 'verificador', 'colaborador') NOT NULL DEFAULT 'admin';
ALTER TABLE client_members
  MODIFY COLUMN role ENUM('admin', 'operador', 'verificador', 'colaborador') NOT NULL;
