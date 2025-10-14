import { Request, Response, NextFunction } from "express";
import { pool } from "../database/connection";
import { azureUploadBlob, azureDeleteBlob } from "../services/azure.service";

/**
 * Obtener todos los oficios de un cliente específico
 */
export const getProsecutorDocsByClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.client_id);

  try {
    const query = {
      text: `
        SELECT 
          prosecutor_doc_id,
          client_id,
          document_type,
          document_number,
          issue_date,
          document_file,
          prosecutor_office,
          notes,
          created_at,
          updated_at
        FROM PROSECUTOR_DOCUMENTS
        WHERE client_id = $1
        ORDER BY issue_date DESC, created_at DESC
      `,
      values: [client_id],
    };

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      message: "Oficios obtenidos correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Obtener un oficio específico por ID
 */
export const getProsecutorDocById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const prosecutor_doc_id = parseInt(req.params.prosecutor_doc_id);

  try {
    const query = {
      text: `
        SELECT 
          pd.prosecutor_doc_id,
          pd.client_id,
          pd.document_type,
          pd.document_number,
          pd.issue_date,
          pd.document_file,
          pd.prosecutor_office,
          pd.notes,
          pd.created_at,
          pd.updated_at,
          c.defendant_name,
          c.contract_number
        FROM PROSECUTOR_DOCUMENTS pd
        INNER JOIN CLIENTS c ON pd.client_id = c.client_id
        WHERE pd.prosecutor_doc_id = $1
      `,
      values: [prosecutor_doc_id],
    };

    const result = await pool.query(query);

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Oficio no encontrado",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Oficio obtenido correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Crear un nuevo oficio de fiscalía
 */
export const createProsecutorDoc = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const {
    client_id,
    document_type,
    document_number,
    issue_date,
    prosecutor_office,
    notes,
  } = req.body;
  let document_file: string | null = null;

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

    // Si hay un archivo, subirlo a Azure
    if (req.file) {
      const file = req.file;
      const containerName = "prosecutor-documents";
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

      // Guardar la ruta completa con la carpeta
      document_file = `${folderPath}/${file.originalname.replace(/ /g, "_")}`;
    }

    const query = {
      text: `
        INSERT INTO PROSECUTOR_DOCUMENTS 
          (client_id, document_type, document_number, issue_date, 
           document_file, prosecutor_office, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING 
          prosecutor_doc_id,
          client_id,
          document_type,
          document_number,
          issue_date,
          document_file,
          prosecutor_office,
          notes,
          created_at,
          updated_at
      `,
      values: [
        client_id,
        document_type,
        document_number || null,
        issue_date,
        document_file,
        prosecutor_office || null,
        notes || null,
      ],
    };

    const result = await pool.query(query);

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: "Oficio creado correctamente",
    });
  } catch (error: any) {
    // Si hubo error y se subió un archivo, intentar eliminarlo
    if (req.file && document_file) {
      try {
        await azureDeleteBlob({
          blobname: document_file,
          containerName: "prosecutor-documents",
        });
      } catch (deleteError) {
        console.error("Error al eliminar archivo de Azure:", deleteError);
      }
    }
    next(error);
  }
};

/**
 * Actualizar un oficio existente
 */
