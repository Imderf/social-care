-- Solo se responde lo orgánico (pedido del equipo de cuentas y social media, 2026-10-24). Origen de
-- cada publicación: orgánica, orgánica pautada (la misma publicación con pauta encima) o anuncio
-- que no salió en la página. Los comentarios en anuncios quedan solo para análisis.
ALTER TABLE posts ADD COLUMN origin ENUM('organica', 'pautada', 'anuncio') NULL AFTER type;
