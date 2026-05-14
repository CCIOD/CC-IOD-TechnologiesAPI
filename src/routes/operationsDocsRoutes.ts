import express from 'express';
import { authenticateToken } from '../middlewares/authenticateToken';
import { extractUserInfo } from '../middlewares/userInfo.middleware';
import { checkAdmin } from '../middlewares/roleMiddleware';
import { uploadOperationsDocsFiles } from '../middlewares/uploadFiles';
import { errorMiddleware } from '../middlewares/errorMiddleware';
import {
  listDocs,
  createDocFolder,
  uploadDocs,
  deleteDocFile,
  deleteDocFolder,
} from '../controllers/operationsDocsController';

const router = express.Router();

router.use(authenticateToken);
router.use(extractUserInfo);
// Solo Administrador
router.use(checkAdmin);

router.get('/', listDocs);
router.post('/folder', createDocFolder);
router.post('/upload', uploadOperationsDocsFiles, uploadDocs);
router.delete('/file', deleteDocFile);
router.delete('/folder', deleteDocFolder);

router.use(errorMiddleware);

export default router;
