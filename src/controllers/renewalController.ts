import { Request, Response, NextFunction } from 'express';
import { pool } from '../database/connection';
import { azureUploadBlob, azureDeleteBlob } from '../services/azure.service';

/**
 * Obtener todas las renovaciones de un cliente específico
 */
export const getRenewalsByClient = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.client_id);

  try {
    const query = {
      text: `
        SELECT 
          renewal_id,
          client_id,
          renewal_date,
          renewal_document,
          renewal_duration,
          notes,
          created_at,
          updated_at
        FROM CONTRACT_RENEWALS
        WHERE client_id = $1
        ORDER BY renewal_date DESC
      `,
      values: [client_id],
    };

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      message: 'Renovaciones obtenidas correctamente',
      data: result.rows,
      count: result.rowCount,
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Obtener una renovación específica por ID
 */
export const getRenewalById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const renewal_id = parseInt(req.params.renewal_id);

  try {
    const query = {
      text: `
        SELECT 
          r.renewal_id,
          r.client_id,
          r.renewal_date,
          r.renewal_document,
          r.renewal_duration,
          r.notes,
          r.created_at,
          r.updated_at,
          c.defendant_name,
          c.contract_number
        FROM CONTRACT_RENEWALS r
        INNER JOIN CLIENTS c ON r.client_id = c.client_id
        WHERE r.renewal_id = $1
      `,
      values: [renewal_id],
    };

    const result = await pool.query(query);

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Renovación no encontrada',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Renovación obtenida correctamente',
      data: result.rows[0],
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Crear una nueva renovación de contrato
 */
export const createRenewal = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const { client_id, renewal_date, renewal_duration, notes } = req.body;
  let renewal_document: string | null = null;

  try {
    // Verificar que el cliente existe
    const clientCheck = await pool.query('SELECT client_id FROM CLIENTS WHERE client_id = $1', [client_id]);

    if (!clientCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado',
      });
    }

    // Si hay un archivo, subirlo a Azure
    if (req.file) {
      const file = req.file;
      const containerName = 'contract-renewals';
      const folderPath = `client-${client_id}`; // Organizar por cliente

      const uploadResult = await azureUploadBlob({
        blob: file,
        containerName: containerName,
        folderPath: folderPath,
      });

      if (!uploadResult.success) {
        return res.status(500).json({
          success: false,
          message: uploadResult.message,
        });
      }

      renewal_document = `${folderPath}/${file.originalname.replace(/ /g, '_')}`;
    }

    const query = {
      text: `
        INSERT INTO CONTRACT_RENEWALS 
          (client_id, renewal_date, renewal_document, renewal_duration, notes)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING 
          renewal_id,
          client_id,
          renewal_date,
          renewal_document,
          renewal_duration,
          notes,
          created_at,
          updated_at
      `,
      values: [client_id, renewal_date, renewal_document, renewal_duration || null, notes || null],
    };

    const result = await pool.query(query);

    return res.status(201).json({
      success: true,
      message: 'Renovación de contrato creada correctamente',
      data: result.rows[0],
    });
  } catch (error: any) {
    // Si hubo error y se subió un archivo, intentar eliminarlo
    if (req.file && renewal_document) {
      try {
        await azureDeleteBlob({
          blobname: renewal_document,
          containerName: 'contract-renewals',
        });
      } catch (deleteError) {
        console.error('Error al eliminar archivo de Azure:', deleteError);
      }
    }
    next(error);
  }
};

/**
 * Actualizar una renovación existente
 */
