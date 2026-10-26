-- Puntos de dispensación por ciudad (pedido de Imderf, 2026-10-26): un dato por ciudad en la base
-- de conocimiento, que la IA usa con la plantilla de dispensación de la ciudad.
ALTER TABLE knowledge_items MODIFY topic ENUM('sede', 'horario', 'festivo', 'enlace', 'requisito', 'cobertura', 'dispensacion') NOT NULL;
