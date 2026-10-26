-- Palabras o frases que ninguna respuesta puede llevar (pedido del equipo de cuentas y social media
-- en la presentación del 2026-10-24). Van en `lists` con su alternativa opcional.
ALTER TABLE lists
  MODIFY kind ENUM('competidor', 'vigilancia', 'crisis', 'prohibida') NOT NULL,
  ADD COLUMN note VARCHAR(255) NULL AFTER value,
  ADD COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
