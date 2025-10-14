import { Request, Response, NextFunction } from "express";
import { pool } from "../database/connection";
import { azureUploadBlob, azureDeleteBlob } from "../services/azure.service";

/**
 * Obtener todos los archivos de un cliente
 */
export const getFilesByClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);

  try {
    const query = `
      SELECT 
        file_id as id,
        file_type as tipo,
        file_name as nombre,
        file_path as ruta,
        file_size as tamanio,
        uploaded_at as "fechaSubida",
        uploaded_by as "subidoPor",
        description as descripcion
      FROM CLIENT_FILES
      WHERE client_id = $1
      ORDER BY uploaded_at DESC
    `;

    const result = await pool.query(query, [client_id]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      message: "Archivos obtenidos correctamente",
    });
  } catch (error: any) {
    console.error("Error al obtener archivos:", error);
    next(error);
  }
};

/**
 * Subir un nuevo archivo
 */
export const uploadFile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { tipo, descripcion } = req.body;
  const uploadedBy = (req as any).user?.email || 'Sistema';

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No se proporcionó ningún archivo",
      });
    }

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

    const file = req.file;
    const containerName = "contracts"; // Usar contenedor existente
    const folderPath = `client-${client_id}`; // Organizar por cliente
    
    // Subir archivo a Azure
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

    const fileName = `${folderPath}/${file.originalname.replace(/ /g, "_")}`;
    
    // Guardar registro en la base de datos
    const query = `
      INSERT INTO CLIENT_FILES (
        client_id, file_type, file_name, file_path, 
        file_size, uploaded_by, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        file_id as id,
        file_type as tipo,
        file_name as nombre,
        file_path as ruta,
        file_size as tamanio,
        uploaded_at as "fechaSubida",
        uploaded_by as "subidoPor",
        description as descripcion
    `;

    const values = [
      client_id,
      tipo || 'Otro',
      fileName,
      fileName, // Guardar nombre del archivo como ruta
      file.size,
      uploadedBy,
      descripcion || null,
    ];

    const result = await pool.query(query, values);

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: "Archivo subido correctamente",
    });
  } catch (error: any) {
    console.error("Error al subir archivo:", error);
    next(error);
  }
};

/**
 * Eliminar un archivo
 */
export const deleteFile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const file_id = parseInt(req.params.archivoId);

  try {
    // Obtener información del archivo
    const fileQuery = `
      SELECT file_id, file_path, file_name
      FROM CLIENT_FILES
      WHERE file_id = $1 AND client_id = $2
    `;
    const fileResult = await pool.query(fileQuery, [file_id, client_id]);

    if (!fileResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Archivo no encontrado",
      });
    }

    const file = fileResult.rows[0];

    // Eliminar de la base de datos
    const deleteQuery = `
      DELETE FROM CLIENT_FILES 
      WHERE file_id = $1
      RETURNING file_id
    `;
    await pool.query(deleteQuery, [file_id]);

    // Eliminar de Azure
    if (file.file_path) {
      try {
        await azureDeleteBlob({
          blobname: file.file_name,
          containerName: "contracts",
        });
      } catch (azureError) {
        console.error("Error al eliminar archivo de Azure:", azureError);
        // Continuar aunque falle la eliminación de Azure
      }
    }

    return res.status(200).json({
      success: true,
      message: "Archivo eliminado correctamente",
    });
  } catch (error: any) {
    console.error("Error al eliminar archivo:", error);
    next(error);
  }
};
