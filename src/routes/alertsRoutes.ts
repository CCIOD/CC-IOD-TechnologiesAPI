import express from 'express';
import { authenticateToken } from '../middlewares/authenticateToken';
import { extractUserInfo } from '../middlewares/userInfo.middleware';
import { checkMonitoringAccess } from '../middlewares/roleMiddleware';
import {
  validationCreateAlert,
  validationUpdateAlert,
} from '../middlewares/validationMiddlewares';
import { uploadAlertReportAttachments } from '../middlewares/uploadFiles';
import { errorMiddleware } from '../middlewares/errorMiddleware';
import {
  listAlerts,
  getAlert,
  createAlert,
  updateAlert,
  deactivateAlert,
  reportAlert,
  previewAlertReport,
  listAlertAudit,
} from '../controllers/alertsController';

const router = express.Router();

router.use(authenticateToken);
router.use(extractUserInfo);
router.use(checkMonitoringAccess); // Admin/Director/Monitorista

// Rutas literales primero (antes de :id)
router.get('/audit', listAlertAudit);

router.get('/', listAlerts);
router.post('/', validationCreateAlert, createAlert);

router.get('/:id', getAlert);
router.put('/:id', validationUpdateAlert, updateAlert);
router.put('/:id/deactivate', deactivateAlert);
router.post('/:id/report/preview', uploadAlertReportAttachments, previewAlertReport);
router.post('/:id/report', uploadAlertReportAttachments, reportAlert);

router.use(errorMiddleware);

export default router;
