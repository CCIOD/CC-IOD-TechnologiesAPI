import Handlebars from 'handlebars';
import { pool } from '../database/connection';

/**
 * Variables disponibles en las plantillas Handlebars de ALERT_PROTOCOLS.
 * Se documenta aquí en un solo lugar para que el frontend pueda mostrar la lista.
 */
export const ALERT_TEMPLATE_VARIABLES = [
  'portador',
  'cliente',
  'tipo',
  'protocolo',
  'zona',
  'zona_inclusion',
  'zona_exclusion',
  'house_arrest',
  'correa',
  'hora',
  'fecha',
  'info',
] as const;

export interface AlertTemplateContext {
  portador?: string;
  cliente?: string;
  tipo: string;
  protocolo: string;
  zona?: string;
  zona_inclusion?: string;
  zona_exclusion?: string;
  house_arrest?: string;
  correa?: string;
  hora: string;
  fecha: string;
  info?: string;
}

/**
 * Renderiza una plantilla Handlebars sin opciones inseguras.
 * Handlebars escapa HTML por defecto: ideal para nuestro caso.
 */
export const renderProtocolMessage = (
  template: string,
  context: AlertTemplateContext,
): string => {
  const compiled = Handlebars.compile(template, { noEscape: false });
  return compiled(context);
};

export interface ActiveProtocol {
  protocol_id: number;
  alert_type: string;
  label: string;
  message_template: string;
}

/**
 * Busca el protocolo activo para un tipo de alerta dado.
 */
export const getActiveProtocolByType = async (
  alert_type: string,
): Promise<ActiveProtocol | null> => {
  const result = await pool.query<ActiveProtocol>({
    text: `SELECT protocol_id, alert_type, label, message_template
           FROM ALERT_PROTOCOLS
           WHERE alert_type = $1 AND is_active = TRUE
           LIMIT 1`,
    values: [alert_type],
  });
  return result.rows[0] ?? null;
};

export interface CarrierContext {
  carrier_id: number;
  carrier_name?: string;
  client_id?: number;
  client_name?: string;
}

/**
 * Resuelve el nombre del portador y cliente asociado. Devuelve null si no existe.
 * Se usa para llenar las variables {{portador}} y {{cliente}} de la plantilla.
 */
export const getCarrierContext = async (
  carrier_id?: number | null,
): Promise<CarrierContext | null> => {
  if (!carrier_id) return null;
  const result = await pool.query({
    text: `SELECT ca.carrier_id,
                  c.client_id,
                  c.defendant_name AS client_name
           FROM CARRIERS ca
           LEFT JOIN CLIENTS c ON c.client_id = ca.client_id
           WHERE ca.carrier_id = $1`,
    values: [carrier_id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    carrier_id: row.carrier_id,
    client_id: row.client_id ?? undefined,
    client_name: row.client_name ?? undefined,
    carrier_name: row.client_name ?? undefined, // Por ahora el "portador" se identifica por el cliente asociado
  };
};

/**
 * Resuelve un cliente por id (cuando la alerta no viene atada a portador).
 */
export const getClientName = async (
  client_id?: number | null,
): Promise<string | null> => {
  if (!client_id) return null;
  const result = await pool.query<{ defendant_name: string }>({
    text: 'SELECT defendant_name FROM CLIENTS WHERE client_id = $1',
    values: [client_id],
  });
  return result.rows[0]?.defendant_name ?? null;
};

/**
 * Helper para formatear el timestamp en zona horaria de México (es-MX).
 */
export const formatNow = (): { hora: string; fecha: string } => {
  const now = new Date();
  const hora = now.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Mexico_City',
  });
  const fecha = now.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Mexico_City',
  });
  return { hora, fecha };
};
