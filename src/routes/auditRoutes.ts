import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken";
import { extractUserInfo } from "../middlewares/userInfo.middleware";
import {
  getClientAuditHistory,
  getAllClientsAuditHistory,
  getAuditStatistics,
} from "../controllers/auditController";
import { errorMiddleware } from "../middlewares/errorMiddleware";

const router = express.Router();

// Aplicar middlewares de autenticación y extracción de información del usuario
router.use(authenticateToken);
router.use(extractUserInfo);

// Rutas para auditoría
router.get("/statistics", getAuditStatistics);
router.get("/client/:id", getClientAuditHistory);
router.get("/", getAllClientsAuditHistory);

router.use(errorMiddleware);

export default router;
