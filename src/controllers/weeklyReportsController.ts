import { Request, Response } from 'express';
import axios from 'axios';
import { pool } from '../database/connection';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { logSuccess, logWarning } from '../middlewares/loggingMiddleware';
import { azureUploadBlob } from '../services/azure.service';
import {
  aggregateAlertsForCarrierAndRange,
  buildWeeklyReportPdf,
  getCarrierSnapshot,
  listAttachmentsForReport,
  WeeklyReportType,
} from '../services/weeklyReport.service';
import {
  COMPANY_PROFILE,
  extractInitials,
  generateFolio,
  inferStateCode,
} from '../services/folio.service';

/**
 * Construye y persiste el PDF de un reporte. Se usa al generar y al regenerar.
 * Devuelve la URL del PDF subido a Azure.
 */
const persistPdf = async (params: {
  weekly_report_id: number;
  carrierId: number;
  period_from: string;
  period_to: string;
  folio: string;
  city: string;
  signerName: string;
  signerRole: string;
  summary?: string;
  reportType?: WeeklyReportType;
}): Promise<{ url: string; total: number; reported: number; unreported: number }> => {
  const carrier = await getCarrierSnapshot(params.carrierId);
  if (!carrier) {
    throw new Error('Portador no encontrado al construir el PDF.');
  }
  const aggregate = await aggregateAlertsForCarrierAndRange(
    params.carrierId,
    params.period_from,
    params.period_to,
    params.reportType ?? 'full',
  );
  const attachments = await listAttachmentsForReport(params.weekly_report_id);

  // Descarga las imágenes adjuntas a memoria.
  const attachmentBuffers = new Map<number, Buffer>();
  for (const att of attachments) {
    try {
      const resp = await axios.get<ArrayBuffer>(att.file_url, {
        responseType: 'arraybuffer',
      });
      attachmentBuffers.set(att.attachment_id, Buffer.from(resp.data));
    } catch (err) {
      logWarning('No se pudo descargar attachment', {
        id: att.attachment_id,
        url: att.file_url,
        error: (err as Error).message,
      });
    }
  }

  const pdfBuffer = await buildWeeklyReportPdf({
    meta: {
      city: params.city,
      folio: params.folio,
      issuedDate: new Date().toISOString().slice(0, 10),
      period_from: params.period_from,
      period_to: params.period_to,
      summary: params.summary,
      signerName: params.signerName,
      signerRole: params.signerRole,
      reportType: params.reportType ?? 'full',
    },
    carrier,
    data: aggregate,
    attachments,
    attachmentBuffers,
  });

  const filename = `${params.folio.replace(/\//g, '-')}-${Date.now()}.pdf`;
  const uploadResult = await azureUploadBlob({
    blob: {
      originalname: filename,
      buffer: pdfBuffer,
      size: pdfBuffer.length,
      mimetype: 'application/pdf',
    } as any,
    containerName: 'weekly-reports',
  });
  if (!uploadResult.success) {
    throw new Error(uploadResult.message);
  }
  return {
    url: uploadResult.message,
    total: aggregate.total_alerts,
    reported: aggregate.reported_alerts,
    unreported: aggregate.unreported_alerts,
  };
};

