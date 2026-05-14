import { Request, Response } from 'express';
import { pool } from '../database/connection';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { logSuccess } from '../middlewares/loggingMiddleware';
import { ALERT_TEMPLATE_VARIABLES } from '../services/alert.service';

/**
 * GET /alert-protocols
 * Lista todas las plantillas, incluye inactivas para que Admin pueda gestionar.
 */
export const listAlertProtocols = asyncHandler(async (_req: Request, res: Response) => {
  const result = await pool.query({
    text: `SELECT protocol_id, alert_type, label, message_template, is_active,
                  created_by, created_at, updated_at
           FROM ALERT_PROTOCOLS
           ORDER BY label ASC`,
  });
  return res.status(200).json({
    success: true,
    data: result.rows,
    available_variables: ALERT_TEMPLATE_VARIABLES,
  });
});

export const getAlertProtocol = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query({
    text: `SELECT protocol_id, alert_type, label, message_template, is_active,
                  created_by, created_at, updated_at
           FROM ALERT_PROTOCOLS WHERE protocol_id = $1`,
    values: [id],
  });
  const row = result.rows[0];
  if (!row) return res.status(404).json({ message: 'Plantilla no encontrada.' });
  return res.status(200).json({ success: true, data: row });
});

/**
 * POST /alert-protocols
 */
export const createAlertProtocol = asyncHandler(async (req: Request, res: Response) => {
  const { alert_type, label, message_template, is_active } = req.body;
  const result = await pool.query({
    text: `INSERT INTO ALERT_PROTOCOLS (alert_type, label, message_template, is_active, created_by)
           VALUES ($1, $2, $3, COALESCE($4, TRUE), $5)
           RETURNING protocol_id, alert_type, label, message_template, is_active`,
    values: [alert_type, label, message_template, is_active, req.user?.id ?? null],
  });
  logSuccess('Plantilla de alerta creada', { alert_type });
  return res.status(201).json({ success: true, data: result.rows[0] });
});

/**
 * PUT /alert-protocols/:id
 */
export const updateAlertProtocol = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { alert_type, label, message_template, is_active } = req.body;
  const result = await pool.query({
    text: `UPDATE ALERT_PROTOCOLS
           SET alert_type       = COALESCE($1, alert_type),
               label            = COALESCE($2, label),
               message_template = COALESCE($3, message_template),
               is_active        = COALESCE($4, is_active),
               updated_at       = NOW()
           WHERE protocol_id = $5
           RETURNING protocol_id, alert_type, label, message_template, is_active`,
    values: [alert_type ?? null, label ?? null, message_template ?? null, is_active ?? null, id],
  });
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Plantilla no encontrada.' });
  }
  return res.status(200).json({ success: true, data: result.rows[0] });
});

/**
 * DELETE /alert-protocols/:id
 * Si hay alertas que referencian la plantilla → soft delete (is_active=false).
 * Si no hay referencias → hard delete.
 */
export const deleteAlertProtocol = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const refs = await pool.query<{ count: string }>({
    text: 'SELECT COUNT(*)::text AS count FROM ALERTS WHERE protocol_id = $1',
    values: [id],
  });
  const referenced = parseInt(refs.rows[0].count, 10) > 0;

  if (referenced) {
    const upd = await pool.query({
      text: `UPDATE ALERT_PROTOCOLS SET is_active = FALSE, updated_at = NOW()
             WHERE protocol_id = $1 RETURNING protocol_id`,
      values: [id],
    });
    if (upd.rowCount === 0) return res.status(404).json({ message: 'Plantilla no encontrada.' });
    return res.status(200).json({
      success: true,
      message: 'Plantilla desactivada (tiene alertas históricas referenciándola).',
    });
  }

  const del = await pool.query({
    text: 'DELETE FROM ALERT_PROTOCOLS WHERE protocol_id = $1',
    values: [id],
  });
  if (del.rowCount === 0) return res.status(404).json({ message: 'Plantilla no encontrada.' });
  return res.status(200).json({ success: true, message: 'Plantilla eliminada.' });
});
