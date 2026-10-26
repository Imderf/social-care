-- Los clientes se archivan, no se borran: salen del selector y quedan en Clientes para restaurarlos.
ALTER TABLE clients ADD COLUMN archived_at TIMESTAMP(3) NULL AFTER settings;