// =============================================================================
// POST /weekly-reports/generate
// =============================================================================
export const generateWeeklyReport = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });

  const {
    carrier_id,
    period_from,
    period_to,
    title,
    summary,
    state_code,
    report_type,
  } = req.body as {
    carrier_id: number;
    period_from: string;
    period_to: string;
    title?: string;
    summary?: string;
    state_code?: string;
    report_type?: WeeklyReportType;
  };
  const reportType: WeeklyReportType = report_type ?? 'full';

  const carrier = await getCarrierSnapshot(carrier_id);
  if (!carrier) {
    return res.status(404).json({ message: 'Portador no encontrado.' });
  }

  // Folio
  const initials = extractInitials(carrier.subject_name);
  const stateCode =
    state_code?.toUpperCase() || inferStateCode(carrier.residence_area, carrier.installation_location);
  const year = new Date().getFullYear();
  const folio = await generateFolio({ stateCode, initials, year });

  // Insertar registro (sin URL aún)
  const insertRes = await pool.query<{ weekly_report_id: number }>({
    text: `INSERT INTO WEEKLY_REPORTS
             (period_from, period_to, title, summary,
              carrier_id, folio, state_code,
              subject_name, bracelet_serial, installation_date, installation_location,
              city, signer_name, signer_role,
              total_alerts, reported_alerts, unreported_alerts, generated_by, report_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0,0,$15,$16)
           RETURNING weekly_report_id`,
    values: [
      period_from,
      period_to,
      title ?? null,
      summary ?? null,
      carrier_id,
      folio,
      stateCode,
      carrier.subject_name,
      carrier.bracelet_serial,
      carrier.installation_date,
      carrier.installation_location,
      COMPANY_PROFILE.city,
      COMPANY_PROFILE.signerName,
      COMPANY_PROFILE.signerRole,
      user.id,
      reportType,
    ],
  });
  const weekly_report_id = insertRes.rows[0].weekly_report_id;

  // Construir PDF y subir
  const built = await persistPdf({
    weekly_report_id,
    carrierId: carrier_id,
    period_from,
    period_to,
    folio,
    city: COMPANY_PROFILE.city,
    signerName: COMPANY_PROFILE.signerName,
    signerRole: COMPANY_PROFILE.signerRole,
    summary,
    reportType,
  });

  // Actualizar URL y contadores
  const finalRow = await pool.query({
    text: `UPDATE WEEKLY_REPORTS
           SET report_document   = $1,
               total_alerts      = $2,
               reported_alerts   = $3,
               unreported_alerts = $4,
               updated_at        = NOW()
           WHERE weekly_report_id = $5
           RETURNING *`,
    values: [built.url, built.total, built.reported, built.unreported, weekly_report_id],
  });

  logSuccess('Reporte semanal generado', {
    folio,
    carrier_id,
    total: built.total,
  });
  return res.status(201).json({ success: true, data: finalRow.rows[0] });
});

// =============================================================================
// POST /weekly-reports/:id/regenerate — reconstruye el PDF con los attachments
// actuales. NO genera un folio nuevo.
// =============================================================================
export const regenerateWeeklyReport = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const rep = await pool.query({
    text: 'SELECT * FROM WEEKLY_REPORTS WHERE weekly_report_id = $1',
    values: [id],
  });
  const row = rep.rows[0];
  if (!row) return res.status(404).json({ message: 'Reporte no encontrado.' });
  if (!row.carrier_id || !row.folio) {
    return res.status(409).json({
      message: 'El reporte fue creado con el formato anterior y no se puede regenerar.',
    });
  }

  const built = await persistPdf({
    weekly_report_id: row.weekly_report_id,
    carrierId: row.carrier_id,
    period_from: row.period_from.toISOString().slice(0, 10),
    period_to: row.period_to.toISOString().slice(0, 10),
    folio: row.folio,
    city: row.city ?? COMPANY_PROFILE.city,
    signerName: row.signer_name ?? COMPANY_PROFILE.signerName,
    signerRole: row.signer_role ?? COMPANY_PROFILE.signerRole,
    summary: row.summary,
    reportType: (row.report_type as WeeklyReportType) ?? 'full',
  });

  const final = await pool.query({
    text: `UPDATE WEEKLY_REPORTS
           SET report_document   = $1,
               total_alerts      = $2,
               reported_alerts   = $3,
               unreported_alerts = $4,
               updated_at        = NOW()
           WHERE weekly_report_id = $5
           RETURNING *`,
    values: [built.url, built.total, built.reported, built.unreported, id],
  });

  return res.status(200).json({ success: true, data: final.rows[0] });
});

