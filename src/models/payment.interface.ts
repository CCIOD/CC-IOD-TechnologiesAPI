/**
 * Interfaces para el control de pagos de clientes
 * 
 * Esta entidad gestiona:
 * - Registro de pagos individuales
 * - Historial de pagos por cliente
 * - Resumen financiero (pagado, adeudado, totales)
 * - CRUD completo de operaciones de pago
 */

/**
 * Modelo de datos de un pago individual
 * Representa una transacción de pago asociada a un cliente
 */
export interface IPayment {
  payment_id?: number;
  client_id: number;
  payment_date: Date | string;
  amount: number; // importe en unidades monetarias
  payment_type: 'contado' | 'credito' | 'viatico' | 'otro';
  observations?: string;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Resumen financiero de un cliente
 * Consolidado de pagos, adeudos y totales
 */
export interface IPaymentSummary {
  client_id: number;
  total_paid: number; // Total pagado
  total_owed: number; // Total adeudado
  total_contract_value?: number; // Valor total del contrato (referencia)
  payment_count: number; // Cantidad de pagos registrados
  last_payment_date?: Date | string;
  payments: IPayment[];
}

/**
 * DTO para crear un nuevo pago
 * Payload del endpoint POST /pagos
 */
export interface ICreatePaymentRequest {
  client_id: number;
  payment_date: string; // ISO format: YYYY-MM-DD
  amount: number;
  payment_type: 'contado' | 'credito' | 'viatico' | 'otro';
  observations?: string;
}

/**
 * DTO para actualizar un pago existente
 * Payload del endpoint PUT /pagos/:id
 */
export interface IUpdatePaymentRequest extends Partial<Omit<ICreatePaymentRequest, 'client_id'>> {
  payment_id: number;
}

/**
 * DTO para respuesta de operación de pago
 * Payload retornado después de crear/actualizar/eliminar un pago
 */
export interface IPaymentResponse {
  success: boolean;
  message: string;
  data?: IPayment;
}

/**
 * DTO para respuesta de resumen de pagos
 * Payload del endpoint GET /pagos/:clienteId/resumen
 */
export interface IPaymentSummaryResponse {
  success: boolean;
  message: string;
  data: IPaymentSummary;
}

/**
 * DTO para respuesta de listado de pagos
 * Payload del endpoint GET /pagos/:clienteId
 */
export interface IPaymentListResponse {
  success: boolean;
  message: string;
  data: IPayment[];
  metadata?: {
    total_count: number;
    page?: number;
    page_size?: number;
  };
}
