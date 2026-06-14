-- Búsqueda del catálogo por título:
--  - FULLTEXT (InnoDB, MySQL 5.6+ / MariaDB 10.0+) para MATCH ... AGAINST por
--    palabra del título (rápido a escala, busca palabras internas).
--  - B-tree completo sobre `titulo` para el orderBy del listado (sin filesort).
-- `titulo` es VARCHAR(300) utf8mb4 = 1200 bytes < 3072 (límite InnoDB con row
-- format DYNAMIC), así que el índice completo entra sin prefijo.
CREATE FULLTEXT INDEX `core_producto_titulo_ft` ON `core_producto`(`titulo`);
CREATE INDEX `core_producto_titulo_idx` ON `core_producto`(`titulo`);
