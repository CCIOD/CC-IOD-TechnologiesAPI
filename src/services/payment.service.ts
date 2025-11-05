/**
 * Servicio de Pagos
 * 
 * Responsabilidades:
 * - CRUD completo de pagos (crear, leer, actualizar, eliminar)
 * - Cálculos de sumatorias (pagado, adeudado)
 * - Resumen financiero por cliente
 * - Validaciones de integridad de datos
 */

import { pool } from "../database/connection";
import { logError, logInfo, logWarning } from "../middlewares/loggingMiddleware";
import {
  IPayment,
  IPaymentSummary,
  ICreatePaymentRequest,
  IUpdatePaymentRequest,
} from "../models/payment.interface";

/**
 * Crea un nuevo pago para un cliente
 * 
 * @param request - Datos del pago (client_id, payment_date, amount, payment_type, observations)
 * @returns Pago creado con su ID
 * @throws Error si el cliente no existe
 */
export const createPayment = async (request: ICreatePaymentRequest): Promise<IPayment> => {
  logInfo("💰 Creating new payment", {
    clientId: request.client_id,
    amount: request.amount,
    paymentType: request.payment_type,
  });

  try {
    // Validar que el cliente existe
    const clientCheck = await pool.query(
      "SELECT client_id FROM CLIENTS WHERE client_id = $1",
      [request.client_id]
    );

    if (clientCheck.rowCount === 0) {
      logWarning("⚠️ Client not found for payment creation", {
        clientId: request.client_id,
      });
      throw new Error(`Cliente con ID ${request.client_id} no encontrado`);
    }

    // Validar monto
    if (request.amount <= 0) {
      throw new Error("El importe debe ser mayor a 0");
    }

    // Insertar pago
    const result = await pool.query(
      `INSERT INTO PAYMENTS 
       (client_id, payment_date, amount, payment_type, observations, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING payment_id, client_id, payment_date, amount, payment_type, observations, created_at, updated_at`,
      [
        request.client_id,
        request.payment_date,
        request.amount,
        request.payment_type,
        request.observations || null,
      ]
    );

    const payment = result.rows[0];

    logInfo("✅ Payment created successfully", {
      paymentId: payment.payment_id,
      clientId: request.client_id,
      amount: request.amount,
    });

    return payment;
  } catch (error) {
    logError(error, "createPayment");
    throw error;
  }
};

/**
 * Obtiene un pago específico por su ID
 * 
 * @param paymentId - ID del pago
 * @returns Objeto de pago o null si no existe
 */
