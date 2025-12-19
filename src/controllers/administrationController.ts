import { Request, Response, NextFunction } from "express";
import { pool } from "../database/connection";

/**
 * ENUM client_status valores válidos:
 * - 'Pendiente de colocación'
 * - 'Colocado'
 * - 'Desinstalado'
 * - 'Cancelado'
 */

/**
 * Obtener lista de todos los clientes con información financiera
 */
export const getAllClients = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    // Filtros
    const nombre = req.query.nombre as string;
    const estado = req.query.estado as string;
    const tipoVenta = req.query.tipoVenta as string;

    // Construir query dinámico con filtros
    let whereConditions: string[] = [];
    let queryParams: any[] = [];
    let paramCount = 1;

    if (nombre) {
      whereConditions.push(`c.defendant_name ILIKE $${paramCount}`);
      queryParams.push(`%${nombre}%`);
      paramCount++;
    }

    if (estado) {
      whereConditions.push(`c.status = $${paramCount}`);
      queryParams.push(estado);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    const query = `
      WITH last_renewals AS (
        -- Obtener la última renovación por cliente
        SELECT 
          client_id,
          renewal_date,
          renewal_duration,
          ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY renewal_date DESC) as rn
        FROM CONTRACT_RENEWALS
      ),
      client_financials AS (
        SELECT 
          c.client_id,
          c.contract_number as "numeroContrato",
          c.defendant_name as nombre,
          c.contract_date as "fechaInicio",
          c.placement_date as "fechaColocacion",
          c.contract_duration as "periodoContratacion",
          c.status as estado,
          c.bracelet_type as "tipoBrazalete",
          c.cancellation_reason as "motivoCancelacion",
          c.contract_document as "archivoContrato",
          c.criminal_case as telefono,
          c.payment_frequency as "frecuenciaPago",
          c.payment_day as "diaPago",
          c.registered_at,
          c.contract_total_amount as "montoTotalContrato",
          c.contract_paid_amount as "montoPagado",
          c.contract_pending_amount as "montoPendiente",
          c.contract_original_amount as "montoOriginalContrato",
          -- Calcular tipo de venta basado en frecuencia de pago
          CASE 
            WHEN c.payment_frequency = 'Contado' THEN 'Contado'
            WHEN c.payment_frequency IN ('Semanal', 'Quincenal', 'Mensual') THEN 'Crédito'
            ELSE 'Crédito'
          END as "tipoVenta",
          -- Calcular fecha de vencimiento
          -- Si hay renovación: usar renewal_date + renewal_duration
          -- Si no: usar placement_date o contract_date + contract_duration
          CASE 
            WHEN lr.renewal_date IS NOT NULL THEN
              lr.renewal_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(lr.renewal_duration, '[^0-9]', '', 'g') AS INTEGER)
            WHEN c.placement_date IS NOT NULL THEN
              c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER)
            ELSE
              c.contract_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER)
          END as "fechaVencimiento",
          -- Calcular días restantes
          CASE 
            WHEN lr.renewal_date IS NOT NULL THEN
              CEIL(EXTRACT(EPOCH FROM (lr.renewal_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(lr.renewal_duration, '[^0-9]', '', 'g') AS INTEGER) - CURRENT_DATE)) / 86400)
            WHEN c.placement_date IS NOT NULL THEN
              CEIL(EXTRACT(EPOCH FROM (c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) - CURRENT_DATE)) / 86400)
            ELSE
              CEIL(EXTRACT(EPOCH FROM (c.contract_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) - CURRENT_DATE)) / 86400)
          END as "diasRestantes",
          -- Sumar pagos totales programados
          COALESCE(SUM(p.scheduled_amount), 0) as "ventasTotales",
          -- Sumar abonos realizados
          COALESCE(SUM(p.paid_amount), 0) as "abonos",
          -- Calcular adeudo pendiente
          COALESCE(SUM(p.scheduled_amount), 0) - COALESCE(SUM(p.paid_amount), 0) as "adeudoPendiente",
          -- Contar archivos
          COUNT(DISTINCT f.file_id) as "totalArchivos"
        FROM CLIENTS c
        LEFT JOIN last_renewals lr ON c.client_id = lr.client_id AND lr.rn = 1
        LEFT JOIN CLIENT_PAYMENTS p ON c.client_id = p.client_id
        LEFT JOIN CLIENT_FILES f ON c.client_id = f.client_id
        ${whereClause}
        GROUP BY c.client_id, c.contract_number, c.defendant_name, c.contract_date, 
                 c.placement_date, c.contract_duration, c.status, c.cancellation_reason, c.contract_document, 
                 c.criminal_case, c.payment_frequency, c.payment_day, c.registered_at, c.bracelet_type,
                 c.contract_total_amount, c.contract_paid_amount, c.contract_pending_amount, c.contract_original_amount,
                 lr.renewal_date, lr.renewal_duration
      )
      SELECT * FROM client_financials
      ${tipoVenta ? `WHERE "tipoVenta" = '${tipoVenta}'` : ''}
      ORDER BY registered_at DESC
    `;

    const result = await pool.query(query, queryParams);

    // Para cada cliente, obtener detalle de pagos
    const clientsWithPayments = await Promise.all(
      result.rows.map(async (client) => {
        const paymentsQuery = `
          SELECT 
            payment_id as id,
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
          FROM CLIENT_PAYMENTS
          WHERE client_id = $1
          ORDER BY scheduled_date DESC, created_at DESC
        `;

        const contactsQuery = `
          SELECT 
            contact_name as nombre,
            phone_number as telefono,
            relationship as relacion
          FROM CLIENT_CONTACTS
          WHERE client_id = $1
          ORDER BY contact_name ASC
        `;
        
        const [paymentsResult, contactsResult] = await Promise.all([
          pool.query(paymentsQuery, [client.client_id]),
          pool.query(contactsQuery, [client.client_id])
        ]);

        // Obtener TODAS las renovaciones del cliente
        const renewalsQuery = `
          SELECT 
            renewal_id as id,
            renewal_date as "fechaRenovacion",
            renewal_duration as "duracionRenovacion",
            renewal_amount as "montoRenovacion",
            created_at as "fechaCreacion",
            updated_at as "fechaActualizacion"
          FROM CONTRACT_RENEWALS
          WHERE client_id = $1
          ORDER BY renewal_date DESC
        `;
        const renewalsResult = await pool.query(renewalsQuery, [client.client_id]);

        return {
          ...client,
          pagos: paymentsResult.rows,
          totalPagos: paymentsResult.rowCount || 0,
          contactos: contactsResult.rows,
          totalContactos: contactsResult.rowCount || 0,
          renovaciones: renewalsResult.rows,
          totalRenovaciones: renewalsResult.rowCount || 0
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: clientsWithPayments,
      total: clientsWithPayments.length,
      message: "Clientes obtenidos correctamente",
    });
  } catch (error: any) {
    console.error("Error al obtener clientes:", error);
    next(error);
  }
};

/**
 * Obtener detalle completo de un cliente
 */
export const getClientById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);

  try {
    // Obtener información básica del cliente
    const clientQuery = `
      SELECT 
        c.client_id as id,
        c.contract_number as "numeroContrato",
        c.defendant_name as nombre,
        c.contract_date as "fechaInicio",
        c.placement_date as "fechaColocacion",
        c.contract_duration as "periodoContratacion",
        c.status as estado,
        c.cancellation_reason as "motivoCancelacion",
        c.contract_document as "archivoContrato",
        c.criminal_case as telefono,
        c.payment_frequency as "frecuenciaPago",
        c.payment_day as "diaPago",
        c.contract_total_amount as "montoTotalContrato",
        c.contract_paid_amount as "montoPagado",
        c.contract_pending_amount as "montoPendiente",
        c.contract_original_amount as "montoOriginalContrato",
        -- Calcular tipo de venta basado en frecuencia de pago
        CASE 
          WHEN c.payment_frequency = 'Contado' THEN 'Contado'
          WHEN c.payment_frequency IN ('Semanal', 'Quincenal', 'Mensual') THEN 'Crédito'
          ELSE 'Crédito'
        END as "tipoVenta",
        -- Calcular fecha de vencimiento
        c.contract_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) as "fechaVencimiento"
      FROM CLIENTS c
      WHERE c.client_id = $1
    `;

    const clientResult = await pool.query(clientQuery, [client_id]);

    if (!clientResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
      });
    }

    const client = clientResult.rows[0];

    // Obtener pagos del cliente
    const paymentsQuery = `
      SELECT 
        payment_id as id,
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
        other_expenses_description as "descripcionOtrosGastos"
      FROM CLIENT_PAYMENTS
      WHERE client_id = $1
      ORDER BY scheduled_date DESC
    `;
    const paymentsResult = await pool.query(paymentsQuery, [client_id]);
    client.pagos = paymentsResult.rows;

    // Obtener contactos del cliente
    const contactsQuery = `
      SELECT 
        contact_name as nombre,
        phone_number as telefono,
        relationship as relacion
      FROM CLIENT_CONTACTS
      WHERE client_id = $1
      ORDER BY contact_name ASC
    `;
    const contactsResult = await pool.query(contactsQuery, [client_id]);
    client.contactos = contactsResult.rows;

    // Obtener archivos del cliente
    const filesQuery = `
      SELECT 
        file_id as id,
        file_type as tipo,
        file_name as nombre,
        file_path as ruta,
        file_size as tamanio,
        uploaded_at as "fechaSubida",
        description as descripcion
      FROM CLIENT_FILES
      WHERE client_id = $1
      ORDER BY uploaded_at DESC
    `;
    const filesResult = await pool.query(filesQuery, [client_id]);
    client.archivos = filesResult.rows;

    // Obtener TODAS las renovaciones del cliente
    const renewalsQuery = `
      SELECT 
        renewal_id as id,
        renewal_date as "fechaRenovacion",
        renewal_duration as "duracionRenovacion",
        renewal_amount as "montoRenovacion",
        created_at as "fechaCreacion",
        updated_at as "fechaActualizacion"
      FROM CONTRACT_RENEWALS
      WHERE client_id = $1
      ORDER BY renewal_date DESC
    `;
    const renewalsResult = await pool.query(renewalsQuery, [client_id]);
    client.renovaciones = renewalsResult.rows;

    // Calcular totales
    const totalesQuery = `
      SELECT 
        COALESCE(SUM(scheduled_amount), 0) as "ventasTotales",
        COALESCE(SUM(paid_amount), 0) as abonos,
        COALESCE(SUM(scheduled_amount), 0) - COALESCE(SUM(paid_amount), 0) as "adeudoPendiente"
      FROM CLIENT_PAYMENTS
      WHERE client_id = $1
    `;
    const totalesResult = await pool.query(totalesQuery, [client_id]);
    Object.assign(client, totalesResult.rows[0]);

    return res.status(200).json({
      success: true,
      data: client,
      message: "Cliente obtenido correctamente",
    });
  } catch (error: any) {
    console.error("Error al obtener cliente:", error);
    next(error);
  }
};

