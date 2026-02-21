/**
 * Servicio de Renovaciones de Contrato
 *
 * Responsabilidades:
 * - Calcular vigencia actual del contrato
 * - Registrar renovaciones con validaciones
 * - Recalcular fechas de vencimiento
 * - Evitar renovaciones duplicadas
 */

import { pool } from '../database/connection';
import { logError, logInfo, logWarning } from '../middlewares/loggingMiddleware';
import { IContractRenewal, IContractValidity, IRenewalContractRequest, IRenewalContractResponse } from '../models/renewal.interface';

/**
 * Calcula los días restantes entre hoy y una fecha de vencimiento
 * @param expirationDate - Fecha de vencimiento del contrato
 * @returns Número de días restantes (puede ser negativo si ya expiró)
 */
export const calculateDaysRemaining = (expirationDate: Date | string | any): number => {
  try {
    // Validar que expirationDate sea válido
    if (!expirationDate) {
      return 0;
    }

    // Convertir a Date si es string
    let expDateObj: Date;

    if (typeof expirationDate === 'string') {
      expDateObj = new Date(expirationDate);
    } else if (expirationDate instanceof Date) {
      expDateObj = expirationDate;
    } else {
      return 0;
    }

    // Validar que sea una fecha válida
    if (isNaN(expDateObj.getTime())) {
      logWarning('⚠️ Invalid expiration date', { expirationDate });
      return 0;
    }

    // Validar que la fecha esté en un rango razonable
    const year = expDateObj.getFullYear();
    if (year < 2000 || year > 2099) {
      logWarning('⚠️ Expiration date out of range', { expirationDate, year });
      return 0;
    }

    // Usar solo la parte de fecha (YYYY-MM-DD) en zona local
    // Hacer una copia para no modificar la original
    const expDate = new Date(expDateObj);
    expDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calcular diferencia en milisegundos y convertir a días
    const diffTime = expDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  } catch (error) {
    logError(error, 'calculateDaysRemaining');
    return 0;
  }
};

/**
 * Suma meses a una fecha y retorna la nueva fecha
 * Maneja correctamente los desbordamientos de años
 * @param baseDate - Fecha base
 * @param months - Cantidad de meses a sumar
 * @returns Nueva fecha después de sumar meses
 */
