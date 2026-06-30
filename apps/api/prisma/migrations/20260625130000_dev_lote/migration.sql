-- Lotes de devolución importados del ERP (Fierro) por el integrador, vía
-- DevolucionesLotePort. Identidad por `codigo` (= return_lot.document_id):
-- idempotente (upsert por codigo que reemplaza renglones). Referencias al núcleo
-- por código, sin FK cruzada. Fechas guardadas tal cual las manda Fierro (string).

CREATE TABLE `dev_lote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(60) NOT NULL,
    `numero` VARCHAR(60) NULL,
    `fecha` VARCHAR(40) NULL,
    `nro_cliente` VARCHAR(40) NOT NULL,
    `cliente_nombre` VARCHAR(200) NULL,
    `deposito` VARCHAR(150) NULL,
    `estado` VARCHAR(60) NULL,
    `motivo` VARCHAR(200) NULL,
    `remito_cliente` VARCHAR(60) NULL,
    `fecha_remito_cliente` VARCHAR(40) NULL,
    `total_items` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dev_lote_codigo_key`(`codigo`),
    INDEX `dev_lote_nro_cliente_idx`(`nro_cliente`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `dev_lote_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lote_id` INTEGER NOT NULL,
    `isbn` VARCHAR(20) NOT NULL,
    `cantidad` INTEGER NOT NULL,
    `cantidad_cliente` INTEGER NULL,
    `cantidad_rechazada` INTEGER NULL,
    `titulo` VARCHAR(300) NULL,
    `int_code` VARCHAR(60) NULL,

    INDEX `dev_lote_item_lote_id_idx`(`lote_id`),
    UNIQUE INDEX `dev_lote_item_lote_id_isbn_key`(`lote_id`, `isbn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `dev_lote_item`
    ADD CONSTRAINT `dev_lote_item_lote_id_fk` FOREIGN KEY (`lote_id`) REFERENCES `dev_lote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
