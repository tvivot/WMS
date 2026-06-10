-- CreateTable
CREATE TABLE `core_pais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo_iso` VARCHAR(3) NOT NULL,
    `nombre` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `core_pais_codigo_iso_key`(`codigo_iso`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_deposito` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(150) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_usuario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(60) NOT NULL,
    `email` VARCHAR(150) NULL,
    `nombre` VARCHAR(150) NOT NULL,
    `clave_hash` VARCHAR(255) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `primer_ingreso` BOOLEAN NOT NULL DEFAULT true,
    `intentos_fallidos` INTEGER NOT NULL DEFAULT 0,
    `bloqueado_hasta` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `core_usuario_username_key`(`username`),
    UNIQUE INDEX `core_usuario_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_rol` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(60) NOT NULL,
    `descripcion` VARCHAR(255) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `core_rol_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_permiso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(60) NOT NULL,
    `descripcion` VARCHAR(255) NULL,

    UNIQUE INDEX `core_permiso_codigo_key`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_rol_permiso` (
    `rol_id` INTEGER NOT NULL,
    `permiso_id` INTEGER NOT NULL,

    PRIMARY KEY (`rol_id`, `permiso_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_usuario_rol` (
    `usuario_id` INTEGER NOT NULL,
    `rol_id` INTEGER NOT NULL,

    PRIMARY KEY (`usuario_id`, `rol_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_cliente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nro_cliente` VARCHAR(40) NOT NULL,
    `nombre` VARCHAR(200) NOT NULL,
    `clave_hash` VARCHAR(255) NOT NULL,
    `primer_ingreso` BOOLEAN NOT NULL DEFAULT true,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `pais_id` INTEGER NULL,
    `deposito_id` INTEGER NULL,
    `intentos_fallidos` INTEGER NOT NULL DEFAULT 0,
    `bloqueado_hasta` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `core_cliente_nro_cliente_key`(`nro_cliente`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_producto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo_interno` VARCHAR(60) NOT NULL,
    `titulo` VARCHAR(300) NOT NULL,
    `editorial` VARCHAR(200) NULL,
    `autor` VARCHAR(200) NULL,
    `unidad_base` VARCHAR(20) NOT NULL DEFAULT 'unidad',
    `equiv_caja` INTEGER NOT NULL DEFAULT 1,
    `equiv_pallet` INTEGER NOT NULL DEFAULT 1,
    `lote_habilitado` BOOLEAN NOT NULL DEFAULT false,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `core_producto_codigo_interno_key`(`codigo_interno`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_producto_isbn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `producto_id` INTEGER NOT NULL,
    `isbn` VARCHAR(20) NOT NULL,

    UNIQUE INDEX `core_producto_isbn_isbn_key`(`isbn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_transportista` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(200) NOT NULL,
    `contacto` VARCHAR(200) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `core_auditoria` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_id` INTEGER NULL,
    `actor_tipo` VARCHAR(20) NOT NULL,
    `accion` VARCHAR(60) NOT NULL,
    `entidad` VARCHAR(60) NOT NULL,
    `entidad_id` VARCHAR(60) NOT NULL,
    `estado_anterior` VARCHAR(60) NULL,
    `estado_nuevo` VARCHAR(60) NULL,
    `detalle` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `core_auditoria_entidad_entidad_id_idx`(`entidad`, `entidad_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_autorizacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `estado` ENUM('A_APROBAR', 'APROBADO', 'EN_TRANSITO', 'ENTREGADO', 'INGRESO_DEPOSITO', 'PROCESADO') NOT NULL DEFAULT 'A_APROBAR',
    `cliente_id` INTEGER NOT NULL,
    `deposito_id` INTEGER NOT NULL,
    `creado_por_id` INTEGER NOT NULL,
    `creado_por_tipo` ENUM('usuario', 'cliente') NOT NULL,
    `transportista_id` INTEGER NULL,
    `bultos_declarados` INTEGER NULL,
    `peso_total_declarado` DECIMAL(10, 3) NULL,
    `bultos_recibidos` INTEGER NULL,
    `ubicacion_espera` VARCHAR(60) NULL,
    `ubicacion_destino_bueno` VARCHAR(60) NULL,
    `ubicacion_destino_malo` VARCHAR(60) NULL,
    `observaciones` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dev_autorizacion_estado_idx`(`estado`),
    INDEX `dev_autorizacion_cliente_id_idx`(`cliente_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_declaracion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `autorizacion_id` INTEGER NOT NULL,
    `isbn` VARCHAR(20) NOT NULL,
    `producto_id` INTEGER NULL,
    `cantidad` INTEGER NOT NULL,

    INDEX `dev_declaracion_autorizacion_id_idx`(`autorizacion_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_bulto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `autorizacion_id` INTEGER NOT NULL,
    `numero` INTEGER NOT NULL,
    `peso` DECIMAL(10, 3) NULL,
    `estado_control` ENUM('NO_CONTROLADO', 'EN_CONTROL', 'CONTROLADO') NOT NULL DEFAULT 'NO_CONTROLADO',

    INDEX `dev_bulto_autorizacion_id_idx`(`autorizacion_id`),
    UNIQUE INDEX `dev_bulto_autorizacion_id_numero_key`(`autorizacion_id`, `numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_control` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bulto_id` INTEGER NOT NULL,
    `isbn` VARCHAR(20) NOT NULL,
    `producto_id` INTEGER NULL,
    `cantidad` INTEGER NOT NULL,
    `mal_estado` INTEGER NOT NULL DEFAULT 0,

    INDEX `dev_control_bulto_id_idx`(`bulto_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `core_rol_permiso` ADD CONSTRAINT `core_rol_permiso_rol_id_fkey` FOREIGN KEY (`rol_id`) REFERENCES `core_rol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `core_rol_permiso` ADD CONSTRAINT `core_rol_permiso_permiso_id_fkey` FOREIGN KEY (`permiso_id`) REFERENCES `core_permiso`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `core_usuario_rol` ADD CONSTRAINT `core_usuario_rol_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `core_usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `core_usuario_rol` ADD CONSTRAINT `core_usuario_rol_rol_id_fkey` FOREIGN KEY (`rol_id`) REFERENCES `core_rol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `core_producto_isbn` ADD CONSTRAINT `core_producto_isbn_producto_id_fkey` FOREIGN KEY (`producto_id`) REFERENCES `core_producto`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dev_declaracion` ADD CONSTRAINT `dev_declaracion_autorizacion_id_fkey` FOREIGN KEY (`autorizacion_id`) REFERENCES `dev_autorizacion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dev_bulto` ADD CONSTRAINT `dev_bulto_autorizacion_id_fkey` FOREIGN KEY (`autorizacion_id`) REFERENCES `dev_autorizacion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dev_control` ADD CONSTRAINT `dev_control_bulto_id_fkey` FOREIGN KEY (`bulto_id`) REFERENCES `dev_bulto`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
