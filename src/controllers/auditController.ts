import { NextFunction, Request, Response } from "express";
import { getClientAuditLog, getAllClientAuditLogs } from "../services/audit.service";

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
