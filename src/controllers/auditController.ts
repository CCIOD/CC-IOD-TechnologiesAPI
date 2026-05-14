import { NextFunction, Request, Response } from "express";
import { getClientAuditLog, getAllClientAuditLogs } from "../services/audit.service";
import { pool } from "../database/connection";
import { asyncHandler } from "../middlewares/enhancedMiddlewares";

/**
 * Obtiene el historial de cambios para un cliente específico
 */
export const getClientAuditHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const client_id = parseInt(req.params.id);
    
    if (!client_id || isNaN(client_id)) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
      });
    }

    const auditLog = await getClientAuditLog(client_id);

    return res.status(200).json({
      success: true,
      message: `Historial de cambios para el cliente ${client_id}`,
      data: auditLog,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtiene el historial de cambios de todos los clientes con filtros y paginación
 */
export const getAllClientsAuditHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const {
      page = 1,
      limit = 50,
      user_id,
      action_type,
      start_date,
      end_date,
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Validaciones
    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Parámetros de paginación inválidos. La página debe ser >= 1 y el límite entre 1 y 100.",
      });
    }

    const filters = {
      user_id: user_id ? parseInt(user_id as string) : undefined,
      action_type: action_type as string,
      start_date: start_date as string,
      end_date: end_date as string,
    };

    const { logs, total } = await getAllClientAuditLogs(
      limitNum,
      offset,
      filters.user_id,
      filters.action_type,
      filters.start_date,
      filters.end_date
    );

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      message: "Historial de cambios de clientes",
      data: logs,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords: total,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: filters,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtiene estadísticas de la bitácora de auditoría
 */
