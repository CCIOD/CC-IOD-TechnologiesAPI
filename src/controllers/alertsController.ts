import { Request, Response } from 'express';
import { pool } from '../database/connection';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { logSuccess, logWarning } from '../middlewares/loggingMiddleware';
import {
  getActiveProtocolByType,
  getCarrierContext,
  getClientName,
  renderProtocolMessage,
  formatNow,
  AlertTemplateContext,
} from '../services/alert.service';
import {
  logAlertEvent,
  logMultipleAlertFieldChanges,
} from '../services/audit.service';
import { azureUploadBlob } from '../services/azure.service';
import { buildAlertReportPdf } from '../services/alertReport.service';
import {
  COMPANY_PROFILE,
  extractInitials,
  generateFolio,
  inferStateCode,
} from '../services/folio.service';

interface AlertRow {
  alert_id: number;
  alert_type: string;
  protocol_id: number | null;
  carrier_id: number | null;
  client_id: number | null;
  zona_inclusion: string | null;
  zona_exclusion: string | null;
  house_arrest: string | null;
  correa: string | null;
  info_operativa: string | null;
  generated_message: string;
  status: 'activa' | 'desactivada';
  activated_at: string;
  activated_by: number;
  deactivated_at: string | null;
  deactivated_by: number | null;
  reported_to_authority: boolean;
  reported_at: string | null;
  reported_by: number | null;
  report_document: string | null;
  locked: boolean;
  created_at: string;
  updated_at: string;
}

const editableFields = [
  'zona_inclusion',
  'zona_exclusion',
  'house_arrest',
  'correa',
  'info_operativa',
] as const;
type EditableField = (typeof editableFields)[number];

// =============================================================================
// POST /alerts — crear alerta
// =============================================================================

export const createAlert = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });

  const {
    alert_type,
    carrier_id,
    client_id,
    zona_inclusion,
    zona_exclusion,
    house_arrest,
    correa,
    info_operativa,
  } = req.body as {
    alert_type: string;
    carrier_id?: number | null;
    client_id?: number | null;
    zona_inclusion?: string | null;
    zona_exclusion?: string | null;
    house_arrest?: string | null;
    correa?: string | null;
    info_operativa?: string | null;
  };

  const protocol = await getActiveProtocolByType(alert_type);
  if (!protocol) {
    return res.status(400).json({
      success: false,
      message: `No existe una plantilla activa para el tipo "${alert_type}".`,
    });
  }

  const carrierCtx = await getCarrierContext(carrier_id);
  const directClient = !carrierCtx && client_id ? await getClientName(client_id) : null;
  const { hora, fecha } = formatNow();

  const ctx: AlertTemplateContext = {
    portador: carrierCtx?.client_name ?? directClient ?? 'Sin asignar',
    cliente: carrierCtx?.client_name ?? directClient ?? 'Sin asignar',
    tipo: alert_type,
    protocolo: protocol.label,
    zona: zona_exclusion || zona_inclusion || 'No especificada',
    zona_inclusion: zona_inclusion ?? '',
    zona_exclusion: zona_exclusion ?? '',
    house_arrest: house_arrest ?? '',
    correa: correa ?? '',
    hora,
    fecha,
    info: info_operativa ?? '',
  } as AlertTemplateContext;

  const generated_message = renderProtocolMessage(protocol.message_template, ctx);

  const result = await pool.query<AlertRow>({
    text: `INSERT INTO ALERTS
             (alert_type, protocol_id, carrier_id, client_id,
              zona_inclusion, zona_exclusion, house_arrest, correa, info_operativa,
              generated_message, status, activated_at, activated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'activa', NOW(), $11)
           RETURNING *`,
    values: [
      alert_type,
      protocol.protocol_id,
      carrier_id ?? null,
      client_id ?? carrierCtx?.client_id ?? null,
      zona_inclusion ?? null,
      zona_exclusion ?? null,
      house_arrest ?? null,
      correa ?? null,
      info_operativa ?? null,
      generated_message,
      user.id,
    ],
  });

  const alert = result.rows[0];
  await logAlertEvent({
    alert_id: alert.alert_id,
    user_id: user.id,
    user_name: user.name,
    action_type: 'CREATE',
    new_value: generated_message,
    ip_address: (req as any).clientIp,
    user_agent: req.headers['user-agent'] as string | undefined,
  });

  // Reconsulta para incluir los campos derivados (subject_name, authority_*),
  // que necesita el frontend para los botones de copiar/WhatsApp/correo.
  const fullRes = await pool.query({
    text: `SELECT a.*,
                  ua.name AS activated_by_name,
                  p.label AS protocol_label,
                  cc.defendant_name AS subject_name,
                  cc.status AS subject_status,
                  ca.electronic_bracelet AS bracelet_serial,
                  ca.authority_whatsapp,
                  ca.authority_email
           FROM ALERTS a
           LEFT JOIN USERS ua ON ua.user_id = a.activated_by
           LEFT JOIN ALERT_PROTOCOLS p ON p.protocol_id = a.protocol_id
           LEFT JOIN CARRIERS ca ON ca.carrier_id = a.carrier_id
           LEFT JOIN CLIENTS cc ON cc.client_id = COALESCE(a.client_id, ca.client_id)
           WHERE a.alert_id = $1`,
    values: [alert.alert_id],
  });

  logSuccess('Alerta creada', { alert_id: alert.alert_id, alert_type });
  return res.status(201).json({ success: true, data: fullRes.rows[0] ?? alert });
});

