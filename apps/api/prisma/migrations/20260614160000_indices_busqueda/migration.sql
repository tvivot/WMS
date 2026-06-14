-- Índices para evitar filesort en los listados ordenados por nombre y para
-- acotar el informe de serie temporal por fecha de creación.
CREATE INDEX `core_usuario_nombre_idx` ON `core_usuario`(`nombre`);
CREATE INDEX `core_cliente_nombre_idx` ON `core_cliente`(`nombre`);
CREATE INDEX `dev_autorizacion_created_at_idx` ON `dev_autorizacion`(`created_at`);
