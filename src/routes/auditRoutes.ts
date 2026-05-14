import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken";
import { extractUserInfo } from "../middlewares/userInfo.middleware";
import { checkDirectorOrAdmin } from "../middlewares/roleMiddleware";
import {
  getClientAuditHistory,
  getAllClientsAuditHistory,
  getAuditStatistics,
  getUnifiedAudit,
  getAuditSummary,
} from "../controllers/auditController";
import { errorMiddleware } from "../middlewares/errorMiddleware";

const router = express.Router();

// Aplicar middlewares de autenticación y extracción de información del usuario
router.use(authenticateToken);
router.use(extractUserInfo);

// Vista consolidada FASE 5 — solo Admin/Director
// Rutas literales primero (antes de los :id genéricos)
router.get("/unified", checkDirectorOrAdmin, getUnifiedAudit);
router.get("/summary", checkDirectorOrAdmin, getAuditSummary);

// Rutas existentes (auditoría de clientes)
router.get("/statistics", getAuditStatistics);
router.get("/client/:id", getClientAuditHistory);
router.get("/", getAllClientsAuditHistory);

router.use(errorMiddleware);

export default router;