// =============================================================================
// PUT /alerts/:id/deactivate
// =============================================================================

export const deactivateAlert = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const { id } = req.params;

  const current = await pool.query<AlertRow>({
    text: 'SELECT * FROM ALERTS WHERE alert_id = $1',
    values: [id],
  });
  const row = current.rows[0];
  if (!row) return res.status(404).json({ message: 'Alerta no encontrada.' });
  if (row.locked) {
    return res.status(409).json({
      success: false,
      message: 'La alerta está bloqueada (reportada a la autoridad). No se puede modificar.',
    });
  }
  if (row.status === 'desactivada') {
    return res.status(409).json({
      success: false,
      message: 'La alerta ya está desactivada.',
    });
  }

  const result = await pool.query<AlertRow>({
    text: `UPDATE ALERTS
           SET status = 'desactivada',
               deactivated_at = NOW(),
               deactivated_by = $1,
               updated_at = NOW()
           WHERE alert_id = $2
           RETURNING *`,
    values: [user.id, id],
  });

  await logAlertEvent({
    alert_id: result.rows[0].alert_id,
    user_id: user.id,
    user_name: user.name,
    action_type: 'DEACTIVATE',
    ip_address: (req as any).clientIp,
    user_agent: req.headers['user-agent'] as string | undefined,
  });

  return res.status(200).json({ success: true, data: result.rows[0] });
});

// =============================================================================
// PUT /alerts/:id — edición pre-reporte (FASE 3)
// =============================================================================

export const updateAlert = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const { id } = req.params;

  const current = await pool.query<AlertRow>({
    text: 'SELECT * FROM ALERTS WHERE alert_id = $1',
    values: [id],
  });
  const row = current.rows[0];
  if (!row) return res.status(404).json({ message: 'Alerta no encontrada.' });
  if (row.locked || row.reported_to_authority) {
    return res.status(409).json({
      success: false,
      message: 'La alerta fue reportada a la autoridad y está bloqueada para edición.',
    });
  }

  const changes: { field_name: string; old_value: string; new_value: string }[] = [];
  const setParts: string[] = [];
  const values: any[] = [];
  let i = 1;

  for (const f of editableFields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      const newVal = (req.body[f as EditableField] ?? null) as string | null;
      const oldVal = (row[f as EditableField] ?? null) as string | null;
      if ((newVal ?? '') !== (oldVal ?? '')) {
        setParts.push(`${f} = $${i++}`);
        values.push(newVal);
        changes.push({
          field_name: f,
          old_value: oldVal ?? '',
          new_value: newVal ?? '',
        });
      }
    }
  }

  if (setParts.length === 0) {
    return res.status(200).json({ success: true, data: row, message: 'Sin cambios.' });
  }

  setParts.push('updated_at = NOW()');
  values.push(id);
  const result = await pool.query<AlertRow>({
    text: `UPDATE ALERTS SET ${setParts.join(', ')} WHERE alert_id = $${i} RETURNING *`,
    values,
  });

  await logMultipleAlertFieldChanges(
    Number(id),
    user.id,
    user.name || 'desconocido',
    changes,
    (req as any).clientIp,
    req.headers['user-agent'] as string | undefined,
  );

  return res.status(200).json({ success: true, data: result.rows[0] });
});

// =============================================================================
// POST /alerts/:id/report — reportar a autoridad + bloquear
// =============================================================================

/**
 * Helper compartido: construye y sube el PDF del oficio para una alerta.
 *
 * Modos:
 *  - `previewMode = true`: NO genera folio (usa placeholder "BORRADOR — sin
 *    asignar"). Sube las imágenes que lleguen y las devuelve para que el
 *    confirm las reutilice sin re-subirlas.
 *  - `previewMode = false`: genera un folio real consumiendo el siguiente
 *    secuencial y produce el oficio definitivo. Si llegan `existingAttachmentUrls`
 *    (provenientes de un preview previo), los reutiliza; de lo contrario,
 *    sube los `files` del request.
 */
