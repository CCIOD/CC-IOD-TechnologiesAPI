import { Router } from "express";
import {
  getClientPaymentPlans,
  getPaymentPlanDetails,
  createPaymentPlan,
  addPaymentToPlan,
  updatePlanPayment,
  deletePlanPayment,
  getPaymentPlansSummary,
} from "../controllers/contractPaymentPlanController";
import { authenticateToken } from "../middlewares/authenticateToken";
import { checkAdministrationAccess } from "../middlewares/roleMiddleware";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Only Admin (1), Director (2), and Contador (4) can access administration module
router.use(checkAdministrationAccess);

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