// =============================================================================
// GET /weekly-reports
// =============================================================================
export const listWeeklyReports = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

  const conditions: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (req.query.from) {
    conditions.push(`period_to >= $${i++}`);
    values.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push(`period_from <= $${i++}`);
    values.push(req.query.to);
  }
  if (req.query.carrier_id) {
    conditions.push(`carrier_id = $${i++}`);
    values.push(req.query.carrier_id);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await pool.query<{ total: string }>({
    text: `SELECT COUNT(*)::text AS total FROM WEEKLY_REPORTS ${where}`,
    values,
  });
  const rows = await pool.query({
    text: `SELECT wr.weekly_report_id, wr.period_from, wr.period_to, wr.title,
                  wr.summary, wr.folio, wr.state_code,
                  wr.subject_name, wr.bracelet_serial, wr.carrier_id,
                  wr.installation_date, wr.installation_location,
                  wr.total_alerts, wr.reported_alerts, wr.unreported_alerts,
                  wr.report_document, wr.generated_at, wr.generated_by,
                  wr.report_type,
                  u.name AS generated_by_name
           FROM WEEKLY_REPORTS wr
           LEFT JOIN USERS u ON u.user_id = wr.generated_by
           ${where}
           ORDER BY wr.generated_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
    values: [...values, limit, offset],
  });

  return res.status(200).json({
    success: true,
    data: rows.rows,
    total: parseInt(total.rows[0].total, 10),
    limit,
    offset,
  });
});

// =============================================================================
// GET /weekly-reports/:id
// =============================================================================
export const getWeeklyReport = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query({
    text: `SELECT wr.*, u.name AS generated_by_name
           FROM WEEKLY_REPORTS wr
           LEFT JOIN USERS u ON u.user_id = wr.generated_by
           WHERE weekly_report_id = $1`,
    values: [id],
  });
  if (result.rowCount === 0) return res.status(404).json({ message: 'Reporte no encontrado.' });

  const attachments = await listAttachmentsForReport(parseInt(id, 10));
  return res.status(200).json({
    success: true,
    data: { ...result.rows[0], attachments },
  });
});

// =============================================================================
// GET /weekly-reports/:id/download
// =============================================================================
export const downloadWeeklyReport = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query({
    text: 'SELECT report_document FROM WEEKLY_REPORTS WHERE weekly_report_id = $1',
    values: [id],
  });
  const row = result.rows[0];
  if (!row || !row.report_document) {
    return res.status(404).json({ message: 'Reporte no tiene archivo asociado.' });
  }
  return res.redirect(row.report_document);
});

// =============================================================================
// DELETE /weekly-reports/:id
// =============================================================================
export const deleteWeeklyReport = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query({
    text: 'DELETE FROM WEEKLY_REPORTS WHERE weekly_report_id = $1',
    values: [id],
  });
  if (result.rowCount === 0) return res.status(404).json({ message: 'Reporte no encontrado.' });
  return res.status(200).json({ success: true, message: 'Reporte eliminado.' });
});

// =============================================================================
// Attachments
// =============================================================================

export const uploadAttachments = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const { id } = req.params;
  const section = ((req.body.section as string) || 'recorrido').toLowerCase();
  if (!['mensajes', 'recorrido', 'evidencia'].includes(section)) {
    return res.status(400).json({ message: 'section debe ser mensajes, recorrido o evidencia.' });
  }
  const caption = (req.body.caption as string) || null;
  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) {
    return res.status(400).json({ message: 'No se recibieron imágenes (campo "images").' });
  }

  // Verifica que el reporte existe
  const repCheck = await pool.query({
    text: 'SELECT weekly_report_id FROM WEEKLY_REPORTS WHERE weekly_report_id = $1',
    values: [id],
  });
  if (repCheck.rowCount === 0) {
    return res.status(404).json({ message: 'Reporte no encontrado.' });
  }

  // Obtener el siguiente display_order
  const orderRes = await pool.query<{ next: number }>({
    text: `SELECT COALESCE(MAX(display_order), 0) + 1 AS next
           FROM WEEKLY_REPORT_ATTACHMENTS WHERE weekly_report_id = $1`,
    values: [id],
  });
  let nextOrder = orderRes.rows[0].next;

  const uploaded: any[] = [];
  for (const file of files) {
    const folderPath = `report-${id}`;
    const result = await azureUploadBlob({
      blob: file,
      containerName: 'weekly-reports',
      folderPath,
    });
    if (!result.success) {
      logWarning('Fallo subiendo imagen del reporte', {
        filename: file.originalname,
        message: result.message,
      });
      continue;
    }
    const ins = await pool.query({
      text: `INSERT INTO WEEKLY_REPORT_ATTACHMENTS
               (weekly_report_id, file_url, filename, mime_type, caption, section, display_order, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING attachment_id, file_url, filename, mime_type, caption, section, display_order`,
      values: [
        id,
        result.message,
        file.originalname,
        file.mimetype,
        caption,
        section,
        nextOrder++,
        user.id,
      ],
    });
    uploaded.push(ins.rows[0]);
  }

  return res.status(201).json({ success: true, data: uploaded });
});

export const deleteAttachment = asyncHandler(async (req: Request, res: Response) => {
  const { id, attachmentId } = req.params;
  const r = await pool.query({
    text: `DELETE FROM WEEKLY_REPORT_ATTACHMENTS
           WHERE attachment_id = $1 AND weekly_report_id = $2`,
    values: [attachmentId, id],
  });
  if (r.rowCount === 0) {
    return res.status(404).json({ message: 'Anexo no encontrado.' });
  }
  return res.status(200).json({ success: true, message: 'Anexo eliminado.' });
});