/**
 * Crear un nuevo cliente con configuración inicial
 */
export const createClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const {
    numeroContrato,
    nombre,
    fechaInicio,
    fechaColocacion,
    periodoContratacion,
    telefono,
    // Otros campos necesarios de CLIENTS
    criminalCase,
    courtName,
    judgeName,
    lawyerName,
    signerName,
    paymentFrequency,
    paymentDay,
  } = req.body;

  try {
    // Calcular tipo de venta basado en frecuencia de pago
    let tipoVenta = 'Crédito';
    if (paymentFrequency === 'Contado') {
      tipoVenta = 'Contado';
    }

    // Insertar cliente
    const query = `
      INSERT INTO CLIENTS (
        contract_number, defendant_name, contract_date, placement_date, 
        contract_duration, criminal_case, court_name, judge_name, 
        lawyer_name, signer_name, payment_frequency, payment_day, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Pendiente de colocación')
      RETURNING client_id as id, contract_number as "numeroContrato", 
                defendant_name as nombre, status as estado
    `;

    const values = [
      numeroContrato,
      nombre,
      fechaInicio,
      fechaColocacion,
      `${periodoContratacion} meses`,
      criminalCase || telefono,
      courtName,
      judgeName,
      lawyerName,
      signerName,
      paymentFrequency,
      paymentDay,
    ];

    const result = await pool.query(query, values);
    const newClient = result.rows[0];
    newClient.tipoVenta = tipoVenta;
    newClient.frecuenciaPago = paymentFrequency;
    newClient.diaPago = paymentDay;

    return res.status(201).json({
      success: true,
      data: newClient,
      message: "Cliente creado correctamente",
    });
  } catch (error: any) {
    console.error("Error al crear cliente:", error);
    next(error);
  }
};

