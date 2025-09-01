import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";
import { azureDeleteBlob, azureUploadBlob } from "../services/azure.service";
import { getBlobName } from "../helpers/helpers";

export const getAllClients = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const clientQuery =
      "SELECT client_id as id, contact_numbers, contract_number, court_name, criminal_case, defendant_name as name, hearing_date, investigation_file_number, judge_name, lawyer_name, prospect_id, signer_name, status, contract, contract_date, contract_document, contract_duration, payment_day FROM CLIENTS ORDER BY client_id";
    const clientResult = await pool.query(clientQuery);

    if (!clientResult.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún cliente." });

    const clients = clientResult.rows;

    // Obtener observaciones para cada cliente
    const observationQueries = clients.map(async (client: any) => {
      const observationResult = await pool.query({
        text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1",
        values: [client.id],
      });
      client.observations = observationResult.rows;
      return client;
    });

    const enrichedClients = await Promise.all(observationQueries);

    return res.status(201).json({
      success: true,
      message: "Información de todos los clientes",
      data: enrichedClients,
    });
  } catch (error) {
    next(error);
  }
};
export const createClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const {
    contract_number,
    defendant_name,
    criminal_case,
    investigation_file_number,
    judge_name,
    court_name,
    lawyer_name,
    signer_name,
    contact_numbers,
    hearing_date,
    contract_date,
    contract_document,
    contract_duration,
    payment_day,
    observations,
    status,
    prospect_id,
  } = req.body;
  try {
    const invFileOptional = investigation_file_number
      ? investigation_file_number
      : null;
    const contractDateOptional = contract_date 
      ? new Date(contract_date).toISOString().split('T')[0] 
      : null;
    const numbers = JSON.stringify(contact_numbers);

    const prospect = await pool.query(
      "SELECT status FROM PROSPECTS WHERE prospect_id = $1",
      [prospect_id]
    );

    if (prospect.rows[0].status !== "Aprobado") {
      return res.status(400).json({
        success: false,
        message: "No es posible agregar un cliente sin antes ser aprobado.",
      });
    }

    // Insertar cliente
    const clientQuery = {
      text: "INSERT INTO CLIENTS(contract_number, defendant_name, criminal_case, investigation_file_number, judge_name, court_name, lawyer_name, signer_name, contact_numbers, hearing_date, contract_date, contract_document, contract_duration, payment_day, status, prospect_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING client_id",
      values: [
        contract_number || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        numbers,
        new Date(hearing_date).toISOString().split('T')[0],
        contractDateOptional,
        contract_document || null,
        contract_duration || null,
        payment_day || null,
        status,
        prospect_id,
      ],
    };
    const clientResult = await pool.query(clientQuery);
    const clientId = clientResult.rows[0].client_id;

    // Insertar observaciones
    if (observations && Array.isArray(observations)) {
      const observationQueries = observations.map((obs: any) => {
        const formattedObsDate = new Date(obs.date).toISOString().split('T')[0];
        return pool.query({
          text: "INSERT INTO CLIENT_OBSERVATIONS(client_id, observation_date, observation) VALUES($1, $2, $3)",
          values: [clientId, formattedObsDate, obs.observation],
        });
      });
      await Promise.all(observationQueries);
    }

    return res.status(201).json({
      success: true,
      message: "El cliente se ha creado correctamente",
      data: {
        id: clientId,
        contract_number,
        defendant_name,
        criminal_case,
        investigation_file_number: invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        contact_numbers,
        hearing_date,
        contract_date: contractDateOptional,
        contract_document,
        contract_duration,
        payment_day,
        status,
        prospect_id,
        observations,
      },
    });
  } catch (error: any) {
    next(error);
  }
};
export const updateClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const {
    contract_number,
    defendant_name,
    criminal_case,
    investigation_file_number,
    judge_name,
    court_name,
    lawyer_name,
    signer_name,
    contact_numbers,
    hearing_date,
    contract_date,
    contract_document,
    contract_duration,
    payment_day,
    observations,
    status,
    prospect_id,
  } = req.body;
  try {
    const client = await pool.query(
      "SELECT client_id FROM CARRIERS WHERE client_id = $1",
      [client_id]
    );
    const newStatus = client.rowCount
      ? status === "Pendiente de colocación" || status === "Colocado"
        ? status
        : "Pendiente de colocación"
      : status;
    const invFileOptional = investigation_file_number
      ? investigation_file_number
      : null;
    const contractDateOptional = contract_date 
      ? new Date(contract_date).toISOString().split('T')[0] 
      : null;
    const numbers = JSON.stringify(contact_numbers);

    // Actualizar cliente
    const clientQuery = {
      text: "UPDATE CLIENTS SET contract_number=$1, defendant_name=$2, criminal_case=$3, investigation_file_number=$4, judge_name=$5, court_name=$6, lawyer_name=$7, signer_name=$8, contact_numbers=$9, hearing_date=$10, contract_date=$11, contract_document=$12, contract_duration=$13, payment_day=$14, status=$15 WHERE client_id = $16 RETURNING *",
      values: [
        contract_number || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        numbers,
        new Date(hearing_date).toISOString().split('T')[0],
        contractDateOptional,
        contract_document || null,
        contract_duration || null,
        payment_day || null,
        newStatus,
        client_id,
      ],
    };
    const clientResult = await pool.query(clientQuery);

    if (!clientResult.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún cliente." });

    // Actualizar observaciones
    if (observations && Array.isArray(observations)) {
      // Eliminar observaciones existentes
      await pool.query({
        text: "DELETE FROM CLIENT_OBSERVATIONS WHERE client_id = $1",
        values: [client_id],
      });

      // Insertar nuevas observaciones
      const observationQueries = observations.map((obs: any) => {
        const formattedObsDate = new Date(obs.date).toISOString().split('T')[0];
        return pool.query({
          text: "INSERT INTO CLIENT_OBSERVATIONS(client_id, observation_date, observation) VALUES($1, $2, $3)",
          values: [client_id, formattedObsDate, obs.observation],
        });
      });
      await Promise.all(observationQueries);
    }

    return res.status(201).json({
      success: true,
      message: "El cliente se ha modificado correctamente",
      data: clientResult.rows[0],
    });
  } catch (error) {
    next(error);
  }
};
export const deleteClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const clientId = parseInt(req.params.id);
  try {
    const query = {
      text: "DELETE FROM CLIENTS WHERE client_id = $1 RETURNING contract",
      values: [clientId],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "El cliente que desea eliminar no se encuentra." });
    const BDContract: string | null = result.rows[0].contract;
    if (BDContract) {
      const contract = getBlobName(BDContract);
      const { message, success } = await azureDeleteBlob({
        blobname: contract,
        containerName: "contracts",
      });
      if (!success)
        return res.status(500).json({
          success: false,
          message: message,
        });
    }
    return res.status(201).json({
      success: true,
      message: `El cliente ${clientId} ha sido eliminado`,
    });
  } catch (error: any) {
    next(error);
  }
};

