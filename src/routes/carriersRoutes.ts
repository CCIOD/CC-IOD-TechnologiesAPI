import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken";
import { checkAdmin } from "../middlewares/roleMiddleware";
import {
  createCarrier,
  deleteCarrier,
  getAllCarriers,
  updateCarrier,
} from "../controllers/carriersController";
import { errorMiddleware } from "../middlewares/errorMiddleware";
import { validationsCarrier } from "../middlewares/validationMiddlewares";

const router = express.Router();

router.use(authenticateToken);
// Lectura abierta a todos los autenticados (Seguimiento usa el listado de carriers).
router.get("/", getAllCarriers);
// Mutaciones restringidas a Admin (igual que antes del refactor).
router.post("/", checkAdmin, validationsCarrier, createCarrier);
router.put("/:id", checkAdmin, validationsCarrier, updateCarrier);
router.delete("/:id", checkAdmin, deleteCarrier);
router.use(errorMiddleware);

export default router;
