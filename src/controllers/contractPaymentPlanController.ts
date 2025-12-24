import { Request, Response, NextFunction } from 'express';
import { pool } from '../database/connection';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { logError, logInfo, logSuccess, logWarning } from '../middlewares/loggingMiddleware';

/**
 * Obtener todos los planes de pago de un cliente
 * GET /administration/clients/:clientId/payment-plans
 */
export const getClientPaymentPlans = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.clientId);

  if (isNaN(client_id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    const query = `
      SELECT 
        plan_id as id,
        client_id as "clienteId",
        contract_id as "contractoId",
        contract_type as "tipoContrato",
        renewal_id as "renovacionId",
        contract_start_date as "fechaInicio",
        contract_end_date as "fechaFin",
        contract_amount as "montoContrato",
        payment_frequency as "frecuenciaPago",
        total_scheduled_amount as "totalProgramado",
        total_paid_amount as "totalPagado",
        total_pending_amount as "totalPendiente",
        status as estado,
        created_at as "fechaCreacion",
        updated_at as "fechaActualizacion"
      FROM CONTRACT_PAYMENT_PLANS
      WHERE client_id = $1
      ORDER BY 
        CASE WHEN contract_type = 'original' THEN 0 ELSE 1 END,
        contract_start_date DESC
    `;

    const result = await pool.query(query, [client_id]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      message: 'Planes de pago obtenidos correctamente',
    });
  } catch (error: any) {
    logError(error, 'getClientPaymentPlans');
    next(error);
  }
});

/**
 * Obtener detalles de un plan de pago específico
 * GET /administration/payment-plans/:planId
 */
export const getPaymentPlanDetails = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const plan_id = parseInt(req.params.planId);

  if (isNaN(plan_id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de plan inválido',
    });
  }

  try {
    // Obtener información del plan
    const planQuery = `
      SELECT 
        plan_id as id,
        client_id as "clienteId",
        contract_id as "contractoId",
        contract_type as "tipoContrato",
        renewal_id as "renovacionId",
        contract_start_date as "fechaInicio",
        contract_end_date as "fechaFin",
        contract_amount as "montoContrato",
        payment_frequency as "frecuenciaPago",
        total_scheduled_amount as "totalProgramado",
        total_paid_amount as "totalPagado",
        total_pending_amount as "totalPendiente",
        status as estado,
        created_at as "fechaCreacion",
        updated_at as "fechaActualizacion"
      FROM CONTRACT_PAYMENT_PLANS
      WHERE plan_id = $1
    `;

    const planResult = await pool.query(planQuery, [plan_id]);

    if (!planResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Plan de pago no encontrado',
      });
    }

    const plan = planResult.rows[0];

    // Obtener pagos del plan
    const paymentsQuery = `
      SELECT 
        payment_id as id,
        plan_id as "planId",
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
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE plan_id = $1
      ORDER BY scheduled_date ASC, created_at ASC
    `;

    const paymentsResult = await pool.query(paymentsQuery, [plan_id]);

    return res.status(200).json({
      success: true,
      data: {
        plan,
        pagos: paymentsResult.rows,
        totalPagos: paymentsResult.rowCount,
      },
      message: 'Detalles del plan obtenidos correctamente',
    });
  } catch (error: any) {
    logError(error, 'getPaymentPlanDetails');
    next(error);
  }
});

/**
 * Crear un nuevo plan de pago para un contrato
 * POST /administration/payment-plans
 */
