import { Router } from "express";
import {
  createProsecutorDoc,
  updateProsecutorDoc,
  deleteProsecutorDoc,
  getProsecutorDocsByClient,
  getProsecutorDocById,
  getAllProsecutorDocs,
} from "../controllers/prosecutorDocsController";
import { authenticateToken } from "../middlewares/authenticateToken";
import {
  validationCreateProsecutorDoc,
  validationUpdateProsecutorDoc,
} from "../middlewares/validationMiddlewares";
import { uploadProsecutorDocFile } from "../middlewares/uploadFiles";

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @route   GET /api/prosecutor-docs
 * @desc    Obtener todos los oficios de fiscalía (admin)
 * @access  Private
 */
router.get("/", getAllProsecutorDocs);

/**
 * @route   GET /api/prosecutor-docs/client/:client_id
 * @desc    Obtener todos los oficios de un cliente
 * @access  Private
 */
router.get("/client/:client_id", getProsecutorDocsByClient);

/**
 * @route   GET /api/prosecutor-docs/:prosecutor_doc_id
 * @desc    Obtener un oficio específico
 * @access  Private
 */
router.get("/:prosecutor_doc_id", getProsecutorDocById);

/**
 * @route   POST /api/prosecutor-docs
 * @desc    Crear un nuevo oficio de fiscalía
 * @access  Private
 * @body    { client_id, document_type, document_number?, issue_date, prosecutor_office?, notes? }
 * @file    document_file (opcional)
 */
router.post(
  "/",
  uploadProsecutorDocFile,
  validationCreateProsecutorDoc,
  createProsecutorDoc
);

/**
 * @route   PUT /api/prosecutor-docs/:prosecutor_doc_id
 * @desc    Actualizar un oficio existente
 * @access  Private
 * @body    { document_type?, document_number?, issue_date?, prosecutor_office?, notes? }
 * @file    document_file (opcional)
 */
router.put(
  "/:prosecutor_doc_id",
  uploadProsecutorDocFile,
  validationUpdateProsecutorDoc,
  updateProsecutorDoc
);

/**
 * @route   DELETE /api/prosecutor-docs/:prosecutor_doc_id
 * @desc    Eliminar un oficio
 * @access  Private
 */
router.delete("/:prosecutor_doc_id", deleteProsecutorDoc);

export default router;
