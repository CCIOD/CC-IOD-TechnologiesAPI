import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";
import { azureUploadBlob, azureDeleteBlob } from "../services/azure.service";
import { getBlobName } from "../helpers/helpers";

export const createCarrierAct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const carrier_id = parseInt(req.params.id);
  const { act_title, act_description } = req.body;

  console.log('--- DEBUG: Inicio createCarrierAct ---');
  console.log('carrier_id:', carrier_id);
  console.log('act_title:', act_title);
  console.log('act_description:', act_description);
  console.log('req.file:', req.file ? 'Archivo presente' : 'No hay archivo');
  console.log('req.user:', req.user ? 'Usuario autenticado' : 'No autenticado');

  try {
    // 1. PRIMERO: Verificar autenticación del usuario
    const uploadedBy = req.user?.id;
    const uploadedByName = req.user?.name || req.user?.email || 'Usuario desconocido';

    if (!uploadedBy) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado.",
      });
    }

    // 2. Verificar que se subió un archivo
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Es necesario subir un archivo PDF para el acta.",
      });
    }

    const file = req.file;

    // 3. Verificar que el portador existe
    const carrierCheck = await pool.query({
      text: "SELECT carrier_id FROM CARRIERS WHERE carrier_id = $1",
      values: [carrier_id],
    });

    if (!carrierCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: "El portador especificado no existe.",
      });
    }

    // 4. FINALMENTE: Subir archivo a Azure (solo si todo está validado)
    console.log('--- DEBUG: Todas las validaciones pasadas, subiendo a Azure ---');
    const { message, success } = await azureUploadBlob({
      blob: file,
      containerName: "carrier-acts",
    });

    if (!success) {
      console.error('Error al subir archivo a Azure:', message);
      return res.status(500).json({
        success: false,
        message: message,
      });
    }

    const actDocumentUrl = message;

    // Guardar información del acta en la base de datos
    const query = {
      text: `INSERT INTO CARRIER_ACTS 
             (carrier_id, act_document_url, act_title, act_description, uploaded_by, uploaded_by_name, file_name, file_size) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             RETURNING *`,
      values: [
        carrier_id,
        actDocumentUrl,
        act_title,
        act_description || null,
        uploadedBy,
        uploadedByName,
        file.originalname,
        file.size,
      ],
    };

    const result = await pool.query(query);

    console.log('--- DEBUG: Acta creada exitosamente ---');
    console.log('result.rows[0]:', result.rows[0]);

    return res.status(201).json({
      success: true,
      message: "El acta se ha subido correctamente.",
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('--- DEBUG: Error en createCarrierAct ---');
    console.error('Error completo:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    next(error);
  }
};

export const getCarrierActs = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const carrier_id = parseInt(req.params.id);

  try {
    // Verificar que el portador existe
    const carrierCheck = await pool.query({
      text: "SELECT carrier_id FROM CARRIERS WHERE carrier_id = $1",
      values: [carrier_id],
    });

    if (!carrierCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: "El portador especificado no existe.",
      });
    }

    // Obtener todas las actas del portador
    const query = {
      text: `SELECT 
               act_id,
               carrier_id,
               act_document_url,
               act_title,
               act_description,
               uploaded_by,
               uploaded_by_name,
               upload_date,
               file_name,
               file_size,
               created_at,
               updated_at
             FROM CARRIER_ACTS 
             WHERE carrier_id = $1 
             ORDER BY upload_date DESC`,
      values: [carrier_id],
    };

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      message: `Actas del portador ${carrier_id}`,
      data: result.rows,
    });
  } catch (error: any) {
    next(error);
  }
};

export const deleteCarrierAct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const act_id = parseInt(req.params.actId);

  try {
    // Obtener información del acta antes de eliminarla
    const actQuery = {
      text: "SELECT act_document_url, file_name FROM CARRIER_ACTS WHERE act_id = $1",
      values: [act_id],
    };

    const actResult = await pool.query(actQuery);

    if (!actResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "El acta especificada no existe.",
      });
    }

    const actDocumentUrl = actResult.rows[0].act_document_url;
    const fileName = actResult.rows[0].file_name;

    // Eliminar el acta de la base de datos
    const deleteQuery = {
      text: "DELETE FROM CARRIER_ACTS WHERE act_id = $1",
      values: [act_id],
    };

    await pool.query(deleteQuery);

    // Eliminar el archivo de Azure
    const blobName = getBlobName(actDocumentUrl);
    const { message, success } = await azureDeleteBlob({
      blobname: blobName,
      containerName: "carrier-acts",
    });

    if (!success) {
      console.error(`Error al eliminar archivo de Azure: ${message}`);
      // No devolvemos error porque el registro ya se eliminó de la BD
    }

    return res.status(200).json({
      success: true,
      message: `El acta "${fileName}" ha sido eliminada correctamente.`,
    });
  } catch (error: any) {
    next(error);
  }
};

export const getAllCarrierActs = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    // Obtener todas las actas de todos los portadores con información del portador y cliente
    const query = {
      text: `SELECT 
               ca.act_id,
               ca.carrier_id,
               ca.act_document_url,
               ca.act_title,
               ca.act_description,
               ca.uploaded_by,
               ca.uploaded_by_name,
               ca.upload_date,
               ca.file_name,
               ca.file_size,
               ca.created_at,
               ca.updated_at,
               c.defendant_name as client_name,
               c.contract_number
             FROM CARRIER_ACTS ca
             INNER JOIN CARRIERS car ON ca.carrier_id = car.carrier_id
             INNER JOIN CLIENTS c ON car.client_id = c.client_id
             ORDER BY ca.upload_date DESC`,
    };

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      message: "Todas las actas de portadores",
      data: result.rows,
    });
  } catch (error: any) {
    next(error);
  }
};
