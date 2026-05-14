import { NextFunction, Request, Response } from 'express';
import { pool } from '../database/connection';
import { logAuthEvent } from '../services/audit.service';
import { logWarning } from './loggingMiddleware';
import { ROLE_IDS } from './roleMiddleware';

/**
 * Roles sujetos a restricción de ubicación.
 * Por ahora solo Monitorista; ajustar aquí si se requiere extender a otros roles.
 */
const RESTRICTED_ROLES: number[] = [ROLE_IDS.MONITORISTA];

interface PreAuthUser {
  user_id: number;
  email: string;
  role_id: number;
}

/**
 * Extrae la IP real del cliente respetando los encabezados de proxy.
 */
export const extractClientIp = (req: Request): string | null => {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.length > 0) {
    return xRealIp;
  }
  return req.socket.remoteAddress || req.connection.remoteAddress || null;
};

/**
 * Verifica si una IP pertenece a algún CIDR activo de la lista blanca.
 * Se delega al motor de PostgreSQL (operador `<<=` de tipo CIDR).
 */
export const isIpAllowed = async (ip: string): Promise<boolean> => {
  const query = {
    text: `SELECT 1 FROM IP_WHITELIST
           WHERE is_active = TRUE AND $1::INET <<= cidr
           LIMIT 1`,
    values: [ip],
  };
  try {
    const result = await pool.query(query);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    // Si la IP no es válida, PG arrojará y consideramos denegada.
    logWarning('isIpAllowed: error evaluando CIDR', { ip, error: (error as Error).message });
    return false;
  }
};

/**
 * Verifica si un device_token está autorizado, opcionalmente atado a un user_id.
 */
export const isDeviceAllowed = async (
  device_token: string,
  user_id?: number,
): Promise<boolean> => {
  const query = {
    text: `SELECT 1 FROM AUTHORIZED_DEVICES
           WHERE device_token = $1
             AND is_active = TRUE
             AND (user_id IS NULL OR user_id = $2)
           LIMIT 1`,
    values: [device_token, user_id ?? null],
  };
  const result = await pool.query(query);
  return (result.rowCount ?? 0) > 0;
};

/**
 * Evalúa si un usuario puede iniciar sesión desde la ubicación actual.
 * Registra el resultado en ACCESS_ATTEMPTS y devuelve el outcome.
 *
 * Modelo OR (Mayo 2026):
 * - Si el rol NO está restringido → siempre permitido.
 * - Si el rol está restringido → permitido si CUALQUIERA de:
 *     a) la IP está en la whitelist activa, O
 *     b) el header X-Device-Id corresponde a un dispositivo autorizado.
 *   Solo si ambos fallan se deniega.
 *
 * El outcome registrado refleja qué falló:
 * - 'denied_ip' si no envió device y la IP no calza.
 * - 'denied_device' si envió device y este no es válido, sin importar la IP.
 *   (Se reporta el más específico de los dos para ayudar a depurar.)
 */
export const evaluateLocationRestriction = async (
  req: Request,
  user: PreAuthUser,
  method: 'password' | 'pin' | 'webauthn',
): Promise<{ allowed: true } | { allowed: false; reason: 'denied_ip' | 'denied_device'; message: string }> => {
  if (!RESTRICTED_ROLES.includes(user.role_id)) {
    return { allowed: true };
  }

  const ip = extractClientIp(req);
  const device_token =
    typeof req.headers['x-device-id'] === 'string' && req.headers['x-device-id'].length > 0
      ? (req.headers['x-device-id'] as string)
      : null;

  const ipOk = !!ip && (await isIpAllowed(ip));
  const deviceOk = !!device_token && (await isDeviceAllowed(device_token, user.user_id));

  if (ipOk || deviceOk) {
    return { allowed: true };
  }

  // Ambas fallaron. Reporta el resultado más informativo:
  if (device_token) {
    await logAuthEvent(req as any, {
      user_id: user.user_id,
      email: user.email,
      method,
      outcome: 'denied_device',
      failure_reason: `IP ${ip ?? 'desconocida'} no autorizada y dispositivo ${device_token} no registrado`,
      device_token,
    });
    return {
      allowed: false,
      reason: 'denied_device',
      message:
        'Ni la IP ni el dispositivo están autorizados. Contacte al administrador.',
    };
  }

  await logAuthEvent(req as any, {
    user_id: user.user_id,
    email: user.email,
    method,
    outcome: 'denied_ip',
    failure_reason: `IP ${ip ?? 'desconocida'} no autorizada (sin device_token enviado)`,
    device_token,
  });
  return {
    allowed: false,
    reason: 'denied_ip',
    message:
      'Acceso desde ubicación no autorizada. Si tu equipo está provisionado, ' +
      'verifica que esté enviando el identificador de dispositivo.',
  };
};

/**
 * Middleware Express que aplica la restricción a un usuario ya autenticado
 * (post-JWT). Útil para proteger rutas sensibles, no solo el login.
 */
export const enforceLocationRestriction = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }
  if (!RESTRICTED_ROLES.includes(user.role)) {
    return next();
  }
  const result = await evaluateLocationRestriction(
    req,
    { user_id: user.id, email: user.email, role_id: user.role },
    'password',
  );
  if (!result.allowed) {
    return res.status(403).json({ success: false, message: result.message });
  }
  return next();
};
