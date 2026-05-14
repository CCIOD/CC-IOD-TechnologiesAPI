import { Request, Response } from 'express';
import { pool } from '../database/connection';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { logSuccess, logWarning } from '../middlewares/loggingMiddleware';

// =============================================================================
// IP Whitelist
// =============================================================================

export const listIpWhitelist = asyncHandler(async (_req: Request, res: Response) => {
  const result = await pool.query({
    text: `SELECT ip_whitelist_id, cidr::text AS cidr, label, is_active,
                  created_by, created_at, updated_at
           FROM IP_WHITELIST
           ORDER BY created_at DESC`,
  });
  return res.status(200).json({ success: true, data: result.rows });
});

export const createIpWhitelist = asyncHandler(async (req: Request, res: Response) => {
  const { cidr, label, is_active } = req.body as {
    cidr?: string;
    label?: string;
    is_active?: boolean;
  };
  if (!cidr || !label) {
    return res.status(400).json({ message: 'cidr y label son requeridos.' });
  }
  const result = await pool.query({
    text: `INSERT INTO IP_WHITELIST (cidr, label, is_active, created_by)
           VALUES ($1::cidr, $2, COALESCE($3, TRUE), $4)
           RETURNING ip_whitelist_id, cidr::text AS cidr, label, is_active`,
    values: [cidr, label, is_active, req.user?.id ?? null],
  });
  logSuccess('IP whitelist creada', { cidr, label });
  return res.status(201).json({ success: true, data: result.rows[0] });
});

export const updateIpWhitelist = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { cidr, label, is_active } = req.body as {
    cidr?: string;
    label?: string;
    is_active?: boolean;
  };
  const result = await pool.query({
    text: `UPDATE IP_WHITELIST
           SET cidr = COALESCE($1::cidr, cidr),
               label = COALESCE($2, label),
               is_active = COALESCE($3, is_active),
               updated_at = NOW()
           WHERE ip_whitelist_id = $4
           RETURNING ip_whitelist_id, cidr::text AS cidr, label, is_active`,
    values: [cidr ?? null, label ?? null, is_active ?? null, id],
  });
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Entrada no encontrada.' });
  }
  return res.status(200).json({ success: true, data: result.rows[0] });
});

export const deleteIpWhitelist = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query({
    text: 'DELETE FROM IP_WHITELIST WHERE ip_whitelist_id = $1',
    values: [id],
  });
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Entrada no encontrada.' });
  }
  logWarning('IP whitelist eliminada', { id });
  return res.status(200).json({ success: true, message: 'Eliminada.' });
});

// =============================================================================
// Dispositivos autorizados
// =============================================================================

export const listDevices = asyncHandler(async (_req: Request, res: Response) => {
  const result = await pool.query({
    text: `SELECT d.device_id, d.device_token, d.label, d.is_active,
                  d.last_seen_at, d.created_at, d.updated_at,
                  d.user_id, u.name AS user_name, u.email AS user_email
           FROM AUTHORIZED_DEVICES d
           LEFT JOIN USERS u ON u.user_id = d.user_id
           ORDER BY d.created_at DESC`,
  });
  return res.status(200).json({ success: true, data: result.rows });
});

export const createDevice = asyncHandler(async (req: Request, res: Response) => {
  const { device_token, label, user_id, is_active } = req.body as {
    device_token?: string;
    label?: string;
    user_id?: number | null;
    is_active?: boolean;
  };
  if (!device_token || !label) {
    return res.status(400).json({ message: 'device_token y label son requeridos.' });
  }
  const result = await pool.query({
    text: `INSERT INTO AUTHORIZED_DEVICES (device_token, label, user_id, is_active, created_by)
           VALUES ($1, $2, $3, COALESCE($4, TRUE), $5)
           RETURNING device_id, device_token, label, user_id, is_active`,
    values: [device_token, label, user_id ?? null, is_active, req.user?.id ?? null],
  });
  logSuccess('Dispositivo autorizado creado', { label });
  return res.status(201).json({ success: true, data: result.rows[0] });
});

export const updateDevice = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { device_token, label, user_id, is_active } = req.body as {
    device_token?: string;
    label?: string;
    user_id?: number | null;
    is_active?: boolean;
  };
  const result = await pool.query({
    text: `UPDATE AUTHORIZED_DEVICES
           SET device_token = COALESCE($1, device_token),
               label        = COALESCE($2, label),
               user_id      = $3,
               is_active    = COALESCE($4, is_active),
               updated_at   = NOW()
           WHERE device_id = $5
           RETURNING device_id, device_token, label, user_id, is_active`,
    values: [device_token ?? null, label ?? null, user_id ?? null, is_active ?? null, id],
  });
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Dispositivo no encontrado.' });
  }
  return res.status(200).json({ success: true, data: result.rows[0] });
});

export const deleteDevice = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query({
    text: 'DELETE FROM AUTHORIZED_DEVICES WHERE device_id = $1',
    values: [id],
  });
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Dispositivo no encontrado.' });
  }
  logWarning('Dispositivo autorizado eliminado', { id });
  return res.status(200).json({ success: true, message: 'Eliminado.' });
});

// =============================================================================
// Intentos de acceso (read-only)
// =============================================================================

