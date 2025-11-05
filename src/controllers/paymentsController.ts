import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { pool } from "../database/connection";
import { asyncHandler } from "../middlewares/enhancedMiddlewares";
import { logError, logInfo, logSuccess, logWarning } from "../middlewares/loggingMiddleware";
import {
  createPayment as createPaymentService,
  getPaymentById,
  getPaymentsByClientId,
  updatePayment as updatePaymentService,
  deletePayment as deletePaymentService,
  getPaymentSummary,
  getPaymentsByType,
} from "../services/payment.service";
import { ICreatePaymentRequest, IUpdatePaymentRequest } from "../models/payment.interface";
import {
  createPaymentSchema,
  createPaymentAdminSchema,
  createPaymentAdminBatchSchema,
  createBatchPaymentsSchema,
  updatePaymentSchema,
  paymentParamsSchema,
} from "../models/modelSchemas";

/**
 * Obtener todos los pagos de un cliente
 */
export const getPaymentsByClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);

  try {
    const query = `
      SELECT 
        payment_id as id,
        client_id as "clienteId",
        payment_type as tipo,
        scheduled_amount as "importeProgramado",
        scheduled_date as "fechaProgramada",
        paid_amount as "importePagado",
        paid_date as "fechaPagoReal",
        payment_status as estado,
        description as descripcion,
        payment_method as "metodoPago",
        reference_number as "numeroReferencia",
        notes as notas,
        created_at as "fechaCreacion",
        updated_at as "fechaActualizacion"
      FROM CLIENT_PAYMENTS
      WHERE client_id = $1
      ORDER BY scheduled_date DESC, created_at DESC
    `;

    const result = await pool.query(query, [client_id]);

    // Calcular resumen
    const summary = {
      totalProgramado: 0,
      totalPagado: 0,
      totalPendiente: 0,
      pagosPendientes: 0,
      pagosVencidos: 0,
    };

    result.rows.forEach((payment) => {
      summary.totalProgramado += parseFloat(payment.importeProgramado || 0);
      summary.totalPagado += parseFloat(payment.importePagado || 0);
      
      if (payment.estado === 'Pendiente' || payment.estado === 'Parcial') {
        summary.pagosPendientes++;
        summary.totalPendiente += parseFloat(payment.importeProgramado || 0) - parseFloat(payment.importePagado || 0);
      }
      
      if (payment.estado === 'Vencido') {
        summary.pagosVencidos++;
      }
    });

    return res.status(200).json({
      success: true,
      data: result.rows,
      summary,
      count: result.rowCount,
      message: "Pagos obtenidos correctamente",
    });
  } catch (error: any) {
    console.error("Error al obtener pagos:", error);
    next(error);
  }
};

/**
 * Crear un nuevo pago o abono
 */
/**
 * POST /administration/clients/:id/payments
 * Crear un nuevo pago para un cliente específico
 * Acepta tanto camelCase español como camelCase inglés
 * Los campos NO son obligatorios - permite guardar plan de pagos para ejecutar después
 */
