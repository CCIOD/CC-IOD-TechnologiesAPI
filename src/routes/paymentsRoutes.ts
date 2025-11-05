/**
 * Rutas para Gestión de Pagos
 * 
 * Endpoints disponibles:
 * POST   /pagos              - Crear nuevo pago
 * GET    /pagos/:clientId    - Obtener historial de pagos
 * GET    /pagos/:clientId/resumen - Obtener resumen financiero
 * GET    /pagos/:clientId/por-tipo - Obtener pagos agrupados por tipo
 * PUT    /pagos/:id          - Actualizar pago
 * DELETE /pagos/:id          - Eliminar pago
 */

import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken";
import { extractUserInfo } from "../middlewares/userInfo.middleware";
import { errorMiddleware } from "../middlewares/errorMiddleware";
import {
  createNewPayment,
  getPaymentHistory,
  getFinancialSummary,
  getPaymentStatsByType,
  updateExistingPayment,
  removePayment,
} from "../controllers/paymentsController";

const router = express.Router();

// Middlewares de autenticación
router.use(authenticateToken);
router.use(extractUserInfo);

/**
 * POST /pagos
 * Crear nuevo pago
 */
router.post("/", createNewPayment);

/**
 * GET /pagos/:clientId/resumen
 * Obtener resumen financiero (debe ir antes de /:clientId)
 */
router.get("/:clientId/resumen", getFinancialSummary);

/**
 * GET /pagos/:clientId/por-tipo
 * Obtener pagos agrupados por tipo (debe ir antes de /:clientId)
 */
router.get("/:clientId/por-tipo", getPaymentStatsByType);

/**
 * GET /pagos/:clientId
 * Obtener historial de pagos
 */
router.get("/:clientId", getPaymentHistory);

/**
 * PUT /pagos/:id
 * Actualizar pago
 */
router.put("/:id", updateExistingPayment);

/**
 * DELETE /pagos/:id
 * Eliminar pago
 */
router.delete("/:id", removePayment);

// Middleware de manejo de errores
router.use(errorMiddleware);

export default router;