/**
 * GET /access-control/monitoristas-report?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Reporte agregado por monitorista. Si se pasan `from`/`to`, los contadores
 * (total_logins, failed) se calculan dentro del rango; last_login_at se
 * mantiene como el último login dentro del rango (NULL si no hubo).
 */
export const listMonitoristasReport = asyncHandler(
  async (req: Request, res: Response) => {
    const from = (req.query.from as string | undefined) || null;
    const to = (req.query.to as string | undefined) || null;

    const result = await pool.query({
      text: `
        SELECT
          u.user_id,
          u.name,
          u.email,
          COALESCE(s.total_logins, 0)::int AS total_logins,
          s.last_login_at,
          s.last_method,
          s.last_ip,
          s.last_device_token,
          COALESCE(f.failed_in_range, 0)::int AS failed_in_range
        FROM USERS u
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) AS total_logins,
            MAX(attempted_at) AS last_login_at,
            (ARRAY_AGG(method ORDER BY attempted_at DESC))[1] AS last_method,
            (ARRAY_AGG(ip_address ORDER BY attempted_at DESC))[1] AS last_ip,
            (ARRAY_AGG(device_token ORDER BY attempted_at DESC))[1] AS last_device_token
          FROM ACCESS_ATTEMPTS
          WHERE user_id = u.user_id
            AND outcome = 'success'
            AND ($1::timestamp IS NULL OR attempted_at >= $1::timestamp)
            AND ($2::timestamp IS NULL OR attempted_at <  ($2::timestamp + INTERVAL '1 day'))
        ) s ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS failed_in_range FROM ACCESS_ATTEMPTS
          WHERE user_id = u.user_id
            AND outcome != 'success'
            AND ($1::timestamp IS NULL OR attempted_at >= $1::timestamp)
            AND ($2::timestamp IS NULL OR attempted_at <  ($2::timestamp + INTERVAL '1 day'))
        ) f ON TRUE
        WHERE u.role_id = 6
        ORDER BY s.last_login_at DESC NULLS LAST, u.name ASC
      `,
      values: [from, to],
    });
    return res.status(200).json({
      success: true,
      data: result.rows,
      filters: { from, to },
    });
  },
);

/**
 * GET /access-control/monitoristas/:userId/sessions
 * Lista TODAS las sesiones (intentos de acceso) del monitorista. Acepta
 * los mismos filtros que el listado general (outcome, method, from, to).
 */
export const listMonitoristaSessions = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ message: 'userId inválido.' });
    }
    const limit = Math.min(
      parseInt((req.query.limit as string) ?? '100', 10) || 100,
      500,
    );
    const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

    const conditions: string[] = ['user_id = $1'];
    const values: any[] = [userId];
    let i = 2;
    if (req.query.outcome) {
      conditions.push(`outcome = $${i++}`);
      values.push(req.query.outcome);
    }
    if (req.query.method) {
      conditions.push(`method = $${i++}`);
      values.push(req.query.method);
    }
    if (req.query.from) {
      conditions.push(`attempted_at >= $${i++}::timestamp`);
      values.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push(`attempted_at < ($${i++}::timestamp + INTERVAL '1 day')`);
      values.push(req.query.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const totalRes = await pool.query<{ total: string }>({
      text: `SELECT COUNT(*)::text AS total FROM ACCESS_ATTEMPTS ${where}`,
      values,
    });
    const rowsRes = await pool.query({
      text: `SELECT attempt_id, ip_address, device_token, user_agent,
                    method, outcome, failure_reason, attempted_at
             FROM ACCESS_ATTEMPTS
             ${where}
             ORDER BY attempted_at DESC
             LIMIT $${i++} OFFSET $${i++}`,
      values: [...values, limit, offset],
    });

    return res.status(200).json({
      success: true,
      data: rowsRes.rows,
      total: parseInt(totalRes.rows[0].total, 10),
      limit,
      offset,
    });
  },
);

export const listAccessAttempts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

  const conditions: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (req.query.outcome) {
    conditions.push(`outcome = $${i++}`);
    values.push(req.query.outcome);
  }
  if (req.query.method) {
    conditions.push(`method = $${i++}`);
    values.push(req.query.method);
  }
  if (req.query.email) {
    conditions.push(`email = $${i++}`);
    values.push((req.query.email as string).toLowerCase());
  }
  if (req.query.from) {
    conditions.push(`attempted_at >= $${i++}`);
    values.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push(`attempted_at <= $${i++}`);
    values.push(req.query.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const totalRes = await pool.query<{ total: string }>({
    text: `SELECT COUNT(*)::text AS total FROM ACCESS_ATTEMPTS ${where}`,
    values,
  });

  const rowsRes = await pool.query({
    text: `SELECT a.attempt_id, a.user_id, a.email, a.ip_address, a.device_token,
                  a.user_agent, a.method, a.outcome, a.failure_reason, a.attempted_at,
                  u.name AS user_name
           FROM ACCESS_ATTEMPTS a
           LEFT JOIN USERS u ON u.user_id = a.user_id
           ${where}
           ORDER BY attempted_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
    values: [...values, limit, offset],
  });

  return res.status(200).json({
    success: true,
    data: rowsRes.rows,
    total: parseInt(totalRes.rows[0].total, 10),
    limit,
    offset,
  });
});