export const getPaymentById = async (paymentId: number): Promise<IPayment | null> => {
  logInfo("🔍 Fetching payment by ID", { paymentId });

  try {
    const result = await pool.query(
      `SELECT payment_id, client_id, payment_date, amount, payment_type, observations, created_at, updated_at
       FROM PAYMENTS
       WHERE payment_id = $1`,
      [paymentId]
    );

    if (result.rowCount === 0) {
      logWarning("⚠️ Payment not found", { paymentId });
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logError(error, "getPaymentById");
    throw error;
  }
};

/**
 * Obtiene todos los pagos de un cliente
 * 
 * @param clientId - ID del cliente
 * @param limit - Límite de registros (default: 100)
 * @param offset - Desplazamiento (default: 0)
 * @returns Array de pagos ordenados por fecha descendente
 */
export const getPaymentsByClientId = async (
  clientId: number,
  limit: number = 100,
  offset: number = 0
): Promise<IPayment[]> => {
  logInfo("📜 Fetching payments by client", {
    clientId,
    limit,
    offset,
  });

  try {
    const result = await pool.query(
      `SELECT payment_id, client_id, payment_date, amount, payment_type, observations, created_at, updated_at
       FROM PAYMENTS
       WHERE client_id = $1
       ORDER BY payment_date DESC
       LIMIT $2 OFFSET $3`,
      [clientId, limit, offset]
    );

    logInfo("✅ Payments retrieved", {
      clientId,
      count: result.rowCount,
    });

    return result.rows;
  } catch (error) {
    logError(error, "getPaymentsByClientId");
    throw error;
  }
};

/**
 * Actualiza un pago existente
 * 
 * @param request - Datos a actualizar (payment_id + campos opcionales)
 * @returns Pago actualizado
 * @throws Error si el pago no existe
 */
export const updatePayment = async (request: IUpdatePaymentRequest): Promise<IPayment> => {
  logInfo("✏️ Updating payment", { paymentId: request.payment_id });

  try {
    // Verificar que el pago existe
    const existingPayment = await getPaymentById(request.payment_id);
    if (!existingPayment) {
      throw new Error(`Pago con ID ${request.payment_id} no encontrado`);
    }

    // Validar monto si se proporciona
    if (request.amount !== undefined && request.amount <= 0) {
      throw new Error("El importe debe ser mayor a 0");
    }

    // Construir query dinámica para actualizar solo campos proporcionados
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (request.payment_date !== undefined) {
      updateFields.push(`payment_date = $${paramCount++}`);
      values.push(request.payment_date);
    }

    if (request.amount !== undefined) {
      updateFields.push(`amount = $${paramCount++}`);
      values.push(request.amount);
    }

    if (request.payment_type !== undefined) {
      updateFields.push(`payment_type = $${paramCount++}`);
      values.push(request.payment_type);
    }

    if (request.observations !== undefined) {
      updateFields.push(`observations = $${paramCount++}`);
      values.push(request.observations || null);
    }

    updateFields.push(`updated_at = NOW()`);

    // Si no hay campos a actualizar, retornar el registro existente
    if (updateFields.length === 1) {
      return existingPayment;
    }

    values.push(request.payment_id);

    const query = `UPDATE PAYMENTS
                   SET ${updateFields.join(", ")}
                   WHERE payment_id = $${paramCount}
                   RETURNING payment_id, client_id, payment_date, amount, payment_type, observations, created_at, updated_at`;

    const result = await pool.query(query, values);

    logInfo("✅ Payment updated successfully", {
      paymentId: request.payment_id,
    });

    return result.rows[0];
  } catch (error) {
    logError(error, "updatePayment");
    throw error;
  }
};

/**
 * Elimina un pago
 * 
 * @param paymentId - ID del pago a eliminar
 * @returns true si se eliminó exitosamente
 * @throws Error si el pago no existe
 */
export const deletePayment = async (paymentId: number): Promise<boolean> => {
  logInfo("🗑️ Deleting payment", { paymentId });

  try {
    const existingPayment = await getPaymentById(paymentId);
    if (!existingPayment) {
      throw new Error(`Pago con ID ${paymentId} no encontrado`);
    }

    await pool.query("DELETE FROM PAYMENTS WHERE payment_id = $1", [paymentId]);

    logInfo("✅ Payment deleted successfully", { paymentId });

    return true;
  } catch (error) {
    logError(error, "deletePayment");
    throw error;
  }
};

/**
 * Obtiene resumen financiero de un cliente
 * 
 * Calcula:
 * - Total pagado (suma de todos los pagos)
 * - Total adeudado (calculado si se proporciona valor del contrato)
 * - Información general de pagos
 * 
 * @param clientId - ID del cliente
 * @param totalContractValue - Valor total del contrato (opcional, para calcular deuda)
 * @returns Resumen financiero del cliente
 */
export const getPaymentSummary = async (
  clientId: number,
  totalContractValue?: number
): Promise<IPaymentSummary> => {
  logInfo("📊 Calculating payment summary", {
    clientId,
    totalContractValue,
  });

  try {
    // Validar que cliente existe
    const clientCheck = await pool.query(
      "SELECT client_id FROM CLIENTS WHERE client_id = $1",
      [clientId]
    );

    if (clientCheck.rowCount === 0) {
      logWarning("⚠️ Client not found for summary", { clientId });
      throw new Error(`Cliente con ID ${clientId} no encontrado`);
    }

    // Obtener todos los pagos y calcular sumatoria
    const result = await pool.query(
      `SELECT 
        payment_id,
        client_id,
        payment_date,
        amount,
        payment_type,
        observations,
        created_at,
        updated_at,
        SUM(amount) OVER () as total_paid,
        COUNT(*) OVER () as payment_count,
        MAX(payment_date) OVER () as last_payment_date
       FROM PAYMENTS
       WHERE client_id = $1
       ORDER BY payment_date DESC`,
      [clientId]
    );

    const payments: IPayment[] = [];
    let totalPaid = 0;
    let paymentCount = 0;
    let lastPaymentDate: Date | undefined;

    if ((result.rowCount ?? 0) > 0) {
      result.rows.forEach((row) => {
        payments.push({
          payment_id: row.payment_id,
          client_id: row.client_id,
          payment_date: row.payment_date,
          amount: row.amount,
          payment_type: row.payment_type,
          observations: row.observations,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      });

      totalPaid = parseFloat(result.rows[0].total_paid) || 0;
      paymentCount = parseInt(result.rows[0].payment_count) || 0;
      lastPaymentDate = result.rows[0].last_payment_date;
    }

    // Calcular adeudo
    const totalOwed = totalContractValue ? Math.max(0, totalContractValue - totalPaid) : 0;

    const summary: IPaymentSummary = {
      client_id: clientId,
      total_paid: totalPaid,
      total_owed: totalOwed,
      total_contract_value: totalContractValue,
      payment_count: paymentCount,
      last_payment_date: lastPaymentDate,
      payments,
    };

    logInfo("✅ Payment summary calculated", {
      clientId,
      totalPaid,
      totalOwed,
      paymentCount,
    });

    return summary;
  } catch (error) {
    logError(error, "getPaymentSummary");
    throw error;
  }
};

/**
 * Obtiene estadísticas de pagos por tipo
 * Útil para reportes y análisis
 * 
 * @param clientId - ID del cliente
 * @returns Objeto con totales por tipo de pago
 */
export const getPaymentsByType = async (
  clientId: number
): Promise<Record<string, number>> => {
  logInfo("📈 Calculating payments by type", { clientId });

  try {
    const result = await pool.query(
      `SELECT 
        payment_type,
        SUM(amount) as total
       FROM PAYMENTS
       WHERE client_id = $1
       GROUP BY payment_type
       ORDER BY total DESC`,
      [clientId]
    );

    const summary: Record<string, number> = {};

    result.rows.forEach((row) => {
      summary[row.payment_type] = parseFloat(row.total) || 0;
    });

    logInfo("✅ Payment type statistics calculated", {
      clientId,
      types: Object.keys(summary),
    });

    return summary;
  } catch (error) {
    logError(error, "getPaymentsByType");
    throw error;
  }
};