/**
 * Actualizar un cliente existente
 */
export const updateClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const updates = req.body;

  try {
    // Verificar que el cliente existe
    const checkQuery = "SELECT client_id FROM CLIENTS WHERE client_id = $1";
    const checkResult = await pool.query(checkQuery, [client_id]);

    if (!checkResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
      });
    }

    // Construir query dinámico
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Mapeo de campos del frontend al backend
    const fieldMapping: any = {
      numeroContrato: 'contract_number',
      contract_number: 'contract_number',
      nombre: 'defendant_name',
      defendant_name: 'defendant_name',
      fechaInicio: 'contract_date',
      contract_date: 'contract_date',
      fechaColocacion: 'placement_date',
      placement_date: 'placement_date',
      periodoContratacion: 'contract_duration',
      contract_duration: 'contract_duration',
      telefono: 'criminal_case',
      criminal_case: 'criminal_case',
      estado: 'status',
      status: 'status',
      frecuenciaPago: 'payment_frequency',
      payment_frequency: 'payment_frequency',
      diaPago: 'payment_day',
      payment_day: 'payment_day',
      bracelet_type: 'bracelet_type',
      tipoBrazalete: 'bracelet_type',
      cancellation_reason: 'cancellation_reason',
      motivoCancelacion: 'cancellation_reason',
      contract_document: 'contract_document',
      archivoContrato: 'contract_document',
      contract_total_amount: 'contract_total_amount',
      montoTotalContrato: 'contract_total_amount',
      contract_paid_amount: 'contract_paid_amount',
      montoPagado: 'contract_paid_amount',
      contract_pending_amount: 'contract_pending_amount',
      montoPendiente: 'contract_pending_amount',
      contract_original_amount: 'contract_original_amount',
      montoOriginalContrato: 'contract_original_amount',
    };

    // Columnas válidas en la tabla CLIENTS
    const validColumns = new Set([
      'contract_number',
      'defendant_name',
      'contract_date',
      'placement_date',
      'contract_duration',
      'criminal_case',
      'status',
      'payment_frequency',
      'payment_day',
      'bracelet_type',
      'cancellation_reason',
      'contract_document',
      'contract_total_amount',
      'contract_paid_amount',
      'contract_pending_amount',
      'contract_original_amount',
    ]);

    Object.keys(updates).forEach((key) => {
      let dbField = fieldMapping[key];
      
      // Si no está en el mapeo, usar el campo tal cual (en minúsculas)
      if (!dbField) {
        dbField = key.toLowerCase();
      }

      // Validar que el campo existe en la tabla
      if (!validColumns.has(dbField)) {
        console.warn(`Campo no válido ignorado: ${key} (${dbField})`);
        return; // Ignorar campos que no existen
      }

      if (updates[key] !== undefined && updates[key] !== null && updates[key] !== '') {
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

    values.push(client_id);

    const updateQuery = `
      UPDATE CLIENTS
      SET ${updateFields.join(", ")}
      WHERE client_id = $${paramCount}
      RETURNING client_id as id, contract_number as "numeroContrato", 
                defendant_name as nombre, status as estado
    `;

    const result = await pool.query(updateQuery, values);

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Cliente actualizado correctamente",
    });
  } catch (error: any) {
    console.error("Error al actualizar cliente:", error);
    next(error);
  }
};

