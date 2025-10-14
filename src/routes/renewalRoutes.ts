import { Router } from "express";
import {
  createRenewal,
  updateRenewal,
  deleteRenewal,
  getRenewalsByClient,
  getRenewalById,
  getAllRenewals,
} from "../controllers/renewalController";
import { authenticateToken } from "../middlewares/authenticateToken";
import {
  validationCreateRenewal,
  validationUpdateRenewal,
} from "../middlewares/validationMiddlewares";
import { uploadRenewalFile } from "../middlewares/uploadFiles";

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @route   GET /api/renewals
 * @desc    Obtener todas las renovaciones (admin)
 * @access  Private
 */
router.get("/", getAllRenewals);

/**
 * @route   GET /api/renewals/client/:client_id
 * @desc    Obtener todas las renovaciones de un cliente
 * @access  Private
 */
router.get("/client/:client_id", getRenewalsByClient);

/**
 * @route   GET /api/renewals/:renewal_id
 * @desc    Obtener una renovación específica
 * @access  Private
 */
router.get("/:renewal_id", getRenewalById);

/**
 * @route   POST /api/renewals
 * @desc    Crear una nueva renovación de contrato
 * @access  Private
 * @body    { client_id, renewal_date, renewal_duration?, notes? }
 * @file    renewal_document (opcional)
 */
router.post(
  "/",
  uploadRenewalFile,
  validationCreateRenewal,
  createRenewal
);

/**
 * @route   PUT /api/renewals/:renewal_id
 * @desc    Actualizar una renovación existente
 * @access  Private
 * @body    { renewal_date?, renewal_duration?, notes? }
 * @file    renewal_document (opcional)
 */
router.put(
  "/:renewal_id",
  uploadRenewalFile,
  validationUpdateRenewal,
  updateRenewal
);

/**
 * @route   DELETE /api/renewals/:renewal_id
 * @desc    Eliminar una renovación
 * @access  Private
 */
router.delete("/:renewal_id", deleteRenewal);

export default router;
