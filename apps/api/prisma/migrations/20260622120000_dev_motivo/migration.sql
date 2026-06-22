-- Catálogo transversal de motivos (core_motivo), discriminado por módulo. Lo usa
-- Devoluciones: al crear una devolución se elige un motivo (obligatorio). El
-- motivo con `requiere_observacion` = 1 ("Otro") exige cargar una observación.
CREATE TABLE `core_motivo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `modulo` VARCHAR(40) NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `requiere_observacion` BOOLEAN NOT NULL DEFAULT false,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `core_motivo_modulo_activo_idx`(`modulo`, `activo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Precarga de los motivos de Devoluciones (IDs explícitos pedidos por el negocio).
-- "Otro" exige observación. updated_at se setea al insertar (no tiene DEFAULT).
INSERT INTO `core_motivo` (`id`, `modulo`, `nombre`, `requiere_observacion`, `updated_at`) VALUES
    (1, 'devoluciones', 'Otro', true, CURRENT_TIMESTAMP(3)),
    (2, 'devoluciones', 'Solicitado por la editorial', false, CURRENT_TIMESTAMP(3)),
    (3, 'devoluciones', 'Solicitado por el cliente', false, CURRENT_TIMESTAMP(3)),
    (4, 'devoluciones', 'Traspaso Virtual', false, CURRENT_TIMESTAMP(3));

-- Motivo + cantidad de unidades en la cabecera de la devolución. NULL para no
-- romper las filas históricas; el servicio los exige al CREAR. Referencia al
-- catálogo por ID (sin FK cruzada, como el resto de las referencias al núcleo).
ALTER TABLE `dev_autorizacion`
    ADD COLUMN `motivo_id` INTEGER NULL,
    ADD COLUMN `cantidad_unidades` INTEGER NULL;