async function buildAndUploadAlertReport(params: {
  alertId: number;
  files: Express.Multer.File[];
  existingAttachmentUrls?: string[];
  user: { id: number; name?: string };
  previewMode?: boolean;
}): Promise<
  | {
      ok: true;
      url: string;
      folio: string;
      attachmentsCount: number;
      attachmentUrls: string[];
    }
  | { ok: false; status: number; message: string }
> {
  const { alertId, files, existingAttachmentUrls, user, previewMode } = params;

  const current = await pool.query({
    text: `SELECT a.*,
                  cc.defendant_name AS subject_name,
                  ca.electronic_bracelet AS bracelet_serial,
                  ca.residence_area AS residence_area,
                  ca.authority_whatsapp,
                  ca.authority_email,
                  p.label AS protocol_label
           FROM ALERTS a
           LEFT JOIN ALERT_PROTOCOLS p ON p.protocol_id = a.protocol_id
           LEFT JOIN CARRIERS ca ON ca.carrier_id = a.carrier_id
           LEFT JOIN CLIENTS cc ON cc.client_id = COALESCE(a.client_id, ca.client_id)
           WHERE a.alert_id = $1`,
    values: [alertId],
  });
  const row = current.rows[0];
  if (!row) return { ok: false, status: 404, message: 'Alerta no encontrada.' };
  if (row.locked || row.reported_to_authority) {
    return {
      ok: false,
      status: 409,
      message: 'La alerta ya fue reportada a la autoridad.',
    };
  }

  const signerRes = await pool.query<{
    name: string;
    signature_url: string | null;
    role_name: string;
  }>({
    text: `SELECT u.name, u.signature_url, r.name AS role_name
           FROM USERS u INNER JOIN ROLES r ON u.role_id = r.role_id
           WHERE u.user_id = $1`,
    values: [user.id],
  });
  const signer = signerRes.rows[0];

  // Resolver anexos: si vienen URLs del preview, reutilizar; sino, subir files.
  const attachmentsUrls: { file_url: string; caption?: string | null }[] = [];
  if (existingAttachmentUrls && existingAttachmentUrls.length > 0) {
    for (const url of existingAttachmentUrls) {
      attachmentsUrls.push({ file_url: url });
    }
  } else {
    for (const file of files) {
      const folderPath = `alert-${alertId}/anexos`;
      // Aseguramos nombre único agregando timestamp, para que un mismo archivo
      // pueda subirse en múltiples previews sin colisionar con blobs anteriores.
      const baseName = (file as any).originalname || 'anexo.png';
      const dot = baseName.lastIndexOf('.');
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot > 0 ? baseName.slice(dot) : '.png';
      const uniqueName = `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const fileClone = { ...(file as any), originalname: uniqueName };
      const up = await azureUploadBlob({
        blob: fileClone as any,
        containerName: 'alert-reports',
        folderPath,
      });
      if (!up.success) {
        logWarning('Fallo subiendo anexo de alerta', { message: up.message });
        continue;
      }
      attachmentsUrls.push({ file_url: up.message });
    }
  }

  // Folio: real solo cuando NO es preview.
  let folio: string;
  if (previewMode) {
    folio = 'BORRADOR — folio asignado al confirmar';
  } else {
    const initials = extractInitials(row.subject_name || 'PORTADOR');
    const stateCode = inferStateCode(row.residence_area);
    const year = new Date().getFullYear();
    folio = await generateFolio({ stateCode, initials, year });
  }

  // PDF
  const pdfBuffer = await buildAlertReportPdf(
    {
      city: COMPANY_PROFILE.city,
      folio,
      issuedDate: new Date().toISOString().slice(0, 10),
      subjectName: row.subject_name || 'PORTADOR',
      installationDate: row.placement_date_carrier ?? null,
      installationLocation: row.residence_area || 'el domicilio del imputado',
      alertActivatedAt: new Date(row.activated_at).toISOString(),
      alertType: row.alert_type,
      protocolLabel: row.protocol_label ?? row.alert_type,
      authorityWhatsapp: row.authority_whatsapp ?? null,
      authorityEmail: row.authority_email ?? null,
      signerName: signer?.name ?? user.name ?? 'Centro de monitoreo',
      signerRole: signer?.role_name
        ? `${signer.role_name.toUpperCase()} DE LA EMPRESA CC-IOD TECHNOLOGIES`
        : 'CENTRO DE MONITOREO',
      signatureUrl: signer?.signature_url ?? null,
    },
    attachmentsUrls,
  );

  const safeFolio = previewMode
    ? `borrador-alert-${alertId}`
    : folio.replace(/\//g, '-');
  const pdfName = `${previewMode ? 'preview-' : ''}${safeFolio}-${Date.now()}.pdf`;
  const pdfUpload = await azureUploadBlob({
    blob: {
      originalname: pdfName,
      buffer: pdfBuffer,
      size: pdfBuffer.length,
      mimetype: 'application/pdf',
    } as any,
    containerName: 'alert-reports',
  });
  if (!pdfUpload.success) {
    return { ok: false, status: 500, message: pdfUpload.message };
  }
  return {
    ok: true,
    url: pdfUpload.message,
    folio,
    attachmentsCount: attachmentsUrls.length,
    attachmentUrls: attachmentsUrls.map((a) => a.file_url),
  };
}

/**
 * POST /alerts/:id/report/preview
 *
 * Genera el oficio (sube imágenes + PDF a Azure) pero NO bloquea la alerta.
 * Sirve para que el monitorista revise el documento antes de confirmar.
 * Devuelve la URL del PDF.
 */
export const previewAlertReport = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const result = await buildAndUploadAlertReport({
    alertId: Number(req.params.id),
    files: (req.files as Express.Multer.File[]) || [],
    user,
    previewMode: true,
  });
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.message });
  }
  logSuccess('Preview de reporte generado', { alert_id: req.params.id });
  return res.status(200).json({
    success: true,
    data: {
      preview_url: result.url,
      attachment_urls: result.attachmentUrls,
      attachments_count: result.attachmentsCount,
    },
  });
});

/**
 * POST /alerts/:id/report
 *
 * Genera el oficio definitivo con folio real y bloquea la alerta. Dos modos:
 *  - JSON con `{ attachment_urls }` (provenientes de un preview previo):
 *    reutiliza los anexos ya subidos, regenera el PDF con el folio real,
 *    sube y bloquea.
 *  - Multipart con `images` (sin pasar por preview, modo legado/atajo):
 *    sube las imágenes, genera folio real, PDF y bloquea.
 */
export const reportAlert = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const { id } = req.params;
  const { attachment_urls } = (req.body || {}) as {
    attachment_urls?: string[];
  };

  const built = await buildAndUploadAlertReport({
    alertId: Number(id),
    files: (req.files as Express.Multer.File[]) || [],
    existingAttachmentUrls: Array.isArray(attachment_urls) ? attachment_urls : undefined,
    user,
    previewMode: false,
  });
  if (!built.ok) {
    return res.status(built.status).json({ success: false, message: built.message });
  }

  const result = await pool.query<AlertRow>({
    text: `UPDATE ALERTS
           SET reported_to_authority = TRUE,
               reported_at = NOW(),
               reported_by = $1,
               report_document = $2,
               locked = TRUE,
               updated_at = NOW()
           WHERE alert_id = $3
           RETURNING *`,
    values: [user.id, built.url, id],
  });

  await logAlertEvent({
    alert_id: Number(id),
    user_id: user.id,
    user_name: user.name,
    action_type: 'REPORT',
    new_value: built.folio,
    ip_address: (req as any).clientIp,
    user_agent: req.headers['user-agent'] as string | undefined,
  });

  logSuccess('Alerta reportada a autoridad', { alert_id: id, folio: built.folio });
  return res.status(200).json({
    success: true,
    data: {
      ...result.rows[0],
      folio: built.folio,
      attachments_count: built.attachmentsCount,
    },
  });
});

// =============================================================================
// GET /alerts — listado con filtros (FASE 2)
// =============================================================================

export const listAlerts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

  const conditions: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (req.query.status) {
    conditions.push(`a.status = $${i++}`);
    values.push(req.query.status);
  }
  if (req.query.alert_type) {
    conditions.push(`a.alert_type = $${i++}`);
    values.push(req.query.alert_type);
  }
  if (req.query.reported !== undefined) {
    conditions.push(`a.reported_to_authority = $${i++}`);
    values.push(req.query.reported === 'true');
  }
  if (req.query.carrier_id) {
    conditions.push(`a.carrier_id = $${i++}`);
    values.push(req.query.carrier_id);
  }
  if (req.query.client_id) {
    conditions.push(`a.client_id = $${i++}`);
    values.push(req.query.client_id);
  }
  if (req.query.activated_by) {
    conditions.push(`a.activated_by = $${i++}`);
    values.push(req.query.activated_by);
  }
  if (req.query.from) {
    conditions.push(`a.activated_at >= $${i++}`);
    values.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push(`a.activated_at <= $${i++}`);
    values.push(req.query.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await pool.query<{ total: string }>({
    text: `SELECT COUNT(*)::text AS total FROM ALERTS a ${where}`,
    values,
  });
  const rows = await pool.query({
    text: `SELECT a.*,
                  ua.name AS activated_by_name,
                  ud.name AS deactivated_by_name,
                  ur.name AS reported_by_name,
                  p.label AS protocol_label,
                  cc.defendant_name AS subject_name,
                  cc.status AS subject_status,
                  ca.electronic_bracelet AS bracelet_serial,
                  ca.authority_whatsapp,
                  ca.authority_email
           FROM ALERTS a
           LEFT JOIN USERS ua ON ua.user_id = a.activated_by
           LEFT JOIN USERS ud ON ud.user_id = a.deactivated_by
           LEFT JOIN USERS ur ON ur.user_id = a.reported_by
           LEFT JOIN ALERT_PROTOCOLS p ON p.protocol_id = a.protocol_id
           LEFT JOIN CARRIERS ca ON ca.carrier_id = a.carrier_id
           LEFT JOIN CLIENTS cc ON cc.client_id = COALESCE(a.client_id, ca.client_id)
           ${where}
           ORDER BY a.activated_at DESC
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
// GET /alerts/:id — detalle + bitácora embebida
// =============================================================================

export const getAlert = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const alertRes = await pool.query({
    text: `SELECT a.*,
                  ua.name AS activated_by_name,
                  ud.name AS deactivated_by_name,
                  ur.name AS reported_by_name,
                  p.label AS protocol_label,
                  cc.defendant_name AS subject_name,
                  cc.status AS subject_status,
                  ca.electronic_bracelet AS bracelet_serial,
                  ca.authority_whatsapp,
                  ca.authority_email
           FROM ALERTS a
           LEFT JOIN USERS ua ON ua.user_id = a.activated_by
           LEFT JOIN USERS ud ON ud.user_id = a.deactivated_by
           LEFT JOIN USERS ur ON ur.user_id = a.reported_by
           LEFT JOIN ALERT_PROTOCOLS p ON p.protocol_id = a.protocol_id
           LEFT JOIN CARRIERS ca ON ca.carrier_id = a.carrier_id
           LEFT JOIN CLIENTS cc ON cc.client_id = COALESCE(a.client_id, ca.client_id)
           WHERE a.alert_id = $1`,
    values: [id],
  });
  const alert = alertRes.rows[0];
  if (!alert) return res.status(404).json({ message: 'Alerta no encontrada.' });

  const auditRes = await pool.query({
    text: `SELECT audit_id, action_type, field_name, old_value, new_value,
                  user_id, user_name, ip_address, created_at
           FROM ALERT_AUDIT_LOG
           WHERE alert_id = $1
           ORDER BY created_at ASC`,
    values: [id],
  });

  return res.status(200).json({
    success: true,
    data: {
      ...alert,
      is_locked: alert.locked === true,
      audit_log: auditRes.rows,
    },
  });
});

// =============================================================================
// GET /alerts/audit — bitácora general (FASE 3)
// =============================================================================

export const listAlertAudit = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

  const conditions: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (req.query.alert_id) {
    conditions.push(`al.alert_id = $${i++}`);
    values.push(req.query.alert_id);
  }
  if (req.query.user_id) {
    conditions.push(`al.user_id = $${i++}`);
    values.push(req.query.user_id);
  }
  if (req.query.action_type) {
    conditions.push(`al.action_type = $${i++}`);
    values.push(req.query.action_type);
  }
  if (req.query.from) {
    conditions.push(`al.created_at >= $${i++}`);
    values.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push(`al.created_at <= $${i++}`);
    values.push(req.query.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await pool.query<{ total: string }>({
    text: `SELECT COUNT(*)::text AS total FROM ALERT_AUDIT_LOG al ${where}`,
    values,
  });
  const rows = await pool.query({
    text: `SELECT al.audit_id, al.alert_id, al.user_id, al.user_name,
                  al.action_type, al.field_name, al.old_value, al.new_value,
                  al.ip_address, al.user_agent, al.created_at,
                  a.alert_type, a.status AS alert_status, a.reported_to_authority
           FROM ALERT_AUDIT_LOG al
           LEFT JOIN ALERTS a ON a.alert_id = al.alert_id
           ${where}
           ORDER BY al.created_at DESC
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
