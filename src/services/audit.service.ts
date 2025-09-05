import { pool } from "../database/connection";

export interface AuditLogEntry {
  client_id: number;
  user_id: number;
  user_name: string;
  action_type: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  ip_address?: string;
  user_agent?: string;
}

export interface AuditLogResponse {
  audit_id: number;
  client_id: number;
  user_id: number;
  user_name: string;
  action_type: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

/**
 * Registra una entrada en la bitácora de cambios de clientes
 */
export const logClientChange = async (entry: AuditLogEntry): Promise<void> => {
  try {
    const query = {
      text: `INSERT INTO CLIENT_AUDIT_LOG 
             (client_id, user_id, user_name, action_type, field_name, old_value, new_value, ip_address, user_agent) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      values: [
        entry.client_id,
        entry.user_id,
        entry.user_name,
        entry.action_type,
        entry.field_name || null,
        entry.old_value || null,
        entry.new_value || null,
        entry.ip_address || null,
        entry.user_agent || null,
      ],
    };
    
    await pool.query(query);
  } catch (error) {
    console.error('Error logging client change:', error);
    // No lanzamos el error para no interrumpir la operación principal
  }
};

/**
 * Obtiene el historial de cambios para un cliente específico
 */
export const getClientAuditLog = async (client_id: number): Promise<AuditLogResponse[]> => {
  try {
    const query = {
      text: `SELECT audit_id, client_id, user_id, user_name, action_type, 
                    field_name, old_value, new_value, ip_address, user_agent, created_at
             FROM CLIENT_AUDIT_LOG 
             WHERE client_id = $1 
             ORDER BY created_at DESC`,
      values: [client_id],
    };
    
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('Error fetching client audit log:', error);
    throw error;
  }
};

/**
 * Obtiene el historial de cambios de todos los clientes (con paginación)
 */
export const getAllClientAuditLogs = async (
  limit: number = 50, 
  offset: number = 0,
  user_id?: number,
  action_type?: string,
  start_date?: string,
  end_date?: string
): Promise<{logs: AuditLogResponse[], total: number}> => {
  try {
    let whereConditions = [];
    let queryParams: any[] = [];
    let paramCounter = 1;

    if (user_id) {
      whereConditions.push(`user_id = $${paramCounter}`);
      queryParams.push(user_id);
      paramCounter++;
    }

    if (action_type) {
      whereConditions.push(`action_type = $${paramCounter}`);
      queryParams.push(action_type);
      paramCounter++;
    }

    if (start_date) {
      whereConditions.push(`created_at >= $${paramCounter}`);
      queryParams.push(start_date);
      paramCounter++;
    }

    if (end_date) {
      whereConditions.push(`created_at <= $${paramCounter}`);
      queryParams.push(end_date);
      paramCounter++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Consulta para obtener el total de registros
    const countQuery = {
      text: `SELECT COUNT(*) as total FROM CLIENT_AUDIT_LOG ${whereClause}`,
      values: queryParams,
    };
    
    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0].total);

    // Consulta principal con paginación
    const query = {
      text: `SELECT cal.audit_id, cal.client_id, cal.user_id, cal.user_name, cal.action_type, 
                    cal.field_name, cal.old_value, cal.new_value, cal.ip_address, cal.user_agent, cal.created_at,
                    c.defendant_name as client_name
             FROM CLIENT_AUDIT_LOG cal
             LEFT JOIN CLIENTS c ON cal.client_id = c.client_id
             ${whereClause}
             ORDER BY cal.created_at DESC 
             LIMIT $${paramCounter} OFFSET $${paramCounter + 1}`,
      values: [...queryParams, limit, offset],
    };
    
    const result = await pool.query(query);
    return { logs: result.rows, total };
  } catch (error) {
    console.error('Error fetching all client audit logs:', error);
    throw error;
  }
};

/**
 * Registra múltiples cambios de campos en una sola operación
 */
export const logMultipleFieldChanges = async (
  client_id: number,
  user_id: number,
  user_name: string,
  changes: { field_name: string; old_value: string; new_value: string }[],
  ip_address?: string,
  user_agent?: string
): Promise<void> => {
  try {
    const promises = changes.map(change => 
      logClientChange({
        client_id,
        user_id,
        user_name,
        action_type: 'UPDATE',
        field_name: change.field_name,
        old_value: change.old_value,
        new_value: change.new_value,
        ip_address,
        user_agent,
      })
    );
    
    await Promise.all(promises);
  } catch (error) {
    console.error('Error logging multiple field changes:', error);
  }
};