export const createPayment = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);

  logInfo("💰 Creating payment via administration route", {
    clientId: client_id,
    requestedBy: (req as any).user?.email || "Unknown",
  });

  try {
    // Detectar si es batch (array de pagos) o individual
    const isBatch = Array.isArray(req.body.payments);

    let validationError;

    if (isBatch) {
      // Validación batch
      const { error } = createPaymentAdminBatchSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });
      validationError = error;
    } else {
      // Validación individual
      const { error } = createPaymentAdminSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });
      validationError = error;
    }

    if (validationError) {
      logWarning("⚠️ Payment validation failed (admin route)", {
        errors: validationError.details.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });

      return res.status(400).json({
        success: false,
        message: "Datos inválidos en la solicitud",
        errors: validationError.details.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    // Si es batch, procesar array
    if (isBatch) {
      const { payments } = req.body;

      // Verificar que el cliente existe
      const clientCheck = await pool.query(
        "SELECT client_id FROM CLIENTS WHERE client_id = $1",
        [client_id]
      );

      if (!clientCheck.rowCount) {
        logWarning("⚠️ Client not found for batch payment creation", { clientId: client_id });

        return res.status(404).json({
          success: false,
          message: "Cliente no encontrado",
        });
      }

      const createdPayments = [];

      for (const payment of payments) {
        const query = `
          INSERT INTO CLIENT_PAYMENTS (
            client_id, payment_type, scheduled_amount, scheduled_date,
            paid_amount, paid_date, payment_status, description, payment_method,
            reference_number, notes, travel_expenses, travel_expenses_date,
            other_expenses, other_expenses_date, other_expenses_description,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
          RETURNING 
            payment_id as id,
            client_id as "clienteId",
            payment_type as tipo,
            scheduled_amount as "importeProgramado",
            scheduled_date as "fechaProgramada",
            paid_amount as "importePagado",
            paid_date as "fechaPagoReal",
            payment_status as estado,
            description as descripcion,
            payment_method as "metodoPago",
            reference_number as "numeroReferencia",
            notes as notas,
            travel_expenses as "gastosViaje",
            travel_expenses_date as "fechaGastosViaje",
            other_expenses as "otrosGastos",
            other_expenses_date as "fechaOtrosGastos",
            other_expenses_description as "descripcionOtrosGastos",
            created_at as "fechaCreacion",
            updated_at as "fechaActualizacion"
        `;

        const values = [
          client_id,
          payment.payment_type || 'Pago',
          parseFloat(payment.scheduled_amount.toString()),
          payment.scheduled_date,
          payment.paid_amount ? parseFloat(payment.paid_amount.toString()) : 0,
          payment.paid_date || null,
          payment.payment_status || 'Pendiente',
          payment.description || null,
          payment.payment_method || null,
          payment.reference_number || null,
          payment.notes || null,
          payment.travel_expenses ? parseFloat(payment.travel_expenses.toString()) : 0,
          payment.travel_expenses_date || null,
          payment.other_expenses ? parseFloat(payment.other_expenses.toString()) : 0,
          payment.other_expenses_date || null,
          payment.other_expenses_description || null,
        ];

        const result = await pool.query(query, values);
        createdPayments.push(result.rows[0]);
      }

      logSuccess("✅ Batch payments created successfully (admin route)", {
        clientId: client_id,
        paymentCount: createdPayments.length,
      });

      return res.status(201).json({
        success: true,
        data: createdPayments,
        message: `${createdPayments.length} pago(s) registrado(s) correctamente`,
        count: createdPayments.length,
      });
    }
    
    // INDIVIDUAL - continúa con el resto del código...
    else {

    // INDIVIDUAL - continúa con el resto del código...
    
    // Extraer y normalizar valores (aceptar ambas convenciones)
    const {
      tipo,
      importeProgramado,
      fechaProgramada,
      importePagado,
      fechaPagoReal,
      descripcion,
      metodoPago,
      numeroReferencia,
      notas,
      payment_type,
      scheduled_amount,
      scheduled_date,
      paid_amount,
      paid_date,
      description,
      payment_method,
      reference_number,
      notes: notesEn,
      payment_status,
      travel_expenses,
      travel_expenses_date,
      other_expenses,
      other_expenses_date,
      other_expenses_description,
      gastosViaje,
      fechaGastosViaje,
      otrosGastos,
      fechaOtrosGastos,
      descripcionOtrosGastos,
    } = req.body;

    // Normalizar valores usando lógica OR (español || inglés || default)
    const paymentType = tipo || payment_type || "Pago";
    const scheduledAmount = importeProgramado || scheduled_amount;
    const scheduledDate = fechaProgramada || scheduled_date;
    const paidAmountValue = importePagado || paid_amount;
    const paidDateValue = fechaPagoReal || paid_date || null;
    const paymentStatusValue = payment_status || "Pendiente";
    const descriptionValue = descripcion || description || null;
    const paymentMethodValue = metodoPago || payment_method || null;
    const referenceNumberValue = numeroReferencia || reference_number || null;
    const notesValue = notas || notesEn || null;
    const travelExpensesValue = travel_expenses || gastosViaje || 0;
    const travelExpensesDateValue = travel_expenses_date || fechaGastosViaje || null;
    const otherExpensesValue = other_expenses || otrosGastos || 0;
    const otherExpensesDateValue = other_expenses_date || fechaOtrosGastos || null;
    const otherExpensesDescValue = other_expenses_description || descripcionOtrosGastos || null;

    // Verificar que el cliente existe
    const clientCheck = await pool.query(
      "SELECT client_id FROM CLIENTS WHERE client_id = $1",
      [client_id]
    );

    if (!clientCheck.rowCount) {
      logWarning("⚠️ Client not found for payment creation", { clientId: client_id });

      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
      });
    }

    const query = `
      INSERT INTO CLIENT_PAYMENTS (
        client_id, payment_type, scheduled_amount, scheduled_date,
        paid_amount, paid_date, payment_status, description, payment_method,
        reference_number, notes, travel_expenses, travel_expenses_date,
        other_expenses, other_expenses_date, other_expenses_description,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
      RETURNING 
        payment_id as id,
        client_id as "clienteId",
        payment_type as tipo,
        scheduled_amount as "importeProgramado",
        scheduled_date as "fechaProgramada",
        paid_amount as "importePagado",
        paid_date as "fechaPagoReal",
        payment_status as estado,
        description as descripcion,
        payment_method as "metodoPago",
        reference_number as "numeroReferencia",
        notes as notas,
        travel_expenses as "gastosViaje",
        travel_expenses_date as "fechaGastosViaje",
        other_expenses as "otrosGastos",
        other_expenses_date as "fechaOtrosGastos",
        other_expenses_description as "descripcionOtrosGastos",
        created_at as "fechaCreacion",
        updated_at as "fechaActualizacion"
    `;

    // IMPORTANTE: El orden DEBE coincidir con INSERT
    // $1: client_id, $2: payment_type, $3: scheduled_amount, $4: scheduled_date,
    // $5: paid_amount, $6: paid_date, $7: payment_status, $8: description,
    // $9: payment_method, $10: reference_number, $11: notes, $12: travel_expenses,
    // $13: travel_expenses_date, $14: other_expenses, $15: other_expenses_date, $16: other_expenses_description
    const values = [
      client_id,                                           // $1: client_id
      paymentType,                                         // $2: payment_type
      scheduledAmount ? parseFloat(scheduledAmount.toString()) : null, // $3: scheduled_amount
      scheduledDate || null,                               // $4: scheduled_date
      paidAmountValue ? parseFloat(paidAmountValue.toString()) : 0,    // $5: paid_amount
      paidDateValue,                                       // $6: paid_date
      paymentStatusValue,                                  // $7: payment_status
      descriptionValue,                                    // $8: description
      paymentMethodValue,                                  // $9: payment_method
      referenceNumberValue,                                // $10: reference_number
      notesValue,                                          // $11: notes
      travelExpensesValue ? parseFloat(travelExpensesValue.toString()) : 0,  // $12: travel_expenses
      travelExpensesDateValue,                             // $13: travel_expenses_date
      otherExpensesValue ? parseFloat(otherExpensesValue.toString()) : 0,    // $14: other_expenses
      otherExpensesDateValue,                              // $15: other_expenses_date
      otherExpensesDescValue,                              // $16: other_expenses_description
    ];

    const result = await pool.query(query, values);

    logSuccess("✅ Payment created successfully (admin route)", {
      paymentId: result.rows[0].id,
      clientId: client_id,
      amount: scheduledAmount,
    });

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: "Pago registrado correctamente",
    });
    } // Cierre del else
  } catch (error: any) {
    logError(error, "createPayment (admin route)");
    next(error);
  }
});

