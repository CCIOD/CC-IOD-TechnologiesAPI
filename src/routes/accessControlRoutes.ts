import express from 'express';
import { authenticateToken } from '../middlewares/authenticateToken';
import { extractUserInfo } from '../middlewares/userInfo.middleware';
import { checkDirectorOrAdmin } from '../middlewares/roleMiddleware';
import { errorMiddleware } from '../middlewares/errorMiddleware';
import {
  listIpWhitelist,
  createIpWhitelist,
  updateIpWhitelist,
  deleteIpWhitelist,
  listDevices,
  createDevice,
  updateDevice,
  deleteDevice,
  listAccessAttempts,
  listMonitoristasReport,
  listMonitoristaSessions,
} from '../controllers/accessControlController';

const router = express.Router();

router.use(authenticateToken);
router.use(extractUserInfo);
router.use(checkDirectorOrAdmin); // Solo Admin / Director

// IP whitelist
router.get('/ip-whitelist', listIpWhitelist);
router.post('/ip-whitelist', createIpWhitelist);
router.put('/ip-whitelist/:id', updateIpWhitelist);
router.delete('/ip-whitelist/:id', deleteIpWhitelist);

// Dispositivos autorizados
router.get('/devices', listDevices);
router.post('/devices', createDevice);
router.put('/devices/:id', updateDevice);
router.delete('/devices/:id', deleteDevice);

// Intentos de acceso (auditoría)
router.get('/attempts', listAccessAttempts);

// Reporte agregado por monitorista + sesiones individuales
router.get('/monitoristas-report', listMonitoristasReport);
router.get('/monitoristas/:userId/sessions', listMonitoristaSessions);

router.use(errorMiddleware);

export default router;
