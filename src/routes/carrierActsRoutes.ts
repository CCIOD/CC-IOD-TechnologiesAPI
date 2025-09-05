import { Router } from "express";
import {
  createCarrierAct,
  getCarrierActs,
  deleteCarrierAct,
  getAllCarrierActs,
} from "../controllers/carrierActsController";
import { authenticateToken } from "../middlewares/authenticateToken";
import { validationCarrierAct } from "../middlewares/validationMiddlewares";
import { uploadCarrierActFile } from "../middlewares/uploadFiles";
import { validationFiles } from "../middlewares/validationFiles";

const router = Router();

// Obtener todas las actas de todos los portadores
router.get(
  "/",
  authenticateToken,
  getAllCarrierActs
);

// Obtener todas las actas de un portador específico
router.get(
  "/carrier/:id",
  authenticateToken,
  getCarrierActs
);

// Crear una nueva acta para un portador
router.post(
  "/carrier/:id",
  authenticateToken,
  uploadCarrierActFile,
  validationFiles,
  validationCarrierAct,
  createCarrierAct
);

// Eliminar un acta específica
router.delete(
  "/:actId",
  authenticateToken,
  deleteCarrierAct
);

export default router;
