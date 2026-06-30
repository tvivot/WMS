-- Lote de devolución del ERP (Fierro) contra el que se reconcilia al cerrar. Se
-- ingresa en el cierre (obligatorio para Procesar). NULL para las filas previas;
-- referencia por código a dev_lote (sin FK: el cierre no exige que el lote ya
-- exista en la tabla al momento de la migración).
ALTER TABLE `dev_autorizacion`
    ADD COLUMN `lote_codigo` VARCHAR(60) NULL;