/**
 * Actualizar un pago existente
 */
export const updatePayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const payment_id = parseInt(req.params.paymentId);

  try {
    // Validar que payment_id es válido
    if (isNaN(payment_id)) {
      return res.status(400).json({
        success: false,
        message: "ID de pago inválido",
      });
    }

    // Verificar que el pago existe
    const checkQuery = `
      SELECT payment_id, client_id
      FROM CLIENT_PAYMENTS 
      WHERE payment_id = $1
    `;
    const checkResult = await pool.query(checkQuery, [payment_id]);

    if (!checkResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Pago no encontrado",
      });
    }

    const updates = req.body;

    // Mapeo de campos: español || inglés || alias -> DB
    const fieldMapping: any = {
      // Español
      tipo: 'payment_type',
      importeProgramado: 'scheduled_amount',
      fechaProgramada: 'scheduled_date',
      importePagado: 'paid_amount',
      fechaPagoReal: 'paid_date',
      descripcion: 'description',
      metodoPago: 'payment_method',
      numeroReferencia: 'reference_number',
      notas: 'notes',
      // Inglés
      payment_type: 'payment_type',
      scheduled_amount: 'scheduled_amount',
      scheduled_date: 'scheduled_date',
      paid_amount: 'paid_amount',
      paid_date: 'paid_date',
      description: 'description',
      payment_method: 'payment_method',
      reference_number: 'reference_number',
      notes: 'notes',
      payment_status: 'payment_status',
      // Gastos
      travel_expenses: 'travel_expenses',
      travel_expenses_date: 'travel_expenses_date',
      other_expenses: 'other_expenses',
      other_expenses_date: 'other_expenses_date',
      other_expenses_description: 'other_expenses_description',
      // Alias / Alternativas
      actual_payment_date: 'paid_date',
    };

    // Construir SET clause dinámicamente con deduplicación
    const processedFields: { [key: string]: { value: any; order: number } } = {};
    let fieldOrder = 0;

    Object.keys(updates).forEach((key) => {
      let dbField = fieldMapping[key];
      
      // Saltar campos que no están en el mapping
      if (!dbField) {
        return;
      }

      // Saltar valores que vienen vacíos o sin cambios
      let value = updates[key];
      if (value === undefined || value === null || value === '') {
        return;
      }

      // Saltar campos de lectura
      if (['payment_id', 'client_id', 'created_at', 'updated_at', 'payment_number'].includes(key)) {
        return;
      }

      // Conversión de tipos según el campo
      if (['scheduled_amount', 'paid_amount', 'travel_expenses', 'other_expenses'].includes(dbField)) {
        // Campos numéricos
        value = parseFloat(value.toString());
        if (isNaN(value)) {
          return; // Skip si conversión falla
        }
      } else if (['scheduled_date', 'paid_date', 'travel_expenses_date', 'other_expenses_date'].includes(dbField) || 
                 key === 'actual_payment_date') {
        // Campos fecha - convertir a formato DATE (YYYY-MM-DD)
        if (typeof value === 'string') {
          // Si es string, asegurar formato YYYY-MM-DD
          const dateObj = new Date(value);
          if (isNaN(dateObj.getTime())) {
            return; // Skip si fecha inválida
          }
          // Convertir a YYYY-MM-DD local
          value = dateObj.toISOString().split('T')[0];
        }
      }

      // Guardar en mapa con deduplicación - usa el primer valor si hay conflictos
      if (!processedFields[dbField]) {
        processedFields[dbField] = { value, order: fieldOrder++ };
      }
    });

    // Construir updateFields array desde el mapa de campos procesados
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    Object.keys(processedFields).forEach((dbField) => {
      const { value } = processedFields[dbField];
      updateFields.push(`${dbField} = $${paramCount}`);
      values.push(value);
      paramCount++;
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se proporcionaron campos válidos para actualizar",
      });
    }

    // Agregar payment_id y updated_at
    updateFields.push(`updated_at = NOW()`);
    values.push(payment_id);

    const updateQuery = `
      UPDATE CLIENT_PAYMENTS
      SET ${updateFields.join(", ")}
      WHERE payment_id = $${paramCount}
      RETURNING 
        payment_id as id,
        client_id as "clienteId",
        payment_type as tipo,
        scheduled_amount as "importeProgramado",
        scheduled_date as "fechaProgramada",
        paid_amount as "importePagado",
        paid_date as "fechaPagoReal",
        payment_status as estado,
        description as descripcion,
        payment_method as "metodoPago",
        reference_number as "numeroReferencia",
        notes as notas,
        created_at as "fechaCreacion",
        updated_at as "fechaActualizacion"
    `;

    const result = await pool.query(updateQuery, values);

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Pago actualizado correctamente",
    });
  } catch (error: any) {
    console.error("Error al actualizar pago:", error);
    next(error);
  }
};