export const getAuditStatistics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const { start_date, end_date } = req.query;
    
    let dateFilter = '';
    let queryParams: string[] = [];
    
    if (start_date && end_date) {
      dateFilter = 'WHERE created_at BETWEEN $1 AND $2';
      queryParams = [start_date as string, end_date as string];
    } else if (start_date) {
      dateFilter = 'WHERE created_at >= $1';
      queryParams = [start_date as string];
    } else if (end_date) {
      dateFilter = 'WHERE created_at <= $1';
      queryParams = [end_date as string];
    }

    // Estadísticas por tipo de acción
    const actionStatsQuery = {
      text: `SELECT action_type, COUNT(*) as count 
             FROM CLIENT_AUDIT_LOG 
             ${dateFilter}
             GROUP BY action_type 
             ORDER BY count DESC`,
      values: queryParams,
    };

    // Estadísticas por usuario
    const userStatsQuery = {
      text: `SELECT user_name, user_id, COUNT(*) as count 
             FROM CLIENT_AUDIT_LOG 
             ${dateFilter}
             GROUP BY user_id, user_name 
             ORDER BY count DESC 
             LIMIT 10`,
      values: queryParams,
    };

    // Estadísticas por día (últimos 30 días o rango especificado)
    const dailyStatsQuery = {
      text: `SELECT DATE(created_at) as date, COUNT(*) as count 
             FROM CLIENT_AUDIT_LOG 
             ${dateFilter}
             GROUP BY DATE(created_at) 
             ORDER BY date DESC 
             LIMIT 30`,
      values: queryParams,
    };

    const [actionStats, userStats, dailyStats] = await Promise.all([
      require("../database/connection").pool.query(actionStatsQuery),
      require("../database/connection").pool.query(userStatsQuery),
      require("../database/connection").pool.query(dailyStatsQuery),
    ]);

    return res.status(200).json({
      success: true,
      message: "Estadísticas de auditoría",
      data: {
        actionStatistics: actionStats.rows,
        userStatistics: userStats.rows,
        dailyStatistics: dailyStats.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// FASE 5 — Vista unificada (clientes + alertas + accesos)
// =============================================================================

type AuditSource = 'clients' | 'alerts' | 'access';

/**
 * GET /audit/unified
 * Combina CLIENT_AUDIT_LOG + ALERT_AUDIT_LOG + ACCESS_ATTEMPTS en un solo feed
 * paginado y filtrable. Solo Admin/Director (las rutas lo restringen).
 *
 * Filtros: source, from, to, user_id, action_type, q (búsqueda en mensaje), limit, offset.
 */
export const getUnifiedAudit = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;
  const sourcesParam = (req.query.source as string | undefined)?.split(',') || [
    'clients',
    'alerts',
    'access',
  ];
  const sources = sourcesParam.filter((s): s is AuditSource =>
    ['clients', 'alerts', 'access'].includes(s),
  );

  const filters: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (req.query.from) {
    filters.push(`__created_at__ >= $${i++}`);
    values.push(req.query.from);
  }
  if (req.query.to) {
    filters.push(`__created_at__ <= $${i++}`);
    values.push(req.query.to);
  }
  if (req.query.user_id) {
    filters.push(`__user_id__ = $${i++}`);
    values.push(req.query.user_id);
  }
  if (req.query.action_type) {
    filters.push(`__action_type__ = $${i++}`);
    values.push(req.query.action_type);
  }

  // Construimos cada SELECT con columnas normalizadas:
  // source, action_type, user_id, user_name, subject_id, subject_label,
  // field_name, old_value, new_value, ip_address, created_at
  const parts: string[] = [];

  if (sources.includes('clients')) {
    parts.push(`
      SELECT
        'clients'::text         AS source,
        cal.action_type         AS action_type,
        cal.user_id             AS user_id,
        cal.user_name           AS user_name,
        cal.client_id           AS subject_id,
        c.defendant_name        AS subject_label,
        cal.field_name          AS field_name,
        cal.old_value           AS old_value,
        cal.new_value           AS new_value,
        cal.ip_address          AS ip_address,
        cal.created_at          AS created_at
      FROM CLIENT_AUDIT_LOG cal
      LEFT JOIN CLIENTS c ON c.client_id = cal.client_id
    `);
  }
  if (sources.includes('alerts')) {
    parts.push(`
      SELECT
        'alerts'::text          AS source,
        al.action_type          AS action_type,
        al.user_id              AS user_id,
        al.user_name            AS user_name,
        al.alert_id             AS subject_id,
        a.alert_type            AS subject_label,
        al.field_name           AS field_name,
        al.old_value            AS old_value,
        al.new_value            AS new_value,
        al.ip_address           AS ip_address,
        al.created_at           AS created_at
      FROM ALERT_AUDIT_LOG al
      LEFT JOIN ALERTS a ON a.alert_id = al.alert_id
    `);
  }
  if (sources.includes('access')) {
    parts.push(`
      SELECT
        'access'::text          AS source,
        aa.outcome              AS action_type,
        aa.user_id              AS user_id,
        u.name                  AS user_name,
        aa.attempt_id           AS subject_id,
        aa.email                AS subject_label,
        aa.method               AS field_name,
        NULL::text              AS old_value,
        aa.failure_reason       AS new_value,
        aa.ip_address           AS ip_address,
        aa.attempted_at         AS created_at
      FROM ACCESS_ATTEMPTS aa
      LEFT JOIN USERS u ON u.user_id = aa.user_id
    `);
  }

  if (parts.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'source inválido. Valores permitidos: clients, alerts, access.',
    });
  }

  // Aplicamos los filtros sobre la unión, usando aliases internos
  const inner = parts.join('\nUNION ALL\n');
  const wherePlaceholders = filters
    .join(' AND ')
    .replace(/__created_at__/g, 'created_at')
    .replace(/__user_id__/g, 'user_id')
    .replace(/__action_type__/g, 'action_type');
  const where = wherePlaceholders ? `WHERE ${wherePlaceholders}` : '';

  const totalRes = await pool.query<{ total: string }>({
    text: `SELECT COUNT(*)::text AS total FROM (${inner}) x ${where}`,
    values,
  });
  const rowsRes = await pool.query({
    text: `SELECT * FROM (${inner}) x ${where}
           ORDER BY created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
    values: [...values, limit, offset],
  });

  return res.status(200).json({
    success: true,
    data: rowsRes.rows,
    total: parseInt(totalRes.rows[0].total, 10),
    limit,
    offset,
    sources,
  });
});

/**
 * GET /audit/summary
 * Métricas agregadas para el dashboard de auditoría.
 */
export const getAuditSummary = asyncHandler(async (req: Request, res: Response) => {
  const from = (req.query.from as string | undefined) || null;
  const to = (req.query.to as string | undefined) || null;

  const dateClause = (col: string) => {
    const c: string[] = [];
    const v: any[] = [];
    let j = 1;
    if (from) {
      c.push(`${col} >= $${j++}`);
      v.push(from);
    }
    if (to) {
      c.push(`${col} <= $${j++}`);
      v.push(to);
    }
    return { where: c.length ? `WHERE ${c.join(' AND ')}` : '', values: v };
  };

  const cal = dateClause('created_at');
  const aal = dateClause('created_at');
  const access = dateClause('attempted_at');

  const [
    clientsCount,
    alertsCount,
    accessCount,
    accessDenied,
    alertsReported,
    topUsers,
    perDay,
  ] = await Promise.all([
    pool.query<{ total: string }>({
      text: `SELECT COUNT(*)::text AS total FROM CLIENT_AUDIT_LOG ${cal.where}`,
      values: cal.values,
    }),
    pool.query<{ total: string }>({
      text: `SELECT COUNT(*)::text AS total FROM ALERT_AUDIT_LOG ${aal.where}`,
      values: aal.values,
    }),
    pool.query<{ total: string }>({
      text: `SELECT COUNT(*)::text AS total FROM ACCESS_ATTEMPTS ${access.where}`,
      values: access.values,
    }),
    pool.query<{ total: string }>({
      text: `SELECT COUNT(*)::text AS total FROM ACCESS_ATTEMPTS
             ${access.where ? `${access.where} AND ` : 'WHERE '} outcome != 'success'`,
      values: access.values,
    }),
    pool.query<{ total: string }>({
      text: `SELECT COUNT(*)::text AS total FROM ALERT_AUDIT_LOG
             ${aal.where ? `${aal.where} AND ` : 'WHERE '} action_type = 'REPORT'`,
      values: aal.values,
    }),
    (async () => {
      const conds: string[] = [];
      const vals: any[] = [];
      let k = 1;
      if (from) {
        conds.push(`x.created_at >= $${k++}`);
        vals.push(from);
      }
      if (to) {
        conds.push(`x.created_at <= $${k++}`);
        vals.push(to);
      }
      const w = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      return pool.query({
        text: `SELECT u.user_id, u.name, COUNT(*)::text AS events
               FROM (
                 SELECT user_id, created_at FROM CLIENT_AUDIT_LOG
                 UNION ALL
                 SELECT user_id, created_at FROM ALERT_AUDIT_LOG
                 UNION ALL
                 SELECT user_id, attempted_at AS created_at FROM ACCESS_ATTEMPTS
               ) x
               LEFT JOIN USERS u ON u.user_id = x.user_id
               ${w}
               GROUP BY u.user_id, u.name
               ORDER BY COUNT(*) DESC
               LIMIT 5`,
        values: vals,
      });
    })(),
    (async () => {
      const conds: string[] = [];
      const vals: any[] = [];
      let k = 1;
      if (from) {
        conds.push(`x.created_at >= $${k++}`);
        vals.push(from);
      }
      if (to) {
        conds.push(`x.created_at <= $${k++}`);
        vals.push(to);
      }
      const w = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      return pool.query({
        text: `SELECT DATE(x.created_at) AS day, COUNT(*)::text AS events
               FROM (
                 SELECT created_at FROM CLIENT_AUDIT_LOG
                 UNION ALL
                 SELECT created_at FROM ALERT_AUDIT_LOG
                 UNION ALL
                 SELECT attempted_at AS created_at FROM ACCESS_ATTEMPTS
               ) x
               ${w}
               GROUP BY DATE(x.created_at)
               ORDER BY DATE(x.created_at) DESC
               LIMIT 30`,
        values: vals,
      });
    })(),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      totals: {
        clients: parseInt(clientsCount.rows[0].total, 10),
        alerts: parseInt(alertsCount.rows[0].total, 10),
        access: parseInt(accessCount.rows[0].total, 10),
        access_denied: parseInt(accessDenied.rows[0].total, 10),
        alerts_reported: parseInt(alertsReported.rows[0].total, 10),
      },
      top_users: topUsers.rows,
      per_day: perDay.rows,
    },
  });
});
