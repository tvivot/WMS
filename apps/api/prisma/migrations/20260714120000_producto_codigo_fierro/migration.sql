-- AlterTable: código interno del producto en el ERP (Fierro), opcional y único.
ALTER TABLE `core_producto` ADD COLUMN `codigo_fierro` VARCHAR(60) NULL;

-- CreateIndex: único (MySQL permite múltiples NULL) para integridad y lookup.
CREATE UNIQUE INDEX `core_producto_codigo_fierro_key` ON `core_producto`(`codigo_fierro`);