/**
 * Eliminar un pago
 */
export const deletePayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const payment_id = parseInt(req.params.paymentId);

  try {
    // Validar que payment_id es válido
    if (isNaN(payment_id)) {
      return res.status(400).json({
        success: false,
        message: "ID de pago inválido",
      });
    }

    const query = `
      DELETE FROM CLIENT_PAYMENTS 
      WHERE payment_id = $1
      RETURNING payment_id, client_id
    `;

    const result = await pool.query(query, [payment_id]);

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Pago no encontrado",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        payment_id: result.rows[0].payment_id,
        client_id: result.rows[0].client_id
      },
      message: "Pago eliminado correctamente",
    });
  } catch (error: any) {
    console.error("Error al eliminar pago:", error);
    next(error);
  }
};

/**
 * ============================================================================
 * NUEVOS ENDPOINTS - MODERNOS Y DOCUMENTADOS
 * ============================================================================
 */

/**
 * POST /pagos
 * Crea un nuevo pago para un cliente
 * 
 * Payload esperado:
 * {
 *   "client_id": 123,
 *   "payment_date": "2025-10-28",
 *   "amount": 5000,
 *   "payment_type": "contado",
 *   "observations": "Pago inicial del mes"
 * }
 */
export const createNewPayment = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  logInfo("💰 Creating new payment(s)", {
    requestedBy: (req as any).user?.email || "Unknown",
    payloadKeys: Object.keys(req.body),
  });

  try {
    // Detectar si es un envío batch (con array de pagos) o individual
    const isBatchPayment = Array.isArray(req.body.payments) && req.body.client_id;
    
    if (isBatchPayment) {
      // ===== VALIDACIÓN BATCH =====
      const { error, value } = createBatchPaymentsSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        logWarning("⚠️ Batch payment validation failed", {
          errors: error.details.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });

        return res.status(400).json({
          success: false,
          message: "Campo requerido faltante en la petición",
          errors: error.details.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      const { client_id, payments } = value;

      // Verificar que el cliente existe
      const clientCheck = await pool.query(
        "SELECT client_id FROM CLIENTS WHERE client_id = $1",
        [client_id]
      );

      if (!clientCheck.rowCount) {
        logWarning("⚠️ Client not found for batch payment creation", {
          clientId: client_id,
        });

        return res.status(404).json({
          success: false,
          message: `Cliente con ID ${client_id} no encontrado`,
        });
      }

      // Insertar múltiples pagos
      const createdPayments = [];
      
      for (const payment of payments) {
        // Construir query dinámicamente - si payment_number existe en la tabla, incluirlo
        const query = `
          INSERT INTO CLIENT_PAYMENTS (
            client_id, payment_type, scheduled_amount, scheduled_date,
            paid_amount, paid_date, payment_status, description, payment_method,
            reference_number, notes, travel_expenses, travel_expenses_date,
            other_expenses, other_expenses_date, other_expenses_description,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
          RETURNING 
            payment_id as id,
            client_id as "clienteId",
            payment_type as tipo,
            scheduled_amount as "importeProgramado",
            scheduled_date as "fechaProgramada",
            paid_amount as "importePagado",
            paid_date as "fechaPagoReal",
            payment_status as estado,
            description as descripcion,
            payment_method as "metodoPago",
            reference_number as "numeroReferencia",
            notes as notas,
            travel_expenses as "gastosViaje",
            travel_expenses_date as "fechaGastosViaje",
            other_expenses as "otrosGastos",
            other_expenses_date as "fechaOtrosGastos",
            other_expenses_description as "descripcionOtrosGastos",
            created_at as "fechaCreacion",
            updated_at as "fechaActualizacion"
        `;

        // IMPORTANTE: El orden de valores DEBE coincidir con el orden en INSERT
        const values = [
          client_id,                                        // $1: client_id
          payment.payment_type || "Pago",                   // $2: payment_type (use Pago, not Programado)
          parseFloat(payment.scheduled_amount.toString()), // $3: scheduled_amount
          payment.scheduled_date,                           // $4: scheduled_date
          payment.paid_amount ? parseFloat(payment.paid_amount.toString()) : 0, // $5: paid_amount
          payment.paid_date || null,                        // $6: paid_date
          payment.payment_status || 'Pendiente',           // $7: payment_status
          payment.description || null,                      // $8: description
          payment.payment_method || null,                   // $9: payment_method
          payment.reference_number || null,                 // $10: reference_number
          payment.notes || null,                            // $11: notes
          payment.travel_expenses ? parseFloat(payment.travel_expenses.toString()) : 0,  // $12: travel_expenses
          payment.travel_expenses_date || null,             // $13: travel_expenses_date
          payment.other_expenses ? parseFloat(payment.other_expenses.toString()) : 0,    // $14: other_expenses
          payment.other_expenses_date || null,              // $15: other_expenses_date
          payment.other_expenses_description || null,       // $16: other_expenses_description
        ];

        const result = await pool.query(query, values);
        createdPayments.push(result.rows[0]);
      }

      logSuccess("✅ Batch payments created successfully", {
        clientId: client_id,
        paymentCount: createdPayments.length,
      });

      return res.status(201).json({
        success: true,
        message: `${createdPayments.length} pago(s) registrado(s) exitosamente`,
        data: createdPayments,
        count: createdPayments.length,
      });
    } else {
      // ===== VALIDACIÓN INDIVIDUAL =====
      const { error, value } = createPaymentSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        logWarning("⚠️ Payment validation failed", {
          errors: error.details.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });

        return res.status(400).json({
          success: false,
          message: "Campo requerido faltante en la petición",
          errors: error.details.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      const request: ICreatePaymentRequest = value;

      const payment = await createPaymentService(request);

      logSuccess("✅ Payment created successfully", {
        paymentId: payment.payment_id,
        clientId: request.client_id,
        amount: request.amount,
      });

      return res.status(201).json({
        success: true,
        message: "Pago registrado exitosamente",
        data: payment,
      });
    }
  } catch (error) {
    logError(error, "createNewPayment");
    next(error);
  }
});

/**
 * GET /pagos/:clientId
 * Obtiene historial de pagos de un cliente
 * 
 * Query params:
 * - limit: número máximo de pagos (default: 100)
 * - offset: desplazamiento para paginación (default: 0)
 */
export const getPaymentHistory = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  logInfo("📜 Fetching payment history", {
    clientId: req.params.clientId,
  });

  try {
    const clientId = parseInt(req.params.clientId);
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    if (isNaN(clientId)) {
      logWarning("⚠️ Invalid client ID format", { clientId: req.params.clientId });
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
      });
    }

    const payments = await getPaymentsByClientId(clientId, limit, offset);

    logSuccess("✅ Payment history retrieved", {
      clientId,
      count: payments.length,
    });

    return res.status(200).json({
      success: true,
      message: "Historial de pagos",
      data: payments,
      metadata: {
        total_count: payments.length,
        limit,
        offset,
      },
    });
  } catch (error) {
    logError(error, "getPaymentHistory");
    next(error);
  }
});

