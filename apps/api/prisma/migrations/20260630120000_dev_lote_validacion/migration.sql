-- Firma (hash) de la última reconciliación notificada por el chequeo periódico de
-- lotes (cron cada 15 min): el job compara lo declarado por el cliente contra el
-- lote del ERP y avisa a los responsables; la firma evita re-mandar el mail salvo
-- que la comparación cambie. NULL = todavía no se notificó.
ALTER TABLE `dev_autorizacion`
    ADD COLUMN `lote_validacion_firma` VARCHAR(64) NULL;

-- Regla de notificación del chequeo de lotes (estado lógico "LOTE_EVALUADO", no es
-- un estado de la máquina). DESACTIVADA: el admin asigna el grupo de responsables
-- y la activa en /notificaciones. Usa el placeholder {{detalle}} (diferencias).
INSERT INTO `core_notificacion_regla` (`modulo`, `estado`, `incluir_cliente`, `asunto`, `cuerpo`, `activo`, `updated_at`) VALUES
    ('devoluciones', 'LOTE_EVALUADO', false, 'Devolución #{{nro}} — validación contra el lote del ERP', 'La devolución #{{nro}} del cliente {{cliente}} fue comparada contra el lote del ERP.\n\n{{detalle}}\n\nRevisá la información en el WMS.', false, CURRENT_TIMESTAMP(3));
