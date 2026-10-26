-- La matriz se arma por selecciones (decisión de Imderf, 2026-10-23): el flujo de cada tipo de caso
-- se guarda estructurado y de ahí se derivan public_action, private_action, record_target y alert,
-- que siguen siendo lo que leen la tabla y la IA. NULL = se infiere del texto anterior al editar.
ALTER TABLE case_types ADD COLUMN flow JSON NULL AFTER alert;
