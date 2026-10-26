-- Etapas de una cuenta (decisión de Imderf, 2026-10-23):
--   1. prueba: la IA analiza y propone; no publica nada.
--   2. asistido (accounts.mode = 'en_vivo'): la IA propone y una persona acepta o corrige; al aceptar,
--      la plataforma publica en Meta.
--   3. automático, por tipo de caso: el tipo responde solo (case_types.live_enabled) cuando pasan los
--      días de aprendizaje del cliente (clients.settings.learning_days, 7 por defecto) desde live_since
--      y llega al 90 % de acierto con al menos 20 verificaciones. Si el acierto baja, vuelve a pedir
--      aprobación. Ya no se activa a mano.
ALTER TABLE accounts ADD COLUMN live_since TIMESTAMP(3) NULL AFTER mode;

-- Lo que publicó la persona cuando corrigió el borrador: es el ejemplo del que aprende la IA.
ALTER TABLE verifications ADD COLUMN corrected_reply TEXT NULL AFTER note;

-- Una acción de cada tipo por interacción: aprobar dos veces no publica dos veces.
ALTER TABLE actions ADD UNIQUE KEY actions_once (interaction_id, type);