/**
 * Eliminar o desactivar un cliente
 */
export const deleteClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { soft = true } = req.query; // soft delete por defecto

  try {
    if (soft === 'true' || soft === true) {
      // Soft delete: cambiar estado a "Cancelado"
      const query = `
        UPDATE CLIENTS
        SET status = 'Cancelado'
        WHERE client_id = $1
        RETURNING client_id
      `;
      const result = await pool.query(query, [client_id]);

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Cliente no encontrado",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Cliente desactivado correctamente",
      });
    } else {
      // Hard delete: eliminar físicamente
      const query = "DELETE FROM CLIENTS WHERE client_id = $1 RETURNING client_id";
      const result = await pool.query(query, [client_id]);

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Cliente no encontrado",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Cliente eliminado correctamente",
      });
    }
  } catch (error: any) {
    console.error("Error al eliminar cliente:", error);
    next(error);
  }
};

/**
 * Actualizar el valor original del contrato
 * PUT /administration/clients/:id/original-amount
 */
export const updateOriginalContractAmount = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { contract_original_amount } = req.body;

  try {
    if (isNaN(client_id)) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
      });
    }

    if (contract_original_amount === undefined || contract_original_amount === null) {
      return res.status(400).json({
        success: false,
        message: "El valor del contrato original es requerido",
      });
    }

    const amount = parseFloat(contract_original_amount);
    if (isNaN(amount)) {
      return res.status(400).json({
        success: false,
        message: "El valor del contrato debe ser un número válido",
      });
    }

    // Verificar que el cliente existe
    const clientCheck = await pool.query(
      "SELECT client_id, contract_original_amount FROM CLIENTS WHERE client_id = $1",
      [client_id]
    );

    if (!clientCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
      });
    }

    const previousAmount = clientCheck.rows[0].contract_original_amount;

    // Actualizar el valor original del contrato
    const updateQuery = `
      UPDATE CLIENTS 
      SET contract_original_amount = $1
      WHERE client_id = $2
      RETURNING client_id, contract_original_amount
    `;

    const result = await pool.query(updateQuery, [amount, client_id]);

    return res.status(200).json({
      success: true,
      message: "Valor original del contrato actualizado correctamente",
      data: {
        client_id: result.rows[0].client_id,
        contract_original_amount: result.rows[0].contract_original_amount,
        previousAmount: previousAmount,
      },
    });
  } catch (error: any) {
    console.error("Error al actualizar valor original del contrato:", error);
    next(error);
  }
};

