-- Reformulación de la cola del circuito de devoluciones:
--   INGRESO_DEPOSITO  →  EN_PROCESO_DEVOLUCION (solo pesar bultos)
--   + nuevos estados: PROCESANDO (ingresar nº de lote), VALIDANDO (comparar contra
--     Fierro), CON_DIFERENCIAS (responsable revisa/observa) → PROCESADO.
-- Se expande el enum con ambos valores, se migran las filas y se reduce al set final.

ALTER TABLE `dev_autorizacion`
    MODIFY `estado` ENUM(
        'A_APROBAR','APROBADO','EN_TRANSITO','ENTREGADO',
        'INGRESO_DEPOSITO','EN_PROCESO_DEVOLUCION','PROCESANDO','VALIDANDO','CON_DIFERENCIAS','PROCESADO'
    ) NOT NULL DEFAULT 'A_APROBAR';

UPDATE `dev_autorizacion` SET `estado` = 'EN_PROCESO_DEVOLUCION' WHERE `estado` = 'INGRESO_DEPOSITO';

ALTER TABLE `dev_autorizacion`
    MODIFY `estado` ENUM(
        'A_APROBAR','APROBADO','EN_TRANSITO','ENTREGADO',
        'EN_PROCESO_DEVOLUCION','PROCESANDO','VALIDANDO','CON_DIFERENCIAS','PROCESADO'
    ) NOT NULL DEFAULT 'A_APROBAR';
