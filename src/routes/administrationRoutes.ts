import { Router } from "express";
import {
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
} from "../controllers/administrationController";
import {
  getPaymentsByClient,
  createPayment,
  updatePayment,
  deletePayment,
} from "../controllers/paymentsController";
import {
  getFilesByClient,
  uploadFile,
  deleteFile,
} from "../controllers/filesController";
import {
  getDashboardSummary,
  getPaymentMetrics,
} from "../controllers/dashboardController";
import { authenticateToken } from "../middlewares/authenticateToken";
import { checkAdministrationAccess } from "../middlewares/roleMiddleware";
import { upload } from "../middlewares/uploadFiles";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Only Admin (1), Director (2), and Contador (4) can access administration module
// Administrativo (3) is NOT allowed
router.use(checkAdministrationAccess);

// ==================== DASHBOARD ====================
/**
 * @route   GET /api/administration/dashboard/summary
 * @desc    Get dashboard summary with key metrics
 * @access  Private
 */
router.get("/dashboard/summary", getDashboardSummary);

/**
 * @route   GET /api/administration/dashboard/metrics
 * @desc    Get payment metrics by month
 * @access  Private
 */
router.get("/dashboard/metrics", getPaymentMetrics);

// ==================== CLIENTS ====================
/**
 * @route   GET /api/administration/clients
 * @desc    Get list of all clients with financial information
 * @query   ?page=1&limit=50&name=Juan&status=Active&saleType=Credit
 * @access  Private
 */
router.get("/clients", getAllClients);

/**
 * @route   GET /api/administration/clients/:id
 * @desc    Get complete client details
 * @access  Private
 */
router.get("/clients/:id", getClientById);

/**
 * @route   POST /api/administration/clients
 * @desc    Create a new client with initial configuration
 * @access  Private
 */
router.post("/clients", createClient);

/**
 * @route   PUT /api/administration/clients/:id
 * @desc    Update client data
 * @access  Private
 */
router.put("/clients/:id", updateClient);

/**
 * @route   DELETE /api/administration/clients/:id
 * @desc    Delete or deactivate a client
 * @query   ?soft=true (default) or ?soft=false for physical deletion
 * @access  Private
 */
router.delete("/clients/:id", deleteClient);

// ==================== PAYMENTS ====================
/**
 * @route   GET /api/administration/clients/:id/payments
 * @desc    Get list of client payments
 * @access  Private
 */
router.get("/clients/:id/payments", getPaymentsByClient);

/**
 * @route   POST /api/administration/clients/:id/payments
 * @desc    Add a new payment record
 * @access  Private
 */
router.post("/clients/:id/payments", createPayment);

/**
 * @route   PUT /api/administration/payments/:paymentId
 * @desc    Modify an existing payment
 * @access  Private
 */
router.put("/payments/:paymentId", updatePayment);

/**
 * @route   DELETE /api/administration/payments/:paymentId
 * @desc    Delete a payment record
 * @access  Private
 */
router.delete("/payments/:paymentId", deletePayment);

// ==================== FILES ====================
/**
 * @route   GET /api/administration/clients/:id/files
 * @desc    Get list of client files
 * @access  Private
 */
router.get("/clients/:id/files", getFilesByClient);

/**
 * @route   POST /api/administration/clients/:id/files
 * @desc    Upload a file (contract, invoice, etc.)
 * @access  Private
 */
router.post("/clients/:id/files", upload.single("file"), uploadFile);

/**
 * @route   DELETE /api/administration/files/:fileId
 * @desc    Delete a specific file
 * @access  Private
 */
router.delete("/files/:fileId", deleteFile);

export default router;
