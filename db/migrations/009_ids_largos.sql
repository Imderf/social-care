-- Los id de los DM de Instagram superan los 100 caracteres.
ALTER TABLE interactions MODIFY meta_id VARCHAR(255) NOT NULL;
ALTER TABLE actions MODIFY meta_response_id VARCHAR(255) NULL;