export const addMonthsToDate = (baseDate: Date | string | any, months: number): Date => {
  try {
    // Validar entrada
    if (!baseDate || !months || months <= 0) {
      throw new Error('Invalid baseDate or months');
    }

    const date = new Date(baseDate);

    // Validar que la fecha sea válida
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${baseDate}`);
    }

    // Logging para debuggear
    logInfo('🔢 Adding months to date', {
      baseDate,
      months,
      dateObject: date.toISOString(),
      originalMonth: date.getMonth(),
      originalYear: date.getFullYear(),
    });

    // Calcular nuevo mes y año correctamente
    let newMonth = date.getMonth() + months;
    let newYear = date.getFullYear();

    // Ajustar año y mes si se desborda
    while (newMonth >= 12) {
      newMonth -= 12;
      newYear += 1;
    }

    while (newMonth < 0) {
      newMonth += 12;
      newYear -= 1;
    }

    date.setFullYear(newYear);
    date.setMonth(newMonth);

    logInfo('🔢 Result after adding months', {
      resultDate: date.toISOString(),
      resultMonth: date.getMonth(),
      resultYear: date.getFullYear(),
    });

    return date;
  } catch (error) {
    logError(error, 'addMonthsToDate');
    throw error;
  }
};

/**
 * Extrae la cantidad de meses de un string como "12 meses" o "6 months"
 * @param durationString - String con formato "X meses" o "X months"
 * @returns Número de meses
 */
const extractMonths = (durationString: string): number => {
  const match = durationString?.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Valida si una fecha es válida y no es una fecha por defecto del sistema
 */
const isValidDate = (date: any): boolean => {
  if (!date) return false;

  const d = new Date(date);
  if (isNaN(d.getTime())) return false;

  // Rechazar fechas muy antiguas (antes de 2000) o muy futuras (después de 2099)
  const year = d.getFullYear();
  return year >= 2000 && year <= 2099;
};

/**
 * Obtiene la vigencia actual de un contrato
 * Calcula estado, días restantes y fecha de vencimiento
 * La fecha de vencimiento se obtiene de la última renovación en CONTRACT_RENEWALS
 *
 * @param clientId - ID del cliente
 * @returns Objeto IContractValidity con información de vigencia
 * @throws Error si el cliente no existe
 */
export const getContractValidity = async (clientId: number): Promise<any> => {
  logInfo('📅 Calculating contract validity', { clientId });

  try {
    // Obtener datos del cliente
    const clientResult = await pool.query(
      `SELECT 
        client_id,
        placement_date,
        contract_date,
        contract_duration
       FROM CLIENTS
       WHERE client_id = $1`,
      [clientId],
    );

    if (clientResult.rowCount === 0) {
      logWarning('⚠️ Client not found for validity calculation', { clientId });
      throw new Error(`Cliente con ID ${clientId} no encontrado`);
    }

    const client = clientResult.rows[0];

    // Convertir contract_duration a número (puede venir como string o número del SQL)
    const contractDurationMonths = Number(client.contract_duration);

    // Validar que los datos del cliente sean válidos
    const hasValidPlacementDate = isValidDate(client.placement_date);
    const hasValidContractDate = isValidDate(client.contract_date);
    const hasValidDuration = contractDurationMonths > 0;

    logInfo('📋 Client data retrieved', {
      clientId,
      placement_date: client.placement_date,
      contract_date: client.contract_date,
      contract_duration_raw: client.contract_duration,
      contract_duration_number: contractDurationMonths,
      hasValidPlacementDate,
      hasValidContractDate,
      hasValidDuration,
    });

    // Si los datos son inválidos, retornar con valores "N/A"
    if (!hasValidDuration || (!hasValidPlacementDate && !hasValidContractDate)) {
      logWarning('⚠️ Invalid client contract data', { clientId });

      return {
        client_id: client.client_id,
        placement_date: hasValidPlacementDate ? client.placement_date : 'N/A',
        contract_date: hasValidContractDate ? client.contract_date : 'N/A',
        contract_duration: hasValidDuration ? contractDurationMonths : 'N/A',
        expiration_date: 'N/A',
        months_contracted: 'N/A',
        days_remaining: 'N/A',
        is_active: false,
        last_renewal: undefined,
      };
    }

    // Obtener todas las renovaciones para calcular total de meses contratados
    const allRenewalsResult = await pool.query(
      `SELECT 
        renewal_id,
        renewal_date,
        renewal_duration,
        renewal_document
       FROM CONTRACT_RENEWALS
       WHERE client_id = $1
       ORDER BY renewal_date DESC`,
      [clientId],
    );

    // Calcular suma total de meses de renovación
    const totalRenewalMonths = (allRenewalsResult.rows || []).reduce((sum, renewal) => {
      return sum + extractMonths(renewal.renewal_duration);
    }, 0);

    // Total de meses contratados = meses iniciales + suma de renovaciones
    const totalMonthsContracted = contractDurationMonths + totalRenewalMonths;

    // Obtener la última renovación para calcular vencimiento
    const lastRenewalResult = await pool.query(
      `SELECT 
        renewal_id,
        renewal_date,
        renewal_duration,
        renewal_document
       FROM CONTRACT_RENEWALS
       WHERE client_id = $1
       ORDER BY renewal_date DESC
       LIMIT 1`,
      [clientId],
    );

    let expirationDate: Date | string = 'N/A';
    let lastRenewal: any = undefined;

    try {
      if ((lastRenewalResult.rowCount ?? 0) > 0) {
        // Si existe renovación, calcular vencimiento desde la última renovación
        const renewal = lastRenewalResult.rows[0];

        // Validar que renewal_date sea válido
        if (!renewal.renewal_date) {
          throw new Error('renewal_date is null or undefined');
        }

        const durationMonths = extractMonths(renewal.renewal_duration);

        if (durationMonths <= 0) {
          throw new Error('Invalid duration months');
        }

        expirationDate = addMonthsToDate(renewal.renewal_date, durationMonths);

        try {
          const renewalDateObj = new Date(renewal.renewal_date);
          if (!isNaN(renewalDateObj.getTime())) {
            lastRenewal = {
              renewal_date: renewalDateObj,
              months_added: durationMonths,
              renewal_document: renewal.renewal_document || null,
            };
          }
        } catch (dateError) {
          logWarning('⚠️ Could not parse renewal_date', { renewal_date: renewal.renewal_date });
        }
      } else {
        // Si no hay renovación, calcular desde placement_date o contract_date
        const baseDate = hasValidPlacementDate ? client.placement_date : client.contract_date;
        expirationDate = addMonthsToDate(baseDate, contractDurationMonths);
      }
    } catch (dateError) {
      logWarning('⚠️ Error calculating expiration date', { clientId, error: dateError });
      expirationDate = 'N/A';
    }

    const daysRemaining = expirationDate instanceof Date ? calculateDaysRemaining(expirationDate) : 'N/A';

    const isActive = typeof daysRemaining === 'number' ? daysRemaining > 0 : false;

    const validity: IContractValidity = {
      client_id: client.client_id,
      placement_date: hasValidPlacementDate ? client.placement_date : 'N/A',
      contract_date: hasValidContractDate ? client.contract_date : 'N/A',
      contract_duration: contractDurationMonths,
      expiration_date: expirationDate instanceof Date ? expirationDate : expirationDate,
      months_contracted: totalMonthsContracted,
      days_remaining: daysRemaining,
      is_active: isActive,
      last_renewal: lastRenewal,
    };

    logInfo('✅ Contract validity calculated successfully', {
      clientId,
      daysRemaining,
      isActive,
      expirationDate: expirationDate instanceof Date ? expirationDate.toISOString() : expirationDate,
    });

    return validity;
  } catch (error) {
    logError(error, 'getContractValidity');
    throw error;
  }
};

/**
 * Renueva un contrato agregando meses y registrando la operación
 *
 * Flujo:
 * 1. Validar que no exista renovación duplicada el mismo día
 * 2. Obtener la última renovación actual (para saber fecha de vencimiento actual)
 * 3. Calcular nueva fecha de vencimiento
 * 4. Registrar renovación en TABLE CONTRACT_RENEWALS con renewal_duration
 * 5. Retornar respuesta con nuevos valores
 *
 * @param request - Datos de renovación (client_id, months_new, renewal_document_url)
 * @returns Respuesta con nueva fecha de vencimiento y meses agregados
 */
export const renewContract = async (request: IRenewalContractRequest): Promise<IRenewalContractResponse> => {
  logInfo('🔄 Renewing contract', {
    clientId: request.client_id,
    monthsNew: request.months_new,
  });

  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    const clientId = Number(request.client_id);
    const monthsNew = Number(request.months_new);
    // Agregar un día a la fecha de renovación para compensar la zona horaria
    const renewalDate = request.renewal_date ? new Date(new Date(request.renewal_date).getTime() + 24 * 60 * 60 * 1000) : new Date();

    // Validación: no permitir renovaciones duplicadas el mismo día
    const duplicateCheck = await dbClient.query(
      `SELECT COUNT(*) as count FROM CONTRACT_RENEWALS
       WHERE client_id = $1 AND DATE(renewal_date) = DATE($2)`,
      [clientId, renewalDate],
    );

    if (parseInt(duplicateCheck.rows[0].count) > 0) {
      logWarning('⚠️ Duplicate renewal detected', {
        clientId,
        renewalDate: renewalDate.toISOString(),
      });
      throw new Error('Ya existe una renovación registrada para este día');
    }

    // Obtener datos del cliente
    const clientDataResult = await dbClient.query(
      `SELECT 
        client_id,
        placement_date,
        contract_date,
        contract_duration
       FROM CLIENTS
       WHERE client_id = $1`,
      [clientId],
    );

    if ((clientDataResult.rowCount ?? 0) === 0) {
      throw new Error(`Cliente con ID ${clientId} no encontrado`);
    }

    const clientData = clientDataResult.rows[0];

    // Obtener la última renovación para calcular el vencimiento actual
    const lastRenewalResult = await dbClient.query(
      `SELECT 
        renewal_date,
        renewal_duration
       FROM CONTRACT_RENEWALS
       WHERE client_id = $1
       ORDER BY renewal_date DESC
       LIMIT 1`,
      [clientId],
    );

    // Determinar fecha de vencimiento actual
    let currentExpirationDate: Date;

    if ((lastRenewalResult.rowCount ?? 0) > 0) {
      // Si existe renovación anterior, calcular desde ella
      const lastRenewal = lastRenewalResult.rows[0];
      const durationMonths = extractMonths(lastRenewal.renewal_duration);
      currentExpirationDate = addMonthsToDate(lastRenewal.renewal_date, durationMonths);
    } else {
      // Si no hay renovación, calcular desde placement_date o contract_date
      if (clientData.placement_date) {
        currentExpirationDate = addMonthsToDate(clientData.placement_date, clientData.contract_duration);
      } else {
        currentExpirationDate = addMonthsToDate(clientData.contract_date, clientData.contract_duration);
      }
    }

    // Calcular nueva fecha de vencimiento
    const newExpirationDate = addMonthsToDate(currentExpirationDate, monthsNew);

    // Formatar duración como string (ej: "12 meses")
    const renewalDurationString = `${monthsNew} meses`;

    // Registrar renovación
    const renewalResult = await dbClient.query(
      `INSERT INTO CONTRACT_RENEWALS 
       (client_id, renewal_date, renewal_duration, renewal_document, renewal_amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING renewal_id, renewal_date, renewal_duration, renewal_amount`,
      [clientId, renewalDate, renewalDurationString, request.renewal_document_url || null, request.renewal_amount || null],
    );

    const renewalId = renewalResult.rows[0].renewal_id;

    // Si se proporcionó monto y frecuencia de pago, crear plan de pagos
    if (request.renewal_amount && request.payment_frequency) {
      const paymentAmount = request.renewal_amount;
      const frequency = request.payment_frequency;

      await dbClient.query(
        `INSERT INTO CONTRACT_PAYMENT_PLANS 
         (renewal_id, client_id, contract_id, contract_type, contract_amount, contract_start_date, contract_end_date, payment_frequency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [renewalId, clientId, `renewal-${renewalId}`, 'renewal', paymentAmount, renewalDate, newExpirationDate, frequency],
      );

      logInfo('💰 Payment plan created for renewal', {
        renewalId,
        clientId,
        amount: paymentAmount,
        frequency,
      });
    }

    await dbClient.query('COMMIT');

    const daysRemaining = calculateDaysRemaining(newExpirationDate);

    logInfo('✅ Contract renewed successfully', {
      clientId,
      newExpirationDate: newExpirationDate.toISOString(),
      daysRemaining,
    });

    return {
      success: true,
      message: 'Contrato renovado correctamente',
      data: {
        client_id: clientId,
        new_expiration_date: newExpirationDate.toISOString().split('T')[0],
        days_remaining: daysRemaining,
        previous_expiration_date: currentExpirationDate.toISOString().split('T')[0],
        renewal_date: renewalDate.toISOString().split('T')[0],
        months_added: monthsNew,
      },
    };
  } catch (error) {
    await dbClient.query('ROLLBACK');
    logError(error, 'renewContract');
    throw error;
  } finally {
    dbClient.release();
  }
};

