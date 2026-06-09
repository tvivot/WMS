"use strict";
// Contratos compartidos entre API y PWA (DTOs, enums, tipos).
// Importar SOLO desde @wms/shared; este paquete no depende de ningún módulo.
Object.defineProperty(exports, "__esModule", { value: true });
exports.EstadoDevolucion = void 0;
/**
 * Estados de la cabecera de una autorización de devolución (Módulo 1).
 * Stub presente desde el día 1 para fijar el contrato; la máquina de
 * estados se implementa en la etapa de Devoluciones.
 */
var EstadoDevolucion;
(function (EstadoDevolucion) {
    EstadoDevolucion["A_APROBAR"] = "A Aprobar";
    EstadoDevolucion["APROBADO"] = "Aprobado";
    EstadoDevolucion["EN_TRANSITO"] = "En tr\u00E1nsito";
    EstadoDevolucion["ENTREGADO"] = "Entregado";
    EstadoDevolucion["INGRESO_DEPOSITO"] = "Ingreso a dep\u00F3sito";
    EstadoDevolucion["PROCESADO"] = "Procesado";
})(EstadoDevolucion || (exports.EstadoDevolucion = EstadoDevolucion = {}));
//# sourceMappingURL=index.js.map