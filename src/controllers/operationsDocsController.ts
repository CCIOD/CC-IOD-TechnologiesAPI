import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { logSuccess, logWarning } from '../middlewares/loggingMiddleware';
import {
  createFolder,
  deleteFile,
  deleteFolder,
  listFolder,
  normalizePrefix,
  uploadFileToFolder,
} from '../services/operationsDocs.service';

/**
 * GET /operations-docs?prefix=Contratos/2026/
 * Lista carpetas y archivos en una "carpeta" del container operations-docs.
 */
export const listDocs = asyncHandler(async (req: Request, res: Response) => {
  const prefix = normalizePrefix((req.query.prefix as string) || '');
  const entries = await listFolder(prefix);
  return res.status(200).json({
    success: true,
    data: entries,
    prefix,
  });
});

/**
 * POST /operations-docs/folder { parent, name }
 * Crea una carpeta. Si `parent` no se pasa, se crea en la raíz.
 */
export const createDocFolder = asyncHandler(async (req: Request, res: Response) => {
  const { parent, name } = req.body as { parent?: string; name?: string };
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'El nombre de la carpeta es obligatorio.' });
  }
  try {
    const { prefix } = await createFolder(parent ?? '', name);
    logSuccess('Carpeta de documentos creada', { prefix });
    return res.status(201).json({ success: true, data: { prefix } });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: (e as Error).message });
  }
});

/**
 * POST /operations-docs/upload?prefix=Contratos/2026/
 * Multipart con campo "files" (1..N). Sube los archivos a la carpeta dada.
 */
export const uploadDocs = asyncHandler(async (req: Request, res: Response) => {
  const prefix = normalizePrefix((req.query.prefix as string) || '');
  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) {
    return res.status(400).json({ message: 'No se recibieron archivos (campo "files").' });
  }
  const uploaded: { url: string; blobName: string }[] = [];
  for (const file of files) {
    try {
      uploaded.push(await uploadFileToFolder(prefix, file));
    } catch (e) {
      logWarning('Fallo subiendo documento', {
        filename: file.originalname,
        message: (e as Error).message,
      });
    }
  }
  return res.status(201).json({ success: true, data: uploaded });
});

/**
 * DELETE /operations-docs/file
 * Body: { blobName: string }
 */
export const deleteDocFile = asyncHandler(async (req: Request, res: Response) => {
  const { blobName } = req.body as { blobName?: string };
  if (!blobName) return res.status(400).json({ message: 'blobName es obligatorio.' });
  try {
    await deleteFile(blobName);
    return res.status(200).json({ success: true, message: 'Archivo eliminado.' });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: (e as Error).message });
  }
});

/**
 * DELETE /operations-docs/folder
 * Body: { prefix: string }
 * Elimina la carpeta y todo su contenido. Irreversible.
 */
export const deleteDocFolder = asyncHandler(async (req: Request, res: Response) => {
  const { prefix } = req.body as { prefix?: string };
  if (!prefix) return res.status(400).json({ message: 'prefix es obligatorio.' });
  try {
    const deleted = await deleteFolder(prefix);
    logSuccess('Carpeta de documentos eliminada', { prefix, deleted });
    return res
      .status(200)
      .json({ success: true, message: `Carpeta eliminada (${deleted} archivos).`, deleted });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: (e as Error).message });
  }
});
