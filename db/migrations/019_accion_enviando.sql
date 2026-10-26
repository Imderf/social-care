-- «enviando»: el worker ya llamó a Meta. Si se cae o Meta no contesta, no se sabe si salió: no se
-- reintenta solo (evita respuestas públicas duplicadas); lo revisa una persona.
ALTER TABLE actions MODIFY status ENUM('pendiente', 'enviando', 'hecha', 'fallida') NOT NULL DEFAULT 'pendiente';