export const createPaymentPlan = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const {
    client_id,
    contract_type, // 'original' or 'renewal'
    renewal_id, // null for original
    contract_start_date,
    contract_end_date,
    contract_amount,
    payment_frequency, // Mensual, Bimestral, Trimestral, Semestral, Contado
  } = req.body;

  try {
    // Validaciones
    if (!client_id || !contract_type || !contract_start_date) {
      return res.status(400).json({
        success: false,
        message: 'Los campos obligatorios son: client_id, contract_type, contract_start_date',
      });
    }

    if (!['original', 'renewal'].includes(contract_type)) {
      return res.status(400).json({
        success: false,
        message: "El tipo de contrato debe ser 'original' o 'renewal'",
      });
    }

    // Verificar que el cliente existe
    const clientCheck = await pool.query('SELECT client_id FROM CLIENTS WHERE client_id = $1', [client_id]);

    if (!clientCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado',
      });
    }

    // Si es renovación, verificar que existe
    if (contract_type === 'renewal' && renewal_id) {
      const renewalCheck = await pool.query('SELECT renewal_id FROM CONTRACT_RENEWALS WHERE renewal_id = $1 AND client_id = $2', [renewal_id, client_id]);

      if (!renewalCheck.rowCount) {
        return res.status(404).json({
          success: false,
          message: 'Renovación no encontrada',
        });
      }
    }

    // Generar contract_id único
    const contract_id = contract_type === 'original' ? `ORIG_${client_id}` : `REN_${renewal_id}_${Date.now()}`;

    // Crear plan de pago
    const insertQuery = `
      INSERT INTO CONTRACT_PAYMENT_PLANS (
        client_id, contract_id, contract_type, renewal_id,
        contract_start_date, contract_end_date, contract_amount,
        payment_frequency,
        total_scheduled_amount, total_paid_amount, total_pending_amount,
        status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, 'Activo', NOW(), NOW())
      RETURNING 
        plan_id as id,
        client_id as "clienteId",
        contract_id as "contractoId",
        contract_type as "tipoContrato",
        renewal_id as "renovacionId",
        contract_start_date as "fechaInicio",
        contract_end_date as "fechaFin",
        contract_amount as "montoContrato",
        payment_frequency as "frecuenciaPago",
        status as estado,
        created_at as "fechaCreacion"
    `;

    const result = await pool.query(insertQuery, [
      client_id,
      contract_id,
      contract_type,
      renewal_id || null,
      contract_start_date,
      contract_end_date || null,
      contract_amount || null,
      payment_frequency || null,
    ]);

    logSuccess('✅ Payment plan created', {
      planId: result.rows[0].id,
      clientId: client_id,
      contractType: contract_type,
    });

    return res.status(201).json({
      success: true,
      message: 'Plan de pago creado correctamente',
      data: result.rows[0],
    });
  } catch (error: any) {
    logError(error, 'createPaymentPlan');
    next(error);
  }
});

/**
 * Agregar pagos a un plan de pago
 * POST /administration/payment-plans/:planId/payments
 */