export const getApprovedClientsWithoutCarrier = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const query = {
      text: "SELECT client_id as id, defendant_name as name FROM CLIENTS WHERE (status = 'Pendiente de colocación' OR status = 'Colocado')  AND client_id NOT IN (SELECT client_id FROM CARRIERS)",
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res.status(404).json({
        message: "No se encontró ningún cliente que pueda ser portador",
      });
    return res.status(201).json({
      success: true,
      message: "Prospectos con estado Pendiente de colocación o Colocado",
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
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
      containerName: "contracts",
    });
    if (!success)
      return res.status(500).json({
        success: false,
        message: message,
      });
    const contract = message;
    const query = {
      text: "UPDATE CLIENTS SET contract = $1 WHERE client_id = $2 RETURNING contract",
      values: [contract, client_id],
    };
    const result = await pool.query(query);
    return res.status(201).json({
      success: true,
      message: "El contrato se ha subido.",
      data: { contract: result.rows[0].contract },
    });
  } catch (error: any) {
    next(error);
  }
};

export const deleteContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { filename } = req.body;
  try {
    const { message, success } = await azureDeleteBlob({
      blobname: filename,
      containerName: "contracts",
    });
    if (!success)
      return res.status(500).json({
        success: false,
        message: message,
      });

    const query = {
      text: "UPDATE CLIENTS SET contract = $1 WHERE client_id = $2",
      values: [null, client_id],
    };
    await pool.query(query);
    return res.status(201).json({
      success: true,
      message: "El cliente se ha modificado correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};
