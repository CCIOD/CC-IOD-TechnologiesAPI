import express from 'express';
import { authenticateToken } from '../middlewares/authenticateToken';
import { extractUserInfo } from '../middlewares/userInfo.middleware';
import { checkDirectorOrAdmin, checkMonitoringAccess } from '../middlewares/roleMiddleware';
import {
  validationCreateAlertProtocol,
  validationUpdateAlertProtocol,
} from '../middlewares/validationMiddlewares';
import { errorMiddleware } from '../middlewares/errorMiddleware';
import {
  listAlertProtocols,
  getAlertProtocol,
  createAlertProtocol,
  updateAlertProtocol,
  deleteAlertProtocol,
} from '../controllers/alertProtocolsController';

const router = express.Router();

router.use(authenticateToken);
router.use(extractUserInfo);

// Lectura: cualquier rol con acceso al módulo de monitoreo
router.get('/', checkMonitoringAccess, listAlertProtocols);
router.get('/:id', checkMonitoringAccess, getAlertProtocol);

// Escritura: solo Admin/Director
router.post('/', checkDirectorOrAdmin, validationCreateAlertProtocol, createAlertProtocol);
router.put('/:id', checkDirectorOrAdmin, validationUpdateAlertProtocol, updateAlertProtocol);
router.delete('/:id', checkDirectorOrAdmin, deleteAlertProtocol);

router.use(errorMiddleware);

export default router;
