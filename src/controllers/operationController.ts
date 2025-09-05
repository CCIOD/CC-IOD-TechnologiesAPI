import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";

import { azureDeleteBlob, azureUploadBlob } from "../services/azure.service";
import { getBlobName } from "../helpers/helpers";

export const getAllOperations = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const query = `
      SELECT 
        A.operation_id as id, 
        A.installation_report,
        B.carrier_id,
        B.residence_area,
        B.placement_date,
        B.placement_time,
        B.electronic_bracelet,
        B.beacon,
        B.wireless_charger,
        B.information_emails,
        B.contact_numbers as carrier_contacts,
        B.house_arrest,
        B.installer_name,
        B.observations as carrier_observations,
        B.relationship_id,
        C.client_id,
        C.defendant_name as name,
        C.contract_number,
        C.criminal_case,
        C.investigation_file_number,
        C.judge_name,
        C.court_name,
        C.lawyer_name,
        C.signer_name,
        C.hearing_date,
        C.contract_date,
        C.contract_document,
        C.contract_duration,
        C.payment_day,
        C.status as client_status,
        C.contract,
        C.prospect_id,
        R.name as relationship_name
      FROM OPERATIONS A 
      INNER JOIN CARRIERS B ON A.carrier_id = B.carrier_id 
      INNER JOIN CLIENTS C ON B.client_id = C.client_id 
      LEFT JOIN RELATIONSHIPS R ON B.relationship_id = R.relationship_id
      ORDER BY A.operation_id`;
    
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningúna operación." });

    // Obtener contactos y observaciones para cada cliente
    const enrichedOperations = await Promise.all(
      result.rows.map(async (operation: any) => {
        // Obtener contactos del cliente
        const contactResult = await pool.query({
          text: `SELECT cc.contact_name, cc.phone_number, cc.relationship_id, r.name as relationship_name 
                 FROM CLIENT_CONTACTS cc 
                 LEFT JOIN RELATIONSHIPS r ON cc.relationship_id = r.relationship_id 
                 WHERE cc.client_id = $1`,
          values: [operation.client_id],
        });
        operation.client_contacts = contactResult.rows;

        // Obtener observaciones del cliente
        const observationResult = await pool.query({
          text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date DESC",
          values: [operation.client_id],
        });
        operation.client_observations = observationResult.rows;

        return operation;
      })
    );

    return res.status(201).json({
      success: true,
      message: "Información de todas las operaciones",
      data: enrichedOperations,
    });
  } catch (error) {
    next(error);
  }
};

export const updateOperation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const operation_id = parseInt(req.params.id);
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Parece que no hay ningún cambio que hacer.",
      });
    }
    const file = req.file;

    const { message, success } = await azureUploadBlob({
      blob: file,
      containerName: "reports",
    });
    if (!success)
      return res.status(500).json({
        success: false,
        message: message,
      });
    const report = message;
    const query = {
      text: "UPDATE OPERATIONS SET installation_report = $1 WHERE operation_id = $2 RETURNING installation_report",
      values: [report, operation_id],
    };
    await pool.query(query);
    return res.status(201).json({
      success: true,
      message: "La operación se ha modificado correctamente",
      data: { installation_report: report },
    });
  } catch (error: any) {
    next(error);
  }
};
export const deleteOperation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const carrier_id = parseInt(req.params.id);
  try {
    const query = {
      text: "DELETE FROM OPERATIONS WHERE carrier_id = $1 RETURNING installation_report",
      values: [carrier_id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "La operación que desea eliminar no se encuentra." });
    const report = getBlobName(result.rows[0].installation_report as string);
    const { message, success } = await azureDeleteBlob({
      blobname: report,
      containerName: "reports",
    });
    if (!success)
      return res.status(500).json({
        success: false,
        message: message,
      });
    return res.status(201).json({
      success: true,
      message: `La operación ha sido eliminado`,
    });
  } catch (error: any) {
    next(error);
  }
};
export const deleteFile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const operation_id = parseInt(req.params.id);
  const { filename } = req.body;
  try {
    const { message, success } = await azureDeleteBlob({
      blobname: filename,
      containerName: "reports",
    });
    if (!success)
      return res.status(500).json({
        success: false,
        message: message,
      });
    const query = {
      text: "UPDATE OPERATIONS SET installation_report = $1 WHERE operation_id = $2",
      values: [null, operation_id],
    };
    await pool.query(query);
    return res.status(201).json({
      success: true,
      message: "La operación se ha modificado correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};
