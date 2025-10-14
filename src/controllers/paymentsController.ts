import { Request, Response, NextFunction } from "express";
import { pool } from "../database/connection";

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
export const createPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
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
  } = req.body;

  try {
    // Verificar que el cliente existe
    const clientCheck = await pool.query(
      "SELECT client_id FROM CLIENTS WHERE client_id = $1",
      [client_id]
    );

    if (!clientCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
      });
    }

    const query = `
      INSERT INTO CLIENT_PAYMENTS (
        client_id, payment_type, scheduled_amount, scheduled_date,
        paid_amount, paid_date, description, payment_method,
        reference_number, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        notes as notas
    `;

    const values = [
      client_id,
      tipo || 'Pago',
      importeProgramado,
      fechaProgramada,
      importePagado || 0,
      fechaPagoReal || null,
      descripcion || null,
      metodoPago || null,
      numeroReferencia || null,
      notas || null,
    ];

    const result = await pool.query(query, values);

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: "Pago registrado correctamente",
    });
  } catch (error: any) {
    console.error("Error al crear pago:", error);
    next(error);
  }
};

/**
 * Actualizar un pago existente
 */
export const updatePayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const payment_id = parseInt(req.params.pagoId);
  const updates = req.body;

  try {
    // Verificar que el pago existe y pertenece al cliente
    const checkQuery = `
      SELECT payment_id 
      FROM CLIENT_PAYMENTS 
      WHERE payment_id = $1 AND client_id = $2
    `;
    const checkResult = await pool.query(checkQuery, [payment_id, client_id]);

    if (!checkResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Pago no encontrado",
      });
    }

    // Construir query dinámico
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Mapeo de campos
    const fieldMapping: any = {
      tipo: 'payment_type',
      importeProgramado: 'scheduled_amount',
      fechaProgramada: 'scheduled_date',
      importePagado: 'paid_amount',
      fechaPagoReal: 'paid_date',
      descripcion: 'description',
      metodoPago: 'payment_method',
      numeroReferencia: 'reference_number',
      notas: 'notes',
    };

    Object.keys(updates).forEach((key) => {
      const dbField = fieldMapping[key];
      if (dbField && updates[key] !== undefined) {
        updateFields.push(`${dbField} = $${paramCount}`);
        values.push(updates[key]);
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se proporcionaron campos para actualizar",
      });
    }

    values.push(payment_id);

    const updateQuery = `
      UPDATE CLIENT_PAYMENTS
      SET ${updateFields.join(", ")}
      WHERE payment_id = $${paramCount}
      RETURNING 
        payment_id as id,
        payment_type as tipo,
        scheduled_amount as "importeProgramado",
        scheduled_date as "fechaProgramada",
        paid_amount as "importePagado",
        paid_date as "fechaPagoReal",
        payment_status as estado,
        description as descripcion
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
  const client_id = parseInt(req.params.id);
  const payment_id = parseInt(req.params.pagoId);

  try {
    const query = `
      DELETE FROM CLIENT_PAYMENTS 
      WHERE payment_id = $1 AND client_id = $2
      RETURNING payment_id
    `;

    const result = await pool.query(query, [payment_id, client_id]);

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Pago no encontrado",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Pago eliminado correctamente",
    });
  } catch (error: any) {
    console.error("Error al eliminar pago:", error);
    next(error);
  }
};