/**
 * Actualizar el monto de la renovación
 * PUT /administration/renewals/:renewalId/amount
 */
export const updateRenewalAmount = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const renewal_id = parseInt(req.params.id);
  const { renewal_amount } = req.body;

  try {
    if (isNaN(renewal_id)) {
      return res.status(400).json({
        success: false,
        message: "ID de renovación inválido",
      });
    }

    if (renewal_amount === undefined || renewal_amount === null) {
      return res.status(400).json({
        success: false,
        message: "El monto de la renovación es requerido",
      });
    }

    const amount = parseFloat(renewal_amount);
    if (isNaN(amount)) {
      return res.status(400).json({
        success: false,
        message: "El monto de la renovación debe ser un número válido",
      });
    }

    // Verificar que la renovación existe
    const renewalCheck = await pool.query(
      "SELECT renewal_id, client_id, renewal_amount FROM CONTRACT_RENEWALS WHERE renewal_id = $1",
      [renewal_id]
    );

    if (!renewalCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Renovación no encontrada",
      });
    }

    const previousAmount = renewalCheck.rows[0].renewal_amount;
    const client_id = renewalCheck.rows[0].client_id;

    // Actualizar el monto de la renovación
    const updateQuery = `
      UPDATE CONTRACT_RENEWALS 
      SET renewal_amount = $1
      WHERE renewal_id = $2
      RETURNING renewal_id, client_id, renewal_amount, renewal_date
    `;

    const result = await pool.query(updateQuery, [amount, renewal_id]);

    return res.status(200).json({
      success: true,
      message: "Monto de la renovación actualizado correctamente",
      data: {
        renewal_id: result.rows[0].renewal_id,
        client_id: result.rows[0].client_id,
        renewal_amount: result.rows[0].renewal_amount,
        renewal_date: result.rows[0].renewal_date,
        previousAmount: previousAmount,
      },
    });
  } catch (error: any) {
    console.error("Error al actualizar monto de la renovación:", error);
    next(error);
  }
};
