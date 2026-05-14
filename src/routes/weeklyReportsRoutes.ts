import express from 'express';
import { authenticateToken } from '../middlewares/authenticateToken';
import { extractUserInfo } from '../middlewares/userInfo.middleware';
import { checkMonitoringAccess } from '../middlewares/roleMiddleware';
import { validationGenerateWeeklyReport } from '../middlewares/validationMiddlewares';
import { errorMiddleware } from '../middlewares/errorMiddleware';
import { uploadWeeklyReportAttachments } from '../middlewares/uploadFiles';
import {
  generateWeeklyReport,
  regenerateWeeklyReport,
  listWeeklyReports,
  getWeeklyReport,
  downloadWeeklyReport,
  deleteWeeklyReport,
  uploadAttachments,
  deleteAttachment,
} from '../controllers/weeklyReportsController';

const router = express.Router();

router.use(authenticateToken);
router.use(extractUserInfo);
router.use(checkMonitoringAccess); // Admin / Director / Monitorista

// Literales antes del :id
router.post('/generate', validationGenerateWeeklyReport, generateWeeklyReport);

router.get('/', listWeeklyReports);
router.get('/:id', getWeeklyReport);
router.get('/:id/download', downloadWeeklyReport);
router.post('/:id/regenerate', regenerateWeeklyReport);
router.delete('/:id', deleteWeeklyReport);

// Attachments (imágenes)
router.post('/:id/attachments', uploadWeeklyReportAttachments, uploadAttachments);
router.delete('/:id/attachments/:attachmentId', deleteAttachment);

router.use(errorMiddleware);

export default router;
