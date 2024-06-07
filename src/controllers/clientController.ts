import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";
import { removeFile } from "../helpers/removeFile";
import { generateFilename } from "../helpers/generateFilename";

export const getAllClients = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const query =
      "SELECT client_id as id, contact_numbers, contract_number, court_name, criminal_case, defendant_name as name, hearing_date, investigation_file_number, judge_name, lawyer_name, observations, prospect_id, signer_name, status, contract FROM CLIENTS ORDER BY client_id";
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún cliente." });
    return res.status(201).json({
      success: true,
      message: "Información de todos los clientes",
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};
export const getClientById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  try {
    const query = {
      name: "get-client-id",
      text: "SELECT client_id as id, contact_numbers, contract_number, court_name, criminal_case, defendant_name as name, hearing_date, investigation_file_number, judge_name, lawyer_name, observations, prospect_id, signer_name, status FROM CLIENTS WHERE client_id = $1",
      values: [client_id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún cliente." });
    return res.status(201).json({
      success: true,
      message: "Datos del cliente obtenidos",
      data: result.rows[0],
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
    observations,
    status,
    prospect_id,
  } = req.body;
  try {
    const obserOptional = observations ? observations : "";
    const invFileOptional = investigation_file_number
      ? investigation_file_number
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
    const query = {
      text: "INSERT INTO CLIENTS(contract_number, defendant_name, criminal_case, investigation_file_number, judge_name, court_name, lawyer_name, signer_name, contact_numbers, hearing_date, observations, status, prospect_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
      values: [
        contract_number,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        numbers,
        hearing_date,
        obserOptional,
        status,
        prospect_id,
      ],
    };
    await pool.query(query);
    return res.status(201).json({
      success: true,
      message: "El prospecto se ha creado correctamente",
      data: req.body,
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
    const obserOptional = observations ? observations : "";
    const invFileOptional = investigation_file_number
      ? investigation_file_number
      : null;
    const numbers = JSON.stringify(contact_numbers);
    const query = {
      text: "UPDATE CLIENTS SET contract_number=$1, defendant_name=$2, criminal_case=$3, investigation_file_number=$4, judge_name=$5, court_name=$6, lawyer_name=$7, signer_name=$8, contact_numbers=$9, hearing_date=$10, observations=$11, status=$12 WHERE client_id = $13",
      values: [
        contract_number,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        numbers,
        hearing_date,
        obserOptional,
        newStatus,
        client_id,
      ],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún prospecto." });
    return res.status(201).json({
      success: true,
      message: "El prospecto se ha modificado correctamente",
      data: { defendant_name },
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
      text: "DELETE FROM CLIENTS WHERE client_id = $1",
      values: [clientId],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "El cliente que desea eliminar no se encuentra." });
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
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    console.log(files);

    if (!files.contract) {
      return res.status(400).json({
        success: false,
        message: "Parece que no hay ningún cambio que hacer.",
      });
    }
    const client = await pool.query(
      "SELECT contract FROM CLIENTS WHERE client_id = $1",
      [client_id]
    );
    if (files.contract && client.rows[0].contract) {
      const remove = removeFile(client.rows[0].contract);
      if (!remove) {
        return res.status(400).json({
          message: "No se pudo eliminar el contrato anterior.",
        });
      }
    }
    const contract = files.contract
      ? generateFilename(req, files.contract[0].filename)
      : client.rows[0].contract;

    const query = {
      text: "UPDATE CLIENTS SET contract = $1 WHERE client_id = $2",
      values: [contract, client_id],
    };
    await pool.query(query);
    return res.status(201).json({
      success: true,
      message: "El contrato se ha subido.",
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
  try {
    const client = await pool.query(
      "SELECT contract FROM CLIENTS WHERE client_id = $1",
      [client_id]
    );
    const contractBD = client.rows[0].contract;
    const remove = removeFile(contractBD);
    if (!remove) {
      return res.status(400).json({
        success: false,
        message: "Ha ocurrido un error al intentar eliminar el contrato.",
      });
    }

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