export const updateProsecutorDoc = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const prosecutor_doc_id = parseInt(req.params.prosecutor_doc_id);
  const {
    document_type,
    document_number,
    issue_date,
    prosecutor_office,
    notes,
  } = req.body;

  try {
    // Verificar que el oficio existe
    const docCheck = await pool.query(
      "SELECT prosecutor_doc_id, document_file FROM PROSECUTOR_DOCUMENTS WHERE prosecutor_doc_id = $1",
      [prosecutor_doc_id]
    );

    if (!docCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Oficio no encontrado",
      });
    }

    const oldDocument = docCheck.rows[0].document_file;
    let document_file = oldDocument;

    // Si hay un nuevo archivo, subirlo a Azure y eliminar el anterior
    if (req.file) {
      const file = req.file;
      const containerName = "prosecutor-documents";
      
      // Obtener client_id del documento para organizar por carpeta
      const clientQuery = await pool.query(
        "SELECT client_id FROM PROSECUTOR_DOCUMENTS WHERE prosecutor_doc_id = $1",
        [prosecutor_doc_id]
      );
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

      document_file = `${folderPath}/${file.originalname.replace(/ /g, "_")}`;

      // Eliminar el documento anterior si existe
      if (oldDocument) {
        try {
          await azureDeleteBlob({
            blobname: oldDocument,
            containerName: containerName,
          });
        } catch (deleteError) {
          console.error("Error al eliminar documento anterior:", deleteError);
        }
      }
    }

    // Construir query dinámico
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (document_type !== undefined) {
      updates.push(`document_type = $${paramCount}`);
      values.push(document_type);
      paramCount++;
    }

    if (document_number !== undefined) {
      updates.push(`document_number = $${paramCount}`);
      values.push(document_number || null);
      paramCount++;
    }

    if (issue_date !== undefined) {
      updates.push(`issue_date = $${paramCount}`);
      values.push(issue_date);
      paramCount++;
    }

    if (document_file !== oldDocument) {
      updates.push(`document_file = $${paramCount}`);
      values.push(document_file);
      paramCount++;
    }

    if (prosecutor_office !== undefined) {
      updates.push(`prosecutor_office = $${paramCount}`);
      values.push(prosecutor_office || null);
      paramCount++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      values.push(notes || null);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se proporcionaron campos para actualizar",
      });
    }

    values.push(prosecutor_doc_id);

    const query = {
      text: `
        UPDATE PROSECUTOR_DOCUMENTS
        SET ${updates.join(", ")}
        WHERE prosecutor_doc_id = $${paramCount}
        RETURNING 
          prosecutor_doc_id,
          client_id,
          document_type,
          document_number,
          issue_date,
          document_file,
          prosecutor_office,
          notes,
          created_at,
          updated_at
      `,
      values,
    };

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      data: result.rows[0],
      message: "Oficio actualizado correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Eliminar un oficio
 */
export const deleteProsecutorDoc = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const prosecutor_doc_id = parseInt(req.params.prosecutor_doc_id);

  try {
    // Obtener el oficio antes de eliminarlo
    const docCheck = await pool.query(
      "SELECT prosecutor_doc_id, document_file FROM PROSECUTOR_DOCUMENTS WHERE prosecutor_doc_id = $1",
      [prosecutor_doc_id]
    );

    if (!docCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Oficio no encontrado",
      });
    }

    const document_file = docCheck.rows[0].document_file;

    // Eliminar de la base de datos
    const query = {
      text: "DELETE FROM PROSECUTOR_DOCUMENTS WHERE prosecutor_doc_id = $1",
      values: [prosecutor_doc_id],
    };

    await pool.query(query);

    // Eliminar el documento de Azure si existe
    if (document_file) {
      try {
        await azureDeleteBlob({
          blobname: document_file,
          containerName: "prosecutor-documents",
        });
      } catch (deleteError) {
        console.error("Error al eliminar documento de Azure:", deleteError);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Oficio eliminado correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};

/**
 * Obtener todos los oficios (admin)
 */
export const getAllProsecutorDocs = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const query = {
      text: `
        SELECT 
          pd.prosecutor_doc_id,
          pd.client_id,
          pd.document_type,
          pd.document_number,
          pd.issue_date,
          pd.document_file,
          pd.prosecutor_office,
          pd.notes,
          pd.created_at,
          pd.updated_at,
          c.defendant_name,
          c.contract_number
        FROM PROSECUTOR_DOCUMENTS pd
        INNER JOIN CLIENTS c ON pd.client_id = c.client_id
        ORDER BY pd.issue_date DESC, pd.created_at DESC
      `,
    };

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      message: "Oficios obtenidos correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};