/**
 * GET /pagos/:clientId/resumen
 * Obtiene resumen financiero de un cliente
 * 
 * Query params:
 * - contractValue: valor total del contrato (opcional, para calcular deuda)
 */
export const getFinancialSummary = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  logInfo("📊 Fetching financial summary", {
    clientId: req.params.clientId,
  });

  try {
    const clientId = parseInt(req.params.clientId);
    const totalContractValue = req.query.contractValue
      ? parseFloat(req.query.contractValue as string)
      : undefined;

    if (isNaN(clientId)) {
      logWarning("⚠️ Invalid client ID format", { clientId: req.params.clientId });
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
      });
    }

    const summary = await getPaymentSummary(clientId, totalContractValue);

    logSuccess("✅ Financial summary retrieved", {
      clientId,
      totalPaid: summary.total_paid,
      totalOwed: summary.total_owed,
      paymentCount: summary.payment_count,
    });

    return res.status(200).json({
      success: true,
      message: "Resumen financiero del cliente",
      data: summary,
    });
  } catch (error) {
    logError(error, "getFinancialSummary");
    next(error);
  }
});

/**
 * PUT /pagos/:id
 * Actualiza un pago existente
 * 
 * Payload esperado (todos los campos son opcionales):
 * {
 *   "payment_date": "2025-10-29",
 *   "amount": 5500,
 *   "payment_type": "credito",
 *   "observations": "Pago ajustado"
 * }
 */