export const updateRenewal = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const renewal_id = parseInt(req.params.renewal_id);
  const { renewal_date, renewal_duration, notes, renewal_amount, payment_frequency } = req.body;

  try {
    // Verificar que la renovación existe
    const renewalCheck = await pool.query('SELECT renewal_id, renewal_document FROM CONTRACT_RENEWALS WHERE renewal_id = $1', [renewal_id]);

    if (!renewalCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Renovación no encontrada',
      });
    }

    const oldDocument = renewalCheck.rows[0].renewal_document;
    let renewal_document = oldDocument;

    // Si hay un nuevo archivo, subirlo a Azure y eliminar el anterior
    if (req.file) {
      const file = req.file;
      const containerName = 'contract-renewals';

      // Obtener client_id de la renovación para organizar por carpeta
      const clientQuery = await pool.query('SELECT client_id FROM CONTRACT_RENEWALS WHERE renewal_id = $1', [renewal_id]);
      const client_id = clientQuery.rows[0].client_id;
      const folderPath = `client-${client_id}`;

      const uploadResult = await azureUploadBlob({
        blob: file,
        containerName: containerName,
        folderPath: folderPath,
      });

      if (!uploadResult.success) {
        return res.status(500).json({
          success: false,
          message: uploadResult.message,
        });
      }

      renewal_document = `${folderPath}/${file.originalname.replace(/ /g, '_')}`;

      // Eliminar el documento anterior si existe
      if (oldDocument) {
        try {
          await azureDeleteBlob({
            blobname: oldDocument,
            containerName: containerName,
          });
        } catch (deleteError) {
          console.error('Error al eliminar documento anterior:', deleteError);
        }
      }
    }

    // Construir query dinámico
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (renewal_date !== undefined) {
      updates.push(`renewal_date = $${paramCount}`);
      values.push(renewal_date);
      paramCount++;
    }

    if (renewal_document !== oldDocument) {
      updates.push(`renewal_document = $${paramCount}`);
      values.push(renewal_document);
      paramCount++;
    }

    if (renewal_duration !== undefined) {
      updates.push(`renewal_duration = $${paramCount}`);
      values.push(renewal_duration || null);
      paramCount++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      values.push(notes || null);
      paramCount++;
    }

    if (renewal_amount !== undefined) {
      const amount = parseFloat(renewal_amount);
      if (!isNaN(amount)) {
        updates.push(`renewal_amount = $${paramCount}`);
        values.push(amount);
        paramCount++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se proporcionaron campos para actualizar',
      });
    }

    values.push(renewal_id);

    const query = {
      text: `
        UPDATE CONTRACT_RENEWALS
        SET ${updates.join(', ')}
        WHERE renewal_id = $${paramCount}
        RETURNING 
          renewal_id,
          client_id,
          renewal_date,
          renewal_document,
          renewal_duration,
          renewal_amount,
          notes,
          created_at,
          updated_at
      `,
      values,
    };

    const result = await pool.query(query);

    // Si se actualizó renewal_amount o payment_frequency, actualizar o crear el plan de pago
    if (renewal_amount !== undefined || payment_frequency !== undefined) {
      const updatedRenewal = result.rows[0];
      const client_id = updatedRenewal.client_id;

      // Verificar si existe plan de pago para esta renovación
      const planCheck = await pool.query("SELECT plan_id FROM CONTRACT_PAYMENT_PLANS WHERE renewal_id = $1 AND contract_type = 'renewal'", [renewal_id]);

      // Obtener frecuencia de pago del cliente si no se proporciona
      const clientPaymentFreq = await pool.query('SELECT payment_frequency FROM CLIENTS WHERE client_id = $1', [client_id]);
      const clientFrequency = clientPaymentFreq.rows[0]?.payment_frequency || null;
      const paymentFrequencyToUse = payment_frequency || clientFrequency;

      if ((planCheck.rowCount ?? 0) === 0 && renewal_amount !== undefined) {
        // Crear plan de pago si no existe y se proporcionó un monto
        const amount = parseFloat(renewal_amount);

        // Calcular fecha de fin (renewal_date + duration)
        let contractEndDate = null;
        if (updatedRenewal.renewal_date && updatedRenewal.renewal_duration) {
          const startDate = new Date(updatedRenewal.renewal_date);
          const months = parseInt(updatedRenewal.renewal_duration) || 0;
          const endDate = new Date(startDate.setMonth(startDate.getMonth() + months));
          contractEndDate = endDate.toISOString().split('T')[0];
        }

        const createPlanQuery = `
          INSERT INTO CONTRACT_PAYMENT_PLANS (
            client_id, contract_id, contract_type, renewal_id,
            contract_start_date, contract_end_date, contract_amount,
            payment_frequency,
            total_scheduled_amount, total_paid_amount, total_pending_amount,
            status, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, 'Activo', NOW(), NOW())
          RETURNING plan_id
        `;

        await pool.query(createPlanQuery, [
          client_id,
          `REN_${renewal_id}_${Date.now()}`,
          'renewal',
          renewal_id,
          updatedRenewal.renewal_date ? new Date(updatedRenewal.renewal_date).toISOString().split('T')[0] : null,
          contractEndDate,
          amount,
          paymentFrequencyToUse,
        ]);
      } else if ((planCheck.rowCount ?? 0) > 0) {
        // Actualizar plan existente
        const updatePlanFields: string[] = [];
        const updatePlanValues: any[] = [];
        let planParamCount = 1;

        if (renewal_amount !== undefined) {
          updatePlanFields.push(`contract_amount = $${planParamCount}`);
          updatePlanValues.push(parseFloat(renewal_amount));
          planParamCount++;
        }

        if (payment_frequency !== undefined) {
          updatePlanFields.push(`payment_frequency = $${planParamCount}`);
          updatePlanValues.push(paymentFrequencyToUse);
          planParamCount++;
        }

        if (updatePlanFields.length > 0) {
          updatePlanValues.push(planCheck.rows[0].plan_id);
          await pool.query(`UPDATE CONTRACT_PAYMENT_PLANS SET ${updatePlanFields.join(', ')} WHERE plan_id = $${planParamCount}`, updatePlanValues);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Renovación actualizada correctamente',
      data: result.rows[0],
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Eliminar una renovación
 */
export const deleteRenewal = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const renewal_id = parseInt(req.params.renewal_id);

  try {
    // Obtener la renovación antes de eliminarla
    const renewalCheck = await pool.query('SELECT renewal_id, renewal_document FROM CONTRACT_RENEWALS WHERE renewal_id = $1', [renewal_id]);

    if (!renewalCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Renovación no encontrada',
      });
    }

    const renewal_document = renewalCheck.rows[0].renewal_document;

    // Eliminar de la base de datos
    const query = {
      text: 'DELETE FROM CONTRACT_RENEWALS WHERE renewal_id = $1',
      values: [renewal_id],
    };

    await pool.query(query);

    // Eliminar el documento de Azure si existe
    if (renewal_document) {
      try {
        await azureDeleteBlob({
          blobname: renewal_document,
          containerName: 'contract-renewals',
        });
      } catch (deleteError) {
        console.error('Error al eliminar documento de Azure:', deleteError);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Renovación eliminada correctamente',
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Obtener todas las renovaciones (admin)
 */
export const getAllRenewals = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const query = {
      text: `
        SELECT 
          r.renewal_id,
          r.client_id,
          r.renewal_date,
          r.renewal_document,
          r.renewal_duration,
          r.notes,
          r.created_at,
          r.updated_at,
          c.defendant_name,
          c.contract_number
        FROM CONTRACT_RENEWALS r
        INNER JOIN CLIENTS c ON r.client_id = c.client_id
        ORDER BY r.renewal_date DESC
      `,
    };

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      message: 'Renovaciones obtenidas correctamente',
      data: result.rows,
      count: result.rowCount,
    });
  } catch (error: any) {
    next(error);
  }
};
