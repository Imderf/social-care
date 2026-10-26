-- Preguntas cuya respuesta depende del caso (pedido de Imderf, 2026-10-26: «¿hacen domicilio?» no
-- se responde igual si es la dispensación de la EPS o una compra, ni en todas las ciudades).
-- Cada plantilla dice cuándo se usa, y la base de conocimiento tiene la cobertura por ciudad.
ALTER TABLE templates ADD COLUMN when_to_use VARCHAR(500) NULL AFTER body;
ALTER TABLE knowledge_items MODIFY topic ENUM('sede', 'horario', 'festivo', 'enlace', 'requisito', 'cobertura') NOT NULL;