export const updateExistingPayment = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  logInfo("✏️ Updating payment", {
    paymentId: req.params.id,
  });

  try {
    const paymentId = parseInt(req.params.id);

    if (isNaN(paymentId)) {
      logWarning("⚠️ Invalid payment ID format", { paymentId: req.params.id });
      return res.status(400).json({
        success: false,
        message: "ID de pago inválido",
      });
    }

    const request: IUpdatePaymentRequest = {
      payment_id: paymentId,
      payment_date: req.body.payment_date,
      amount: req.body.amount,
      payment_type: req.body.payment_type,
      observations: req.body.observations,
    };

    const payment = await updatePaymentService(request);

    logSuccess("✅ Payment updated successfully", {
      paymentId,
    });

    return res.status(200).json({
      success: true,
      message: "Pago actualizado correctamente",
      data: payment,
    });
  } catch (error) {
    logError(error, "updateExistingPayment");
    next(error);
  }
});

/**
 * DELETE /pagos/:id
 * Elimina un pago
 */
export const removePayment = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  logInfo("🗑️ Deleting payment", {
    paymentId: req.params.id,
  });

  try {
    const paymentId = parseInt(req.params.id);

    if (isNaN(paymentId)) {
      logWarning("⚠️ Invalid payment ID format", { paymentId: req.params.id });
      return res.status(400).json({
        success: false,
        message: "ID de pago inválido",
      });
    }

    const deleted = await deletePaymentService(paymentId);

    if (deleted) {
      logSuccess("✅ Payment deleted successfully", { paymentId });
      return res.status(200).json({
        success: true,
        message: "Pago eliminado correctamente",
      });
    }
  } catch (error) {
    logError(error, "removePayment");
    next(error);
  }
});

/**
 * GET /pagos/:clientId/por-tipo
 * Obtiene estadísticas de pagos agrupados por tipo
 */
export const getPaymentStatsByType = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  logInfo("📈 Fetching payment statistics by type", {
    clientId: req.params.clientId,
  });

  try {
    const clientId = parseInt(req.params.clientId);

    if (isNaN(clientId)) {
      logWarning("⚠️ Invalid client ID format", { clientId: req.params.clientId });
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
      });
    }

    const stats = await getPaymentsByType(clientId);

    logSuccess("✅ Payment statistics retrieved", {
      clientId,
      types: Object.keys(stats),
    });

    return res.status(200).json({
      success: true,
      message: "Pagos agrupados por tipo",
      data: stats,
    });
  } catch (error) {
    logError(error, "getPaymentStatsByType");
    next(error);
  }
});
