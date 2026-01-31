import { Router } from "express";
import {
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  updateOriginalContractAmount,
  updateRenewalAmount,
  getPaymentObservations,
  updatePaymentObservations,
} from "../controllers/administrationController";
import {
  getPaymentsByClient,
  createPayment,
  updatePayment,
  deletePayment,
} from "../controllers/paymentsController";
import {
  getClientPaymentPlans,
  getPaymentPlanDetails,
  createPaymentPlan,
  addPaymentToPlan,
  updatePlanPayment,
  deletePlanPayment,
  getPaymentPlansSummary,
} from "../controllers/contractPaymentPlanController";
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

/**
 * @route   PUT /api/administration/clients/:id/original-amount
 * @desc    Update the original contract amount
 * @access  Private
 */
router.put("/clients/:id/original-amount", updateOriginalContractAmount);

/**
 * @route   GET /api/administration/clients/:id/payment-observations
 * @desc    Get payment observations for a client
 * @access  Private
 */
router.get("/clients/:id/payment-observations", getPaymentObservations);

/**
 * @route   PUT /api/administration/clients/:id/payment-observations
 * @desc    Update payment observations for a client
 * @access  Private
 */
router.put("/clients/:id/payment-observations", updatePaymentObservations);

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

// ==================== RENEWALS ====================
/**
 * @route   PUT /api/administration/renewals/:id/amount
 * @desc    Update the renewal amount
 * @access  Private
 */
router.put("/renewals/:id/amount", updateRenewalAmount);

// ==================== CONTRACT PAYMENT PLANS ====================
/**
 * @route   GET /api/administration/clients/:clientId/payment-plans
 * @desc    Get all payment plans for a client
 * @access  Private
 */
router.get("/clients/:clientId/payment-plans", getClientPaymentPlans);

/**
 * @route   GET /api/administration/clients/:clientId/payment-plans-summary
 * @desc    Get summary of payment plans by contract type
 * @access  Private
 */
router.get("/clients/:clientId/payment-plans-summary", getPaymentPlansSummary);

/**
 * @route   GET /api/administration/payment-plans/:planId
 * @desc    Get payment plan details with all payments
 * @access  Private
 */
router.get("/payment-plans/:planId", getPaymentPlanDetails);

/**
 * @route   POST /api/administration/payment-plans
 * @desc    Create a new payment plan for a contract (original or renewal)
 * @access  Private
 */
router.post("/payment-plans", createPaymentPlan);

/**
 * @route   POST /api/administration/payment-plans/:planId/payments
 * @desc    Add one or multiple payments to a payment plan
 * @access  Private
 */
router.post("/payment-plans/:planId/payments", addPaymentToPlan);

/**
 * @route   PUT /api/administration/payment-plans/:planId/payments/:paymentId
 * @desc    Update a specific payment in a payment plan
 * @access  Private
 */
router.put("/payment-plans/:planId/payments/:paymentId", updatePlanPayment);

/**
 * @route   DELETE /api/administration/payment-plans/:planId/payments/:paymentId
 * @desc    Delete a payment from a payment plan
 * @access  Private
 */
router.delete("/payment-plans/:planId/payments/:paymentId", deletePlanPayment);

export default router;
