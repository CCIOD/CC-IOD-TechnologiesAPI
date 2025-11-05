/**
 * Interfaces para el control de vigencia de contrato y renovaciones
 * 
 * Esta entidad gestiona:
 * - Fechas de inicio, vencimiento y duración de contratos
 * - Registro de renovaciones con documentación
 * - Cálculos de tiempo restante antes del vencimiento
 */

/**
 * Información de renovación de contrato
 * Registra cada extensión del contrato con su documentación
 */
export interface IContractRenewal {
  renewal_id?: number;
  client_id: number;
  renewal_date: Date | string;
  months_added: number;
  renewal_document_url?: string;
  previous_expiration_date: Date | string;
  new_expiration_date: Date | string;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Estado de vigencia del contrato
 * Información consolidada sobre la validez del contrato
 */
export interface IContractValidity {
  client_id: number;
  placement_date: Date | string;
  contract_date: Date | string;
  contract_duration: number | string; // meses iniciales del contrato, "N/A" si inválido
  expiration_date: Date | string; // Puede ser "N/A" si no se puede calcular
  months_contracted: number | string; // Puede ser "N/A" si no se puede calcular
  days_remaining: number | string; // Puede ser "N/A" si no se puede calcular
  is_active: boolean;
  last_renewal?: {
    renewal_date: Date;
    months_added: number;
  };
}

/**
 * DTO para solicitar renovación de contrato
 * Payload del endpoint PUT /clientes/:id/renovar-contrato
 */
export interface IRenewalContractRequest {
  client_id: string; // UUID o ID del cliente
  months_new: number; // Meses adicionales a agregar
  renewal_document_url?: string; // URL del documento de renovación
  renewal_date?: string; // Fecha de renovación (default: today)
}

/**
 * DTO para respuesta de renovación
 * Payload retornado después de renovar un contrato
 */
export interface IRenewalContractResponse {
  success: boolean;
  message: string;
  data: {
    client_id: number;
    new_expiration_date: string;
    days_remaining: number;
    previous_expiration_date: string;
    renewal_date: string;
    months_added: number;
  };
}

/**
 * DTO para obtener vigencia actual
 * Respuesta del endpoint GET /clientes/:id/vigencia
 */
export interface IContractValidityResponse {
  success: boolean;
  message: string;
  data: IContractValidity;
}
