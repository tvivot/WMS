-- Notificaciones por email por cambio de estado (core, transversal). Se engancha
-- al evento de dominio devolucion.estado_cambiado: NO acopla a internos de
-- Devoluciones. Referencias a entidades de otros módulos por ID suelto (sin FK).

-- Correo(s) de contacto del cliente (varios separados por coma). Lo usan las
-- notificaciones cuando una regla marca "incluir cliente".
ALTER TABLE `core_cliente`
    ADD COLUMN `email` VARCHAR(255) NULL;

-- Grupo reutilizable de destinatarios. `emails` = lista (coma/;/salto de línea).
CREATE TABLE `core_grupo_correo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(120) NOT NULL,
    `emails` TEXT NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `core_grupo_correo_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Regla por estado destino (una por modulo+estado). asunto/cuerpo son plantillas
-- con placeholders ({{nro}}, {{cliente}}, {{estado}}, {{estadoAnterior}}, {{fecha}}).
CREATE TABLE `core_notificacion_regla` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `modulo` VARCHAR(40) NOT NULL DEFAULT 'devoluciones',
    `estado` VARCHAR(60) NOT NULL,
    `incluir_cliente` BOOLEAN NOT NULL DEFAULT false,
    `asunto` VARCHAR(255) NOT NULL,
    `cuerpo` TEXT NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `core_notificacion_regla_modulo_estado_key`(`modulo`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- N:N regla ↔ grupo de correo.
CREATE TABLE `core_notificacion_regla_grupo` (
    `regla_id` INTEGER NOT NULL,
    `grupo_id` INTEGER NOT NULL,

    INDEX `core_notificacion_regla_grupo_grupo_id_idx`(`grupo_id`),
    PRIMARY KEY (`regla_id`, `grupo_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Destinos "usuario interno" de una regla. usuario_id es referencia suelta a
-- core_usuario (sin FK): el email se resuelve en código al enviar.
CREATE TABLE `core_notificacion_regla_usuario` (
    `regla_id` INTEGER NOT NULL,
    `usuario_id` INTEGER NOT NULL,

    INDEX `core_notificacion_regla_usuario_usuario_id_idx`(`usuario_id`),
    PRIMARY KEY (`regla_id`, `usuario_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Log / outbox de envíos. estado_envio: PENDIENTE | ENVIADO | ERROR. El cron de
-- reintento reprocesa PENDIENTE/ERROR con intentos < tope.
CREATE TABLE `core_notificacion_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `regla_id` INTEGER NULL,
    `modulo` VARCHAR(40) NOT NULL,
    `entidad_id` INTEGER NOT NULL,
    `estado` VARCHAR(60) NOT NULL,
    `destinatarios` TEXT NOT NULL,
    `asunto` VARCHAR(255) NOT NULL,
    `cuerpo` TEXT NOT NULL,
    `estado_envio` VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    `error` TEXT NULL,
    `intentos` INTEGER NOT NULL DEFAULT 0,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `core_notificacion_log_estado_envio_idx`(`estado_envio`),
    INDEX `core_notificacion_log_modulo_entidad_id_idx`(`modulo`, `entidad_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- FKs internas del módulo (core): las uniones cascada al borrar la regla/grupo.
ALTER TABLE `core_notificacion_regla_grupo`
    ADD CONSTRAINT `core_notif_regla_grupo_regla_fk` FOREIGN KEY (`regla_id`) REFERENCES `core_notificacion_regla`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `core_notif_regla_grupo_grupo_fk` FOREIGN KEY (`grupo_id`) REFERENCES `core_grupo_correo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `core_notificacion_regla_usuario`
    ADD CONSTRAINT `core_notif_regla_usuario_regla_fk` FOREIGN KEY (`regla_id`) REFERENCES `core_notificacion_regla`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas por defecto (DESACTIVADAS): plantillas listas para que el admin asigne
-- grupos/usuarios y las active. Una por estado de la máquina de Devoluciones.
INSERT INTO `core_notificacion_regla` (`modulo`, `estado`, `incluir_cliente`, `asunto`, `cuerpo`, `activo`, `updated_at`) VALUES
    ('devoluciones', 'A_APROBAR', false, 'Devolución #{{nro}} creada (a aprobar)', 'La devolución #{{nro}} del cliente {{cliente}} fue creada y está a la espera de aprobación.', false, CURRENT_TIMESTAMP(3)),
    ('devoluciones', 'APROBADO', true, 'Devolución #{{nro}} aprobada', 'Hola {{cliente}}: tu devolución #{{nro}} fue aprobada. Ya podés cargar los libros y despacharla.', false, CURRENT_TIMESTAMP(3)),
    ('devoluciones', 'EN_TRANSITO', false, 'Devolución #{{nro}} despachada (en tránsito)', 'La devolución #{{nro}} del cliente {{cliente}} fue despachada y está en tránsito al depósito.', false, CURRENT_TIMESTAMP(3)),
    ('devoluciones', 'ENTREGADO', false, 'Devolución #{{nro}} entregada en depósito', 'La devolución #{{nro}} del cliente {{cliente}} fue recibida en el depósito.', false, CURRENT_TIMESTAMP(3)),
    ('devoluciones', 'INGRESO_DEPOSITO', false, 'Devolución #{{nro}} ingresada a depósito', 'La devolución #{{nro}} del cliente {{cliente}} fue ingresada y está a la espera de control.', false, CURRENT_TIMESTAMP(3)),
    ('devoluciones', 'PROCESADO', true, 'Devolución #{{nro}} procesada', 'Hola {{cliente}}: tu devolución #{{nro}} fue controlada y procesada. ¡Gracias!', false, CURRENT_TIMESTAMP(3));
