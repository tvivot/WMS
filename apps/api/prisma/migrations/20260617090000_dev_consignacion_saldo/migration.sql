-- Saldo en consignación por cliente + ISBN, importado del ERP (integrador).
-- Insumo de la reconciliación de devoluciones; referencias al núcleo por ID
-- (sin FK cruzada). Full-replace por cliente en cada snapshot.
CREATE TABLE `dev_consignacion_saldo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cliente_id` INTEGER NOT NULL,
    `isbn` VARCHAR(20) NOT NULL,
    `producto_id` INTEGER NULL,
    `cantidad` INTEGER NOT NULL,
    `snapshot_ts` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dev_consignacion_saldo_cliente_id_idx`(`cliente_id`),
    INDEX `dev_consignacion_saldo_isbn_idx`(`isbn`),
    UNIQUE INDEX `cliente_isbn`(`cliente_id`, `isbn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
