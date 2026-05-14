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

// =============================================================================
// Bitácora de alertas (centro de monitoreo)
// =============================================================================

export type AlertActionType =
  | 'CREATE'
  | 'UPDATE'
  | 'DEACTIVATE'
  | 'REPORT'
  | 'REPORT_UPDATE';

export interface AlertAuditEntry {
  alert_id: number;
  user_id: number;
  user_name?: string;
  action_type: AlertActionType;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  ip_address?: string;
  user_agent?: string;
}

/**
 * Registra una entrada en la bitácora de alertas.
 * No lanza errores: si falla, lo loggea pero no interrumpe la operación principal.
 */
export const logAlertEvent = async (entry: AlertAuditEntry): Promise<void> => {
  try {
    const query = {
      text: `INSERT INTO ALERT_AUDIT_LOG
             (alert_id, user_id, user_name, action_type, field_name, old_value, new_value, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      values: [
        entry.alert_id,
        entry.user_id,
        entry.user_name || null,
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
    console.error('Error logging alert event:', error);
  }
};

/**
 * Registra múltiples cambios de campos de una alerta en una sola operación.
 */
export const logMultipleAlertFieldChanges = async (
  alert_id: number,
  user_id: number,
  user_name: string,
  changes: { field_name: string; old_value: string; new_value: string }[],
  ip_address?: string,
  user_agent?: string
): Promise<void> => {
  try {
    await Promise.all(
      changes.map((change) =>
        logAlertEvent({
          alert_id,
          user_id,
          user_name,
          action_type: 'UPDATE',
          field_name: change.field_name,
          old_value: change.old_value,
          new_value: change.new_value,
          ip_address,
          user_agent,
        }),
      ),
    );
  } catch (error) {
    console.error('Error logging multiple alert field changes:', error);
  }
};

// =============================================================================
// Bitácora de accesos al sistema
// =============================================================================

export type AuthMethod = 'password' | 'pin' | 'webauthn';
export type AccessOutcome =
  | 'success'
  | 'denied_password'
  | 'denied_pin'
  | 'denied_ip'
  | 'denied_device'
  | 'denied_user'
  | 'denied_webauthn';

export interface AccessAttemptEntry {
  user_id?: number | null;
  email?: string | null;
  ip_address?: string | null;
  device_token?: string | null;
  user_agent?: string | null;
  method: AuthMethod;
  outcome: AccessOutcome;
  failure_reason?: string | null;
}

/**
 * Registra un intento de acceso al sistema (exitoso o denegado).
 * Es append-only y nunca lanza errores.
 */
export const logAccessAttempt = async (
  entry: AccessAttemptEntry,
): Promise<void> => {
  try {
    const query = {
      text: `INSERT INTO ACCESS_ATTEMPTS
             (user_id, email, ip_address, device_token, user_agent, method, outcome, failure_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [
        entry.user_id ?? null,
        entry.email ?? null,
        entry.ip_address ?? null,
        entry.device_token ?? null,
        entry.user_agent ?? null,
        entry.method,
        entry.outcome,
        entry.failure_reason ?? null,
      ],
    };
    await pool.query(query);
  } catch (error) {
    console.error('Error logging access attempt:', error);
  }
};

/**
 * Atajo para registrar un login exitoso o denegado con metadatos del request.
 */
export const logAuthEvent = async (
  req: { headers: Record<string, any>; clientIp?: string },
  data: Omit<AccessAttemptEntry, 'ip_address' | 'user_agent' | 'device_token'> & {
    device_token?: string | null;
  },
): Promise<void> => {
  const ip_address =
    req.clientIp ||
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : null) ||
    (req.headers['x-real-ip'] as string | undefined) ||
    null;
  const user_agent = (req.headers['user-agent'] as string | undefined) || null;
  const device_token =
    data.device_token ?? (req.headers['x-device-id'] as string | undefined) ?? null;
  await logAccessAttempt({ ...data, ip_address, user_agent, device_token });
};