export const addPaymentToPlan = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const plan_id = parseInt(req.params.planId);
  const payments = Array.isArray(req.body.payments) ? req.body.payments : [req.body];

  try {
    // Verificar que el plan existe
    const planCheck = await pool.query('SELECT plan_id, client_id FROM CONTRACT_PAYMENT_PLANS WHERE plan_id = $1', [plan_id]);

    if (!planCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Plan de pago no encontrado',
      });
    }

    const client_id = planCheck.rows[0].client_id;
    const createdPayments = [];

    for (const payment of payments) {
      const {
        payment_type,
        scheduled_amount,
        scheduled_date,
        paid_amount = 0,
        paid_date = null,
        payment_status = 'Pendiente',
        description = null,
        payment_method = null,
        reference_number = null,
        notes = null,
        travel_expenses = 0,
        travel_expenses_date = null,
        other_expenses = 0,
        other_expenses_date = null,
        other_expenses_description = null,
      } = payment;

      const insertQuery = `
        INSERT INTO CONTRACT_PLAN_PAYMENTS (
          plan_id, client_id, payment_type, scheduled_amount, scheduled_date,
          paid_amount, paid_date, payment_status, description, payment_method,
          reference_number, notes, travel_expenses, travel_expenses_date,
          other_expenses, other_expenses_date, other_expenses_description,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
        RETURNING 
          payment_id as id,
          plan_id as "planId",
          payment_type as tipo,
          scheduled_amount as "importeProgramado",
          scheduled_date as "fechaProgramada",
          paid_amount as "importePagado",
          paid_date as "fechaPagoReal",
          payment_status as estado
      `;

      const result = await pool.query(insertQuery, [
        plan_id,
        client_id,
        payment_type || 'Pago',
        scheduled_amount,
        scheduled_date,
        paid_amount,
        paid_date,
        payment_status,
        description,
        payment_method,
        reference_number,
        notes,
        travel_expenses,
        travel_expenses_date,
        other_expenses,
        other_expenses_date,
        other_expenses_description,
      ]);

      createdPayments.push(result.rows[0]);
    }

    // Actualizar totales del plan
    const updateQuery = `
      UPDATE CONTRACT_PAYMENT_PLANS
      SET 
        total_scheduled_amount = COALESCE((SELECT SUM(scheduled_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        total_paid_amount = COALESCE((SELECT SUM(paid_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        total_pending_amount = COALESCE((SELECT SUM(scheduled_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0) - 
                               COALESCE((SELECT SUM(paid_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        updated_at = NOW()
      WHERE plan_id = $1
    `;

    await pool.query(updateQuery, [plan_id]);

    logSuccess('✅ Payments added to plan', {
      planId: plan_id,
      paymentCount: createdPayments.length,
    });

    return res.status(201).json({
      success: true,
      message: `${createdPayments.length} pago(s) agregado(s) al plan`,
      data: createdPayments,
    });
  } catch (error: any) {
    logError(error, 'addPaymentToPlan');
    next(error);
  }
});

/**
 * Actualizar un pago en un plan
 * PUT /administration/payment-plans/:planId/payments/:paymentId
 */
export const updatePlanPayment = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const plan_id = parseInt(req.params.planId);
  const payment_id = parseInt(req.params.paymentId);

  try {
    // Verificar que el pago existe y pertenece al plan
    const paymentCheck = await pool.query('SELECT payment_id FROM CONTRACT_PLAN_PAYMENTS WHERE payment_id = $1 AND plan_id = $2', [payment_id, plan_id]);

    if (!paymentCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Pago no encontrado en este plan',
      });
    }

    // Construir dinámicamente los campos a actualizar
    const allowedFields = [
      'payment_type',
      'scheduled_amount',
      'scheduled_date',
      'paid_amount',
      'paid_date',
      'payment_status',
      'description',
      'payment_method',
      'reference_number',
      'notes',
      'travel_expenses',
      'travel_expenses_date',
      'other_expenses',
      'other_expenses_date',
      'other_expenses_description',
    ];

    const updates: any = {};
    let paramCount = 1;
    const values: any[] = [];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = true;
        values.push(req.body[field]);
        paramCount++;
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No hay campos para actualizar',
      });
    }

    const setClause = Object.keys(updates)
      .map((field, i) => `${field} = $${i + 1}`)
      .join(', ');

    const updateQuery = `
      UPDATE CONTRACT_PLAN_PAYMENTS
      SET ${setClause}, updated_at = NOW()
      WHERE payment_id = $${values.length + 1}
      RETURNING 
        payment_id as id,
        plan_id as "planId",
        payment_type as tipo,
        scheduled_amount as "importeProgramado",
        paid_amount as "importePagado",
        payment_status as estado
    `;

    values.push(payment_id);
    const result = await pool.query(updateQuery, values);

    // Actualizar totales del plan
    await pool.query(
      `
      UPDATE CONTRACT_PAYMENT_PLANS
      SET 
        total_scheduled_amount = COALESCE((SELECT SUM(scheduled_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        total_paid_amount = COALESCE((SELECT SUM(paid_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        total_pending_amount = COALESCE((SELECT SUM(scheduled_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0) - 
                               COALESCE((SELECT SUM(paid_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        updated_at = NOW()
      WHERE plan_id = $1
    `,
      [plan_id]
    );

    logSuccess('✅ Payment updated', {
      paymentId: payment_id,
      planId: plan_id,
    });

    return res.status(200).json({
      success: true,
      message: 'Pago actualizado correctamente',
      data: result.rows[0],
    });
  } catch (error: any) {
    logError(error, 'updatePlanPayment');
    next(error);
  }
});