/**
 * Obtiene historial de renovaciones de un cliente
 * @param clientId - ID del cliente
 * @returns Array de renovaciones ordenadas por fecha descendente
 */
export const getRenewalsHistory = async (clientId: number): Promise<IContractRenewal[]> => {
  logInfo('📜 Fetching renewal history', { clientId });

  try {
    const result = await pool.query(
      `SELECT 
        renewal_id,
        client_id,
        renewal_date,
        renewal_duration,
        renewal_document,
        notes,
        created_at,
        updated_at
       FROM CONTRACT_RENEWALS
       WHERE client_id = $1
       ORDER BY renewal_date DESC`,
      [clientId],
    );

    const renewals: IContractRenewal[] = (result.rows || [])
      .filter((row) => row.renewal_date && row.renewal_duration) // Filtrar filas con datos inválidos
      .map((row) => {
        const durationMonths = extractMonths(row.renewal_duration);

        let newExpirationDate: Date | string = 'N/A';
        try {
          if (durationMonths > 0) {
            newExpirationDate = addMonthsToDate(row.renewal_date, durationMonths);
          }
        } catch (error) {
          logWarning('⚠️ Error calculating expiration date for renewal', { renewal_id: row.renewal_id });
        }

        return {
          renewal_id: row.renewal_id,
          client_id: row.client_id,
          renewal_date: row.renewal_date,
          months_added: durationMonths,
          renewal_document_url: row.renewal_document,
          previous_expiration_date: row.renewal_date,
          new_expiration_date: newExpirationDate,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });

    logInfo('✅ Renewal history retrieved', {
      clientId,
      count: renewals.length,
    });

    return renewals;
  } catch (error) {
    logError(error, 'getRenewalsHistory');
    throw error;
  }
};
