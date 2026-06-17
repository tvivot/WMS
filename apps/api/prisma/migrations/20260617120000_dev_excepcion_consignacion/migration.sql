-- Excepción de consignación: autoriza declarar unidades de un ISBN en UNA
-- devolución por fuera de la consignación del cliente. La aprueba un usuario
-- con permiso `devolucion.autorizar_excepcion` (Gerencia). FK al dev_autorizacion
-- (mismo módulo). Referencias al núcleo (solicitante/aprobador) por ID sin FK.
CREATE TABLE `dev_excepcion_consignacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `autorizacion_id` INTEGER NOT NULL,
    `isbn` VARCHAR(20) NOT NULL,
    `producto_id` INTEGER NULL,
    `cantidad` INTEGER NOT NULL,
    `estado` ENUM('PENDIENTE', 'APROBADA', 'RECHAZADA') NOT NULL DEFAULT 'PENDIENTE',
    `solicitado_por_id` INTEGER NOT NULL,
    `solicitado_por_tipo` ENUM('usuario', 'cliente') NOT NULL,
    `motivo_solicitud` TEXT NULL,
    `resuelto_por_id` INTEGER NULL,
    `resuelto_en` DATETIME(3) NULL,
    `motivo_resolucion` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dev_excepcion_consignacion_autorizacion_id_idx`(`autorizacion_id`),
    INDEX `dev_excepcion_consignacion_estado_idx`(`estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- FK dentro del mismo módulo (dev_*): permitido. Cascade al borrar la devolución.
ALTER TABLE `dev_excepcion_consignacion`
    ADD CONSTRAINT `dev_excepcion_consignacion_autorizacion_id_fkey`
    FOREIGN KEY (`autorizacion_id`) REFERENCES `dev_autorizacion`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