/**
 * Eliminar un pago de un plan
 * DELETE /administration/payment-plans/:planId/payments/:paymentId
 */
export const deletePlanPayment = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const plan_id = parseInt(req.params.planId);
  const payment_id = parseInt(req.params.paymentId);

  try {
    // Verificar que el pago existe
    const paymentCheck = await pool.query('SELECT payment_id FROM CONTRACT_PLAN_PAYMENTS WHERE payment_id = $1 AND plan_id = $2', [payment_id, plan_id]);

    if (!paymentCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Pago no encontrado',
      });
    }

    // Eliminar pago
    await pool.query('DELETE FROM CONTRACT_PLAN_PAYMENTS WHERE payment_id = $1', [payment_id]);

    // Actualizar totales del plan
    await pool.query(
      `
      UPDATE CONTRACT_PAYMENT_PLANS
      SET 
        total_scheduled_amount = COALESCE((SELECT SUM(scheduled_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        total_paid_amount = COALESCE((SELECT SUM(paid_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        total_pending_amount = COALESCE((SELECT SUM(scheduled_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0) - 
                               COALESCE((SELECT SUM(paid_amount) FROM CONTRACT_PLAN_PAYMENTS WHERE plan_id = $1), 0),
        updated_at = NOW()
      WHERE plan_id = $1
    `,
      [plan_id]
    );

    logSuccess('✅ Payment deleted', {
      paymentId: payment_id,
      planId: plan_id,
    });

    return res.status(200).json({
      success: true,
      message: 'Pago eliminado correctamente',
    });
  } catch (error: any) {
    logError(error, 'deletePlanPayment');
    next(error);
  }
});

/**
 * Obtener resumen de todos los planes de pago por cliente
 * GET /administration/clients/:clientId/payment-plans-summary
 */
export const getPaymentPlansSummary = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.clientId);

  if (isNaN(client_id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    const query = `
      SELECT 
        contract_type as "tipoContrato",
        COUNT(*) as "totalPlanes",
        SUM(CASE WHEN status = 'Activo' THEN 1 ELSE 0 END) as "planesActivos",
        SUM(CASE WHEN status = 'Completado' THEN 1 ELSE 0 END) as "planesCompletados",
        SUM(total_scheduled_amount) as "totalProgramado",
        SUM(total_paid_amount) as "totalPagado",
        SUM(total_pending_amount) as "totalPendiente"
      FROM CONTRACT_PAYMENT_PLANS
      WHERE client_id = $1
      GROUP BY contract_type
    `;

    const result = await pool.query(query, [client_id]);

    const summary = {
      original: result.rows.find((r) => r.tipoContrato === 'original') || null,
      renewals: result.rows.find((r) => r.tipoContrato === 'renewal') || null,
      total: {
        totalPlanes: result.rows.reduce((sum, r) => sum + parseInt(r.totalPlanes), 0),
        totalProgramado: result.rows.reduce((sum, r) => sum + (parseFloat(r.totalProgramado) || 0), 0),
        totalPagado: result.rows.reduce((sum, r) => sum + (parseFloat(r.totalPagado) || 0), 0),
        totalPendiente: result.rows.reduce((sum, r) => sum + (parseFloat(r.totalPendiente) || 0), 0),
      },
    };

    return res.status(200).json({
      success: true,
      data: summary,
      message: 'Resumen de planes obtenido correctamente',
    });
  } catch (error: any) {
    logError(error, 'getPaymentPlansSummary');
    next(error);
  }
});
