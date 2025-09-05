import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";
import { azureDeleteBlob, azureUploadBlob } from "../services/azure.service";
import { getBlobName } from "../helpers/helpers";
import { logClientChange } from "../services/audit.service";

export const getAllClients = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const clientQuery =
      "SELECT client_id as id, contract_number, court_name, criminal_case, defendant_name as name, hearing_date, investigation_file_number, judge_name, lawyer_name, prospect_id, signer_name, status, contract, contract_date, contract_document, contract_duration, payment_day FROM CLIENTS ORDER BY client_id";
    const clientResult = await pool.query(clientQuery);

    if (!clientResult.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún cliente." });

    const clients = clientResult.rows;

    // Obtener contactos y observaciones para cada cliente
    const enrichmentQueries = clients.map(async (client: any) => {
      // Obtener contactos
      const contactResult = await pool.query({
        text: `SELECT cc.contact_name, cc.phone_number, cc.relationship_id, r.name as relationship_name 
               FROM CLIENT_CONTACTS cc 
               LEFT JOIN RELATIONSHIPS r ON cc.relationship_id = r.relationship_id 
               WHERE cc.client_id = $1`,
        values: [client.id],
      });
      client.contact_numbers = contactResult.rows;

      // Obtener observaciones
      const observationResult = await pool.query({
        text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1",
        values: [client.id],
      });
      client.observations = observationResult.rows;

      return client;
    });

    const enrichedClients = await Promise.all(enrichmentQueries);

    return res.status(201).json({
      success: true,
      message: "Información de todos los clientes",
      data: enrichedClients,
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
    const clientQuery = `
      SELECT 
        client_id as id, 
        contract_number, 
        court_name, 
        criminal_case, 
        defendant_name as name, 
        hearing_date, 
        investigation_file_number, 
        judge_name, 
        lawyer_name, 
        prospect_id, 
        signer_name, 
        status, 
        contract, 
        contract_date, 
        contract_document, 
        contract_duration, 
        payment_day 
      FROM CLIENTS 
      WHERE client_id = $1
    `;
    
    const clientResult = await pool.query(clientQuery, [client_id]);

    if (!clientResult.rowCount) {
      return res.status(404).json({ 
        success: false,
        message: "No se encontró el cliente especificado." 
      });
    }

    const client = clientResult.rows[0];

    // Obtener contactos del cliente
    const contactResult = await pool.query({
      text: `SELECT cc.contact_name, cc.phone_number, cc.relationship_id, r.name as relationship_name 
             FROM CLIENT_CONTACTS cc 
             LEFT JOIN RELATIONSHIPS r ON cc.relationship_id = r.relationship_id 
             WHERE cc.client_id = $1`,
      values: [client_id],
    });
    client.contact_numbers = contactResult.rows;

    // Obtener observaciones del cliente
    const observationResult = await pool.query({
      text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date DESC",
      values: [client_id],
    });
    client.observations = observationResult.rows;

    return res.status(200).json({
      success: true,
      message: "Información del cliente",
      data: client,
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
      text: "INSERT INTO CLIENTS(contract_number, defendant_name, criminal_case, investigation_file_number, judge_name, court_name, lawyer_name, signer_name, hearing_date, contract_date, contract_document, contract_duration, payment_day, status, prospect_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING client_id",
      values: [
        contract_number || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
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

    // Insertar contactos
    if (contact_numbers && Array.isArray(contact_numbers)) {
      const contactQueries = contact_numbers.map((contact: any) => {
        return pool.query({
          text: "INSERT INTO CLIENT_CONTACTS(client_id, contact_name, relationship_id, phone_number) VALUES($1, $2, $3, $4)",
          values: [clientId, contact.contact_name, contact.relationship_id || null, contact.phone_number],
        });
      });
      await Promise.all(contactQueries);
    }

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

    // Registrar en auditoría la creación del cliente
    if (req.user) {
      await logClientChange({
        client_id: clientId,
        user_id: req.user.id,
        user_name: req.user.name || req.user.email,
        action_type: 'CREATE',
        new_value: `Cliente creado: ${defendant_name}`,
        ip_address: req.clientIp,
        user_agent: req.headers['user-agent'],
      });
      
      // Registrar contactos si existen
      if (contact_numbers && Array.isArray(contact_numbers) && contact_numbers.length > 0) {
        await logClientChange({
          client_id: clientId,
          user_id: req.user.id,
          user_name: req.user.name || req.user.email,
          action_type: 'CONTACT_ADD',
          new_value: `${contact_numbers.length} contacto(s) agregado(s)`,
          ip_address: req.clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
      
      // Registrar observaciones si existen
      if (observations && Array.isArray(observations) && observations.length > 0) {
        await logClientChange({
          client_id: clientId,
          user_id: req.user.id,
          user_name: req.user.name || req.user.email,
          action_type: 'OBSERVATION_ADD',
          new_value: `${observations.length} observación(es) agregada(s)`,
          ip_address: req.clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
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
    // Obtener datos actuales del cliente para comparar cambios
    const currentClientQuery = {
      text: "SELECT * FROM CLIENTS WHERE client_id = $1",
      values: [client_id],
    };
    const currentClientResult = await pool.query(currentClientQuery);
    
    if (!currentClientResult.rowCount) {
      return res
        .status(404)
        .json({ message: "No se encontró ningún cliente." });
    }
    
    const currentClient = currentClientResult.rows[0];

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
    const contractDateForUpdate = contract_date 
      ? new Date(contract_date).toISOString().split('T')[0] 
      : null;

    // Actualizar cliente
    const clientQuery = {
      text: "UPDATE CLIENTS SET contract_number=$1, defendant_name=$2, criminal_case=$3, investigation_file_number=$4, judge_name=$5, court_name=$6, lawyer_name=$7, signer_name=$8, hearing_date=$9, contract_date=$10, contract_document=$11, contract_duration=$12, payment_day=$13, status=$14 WHERE client_id = $15 RETURNING *",
      values: [
        contract_number || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        new Date(hearing_date).toISOString().split('T')[0],
        contractDateForUpdate,
        contract_document || null,
        contract_duration || null,
        payment_day || null,
        newStatus,
        client_id,
      ],
    };
    const clientResult = await pool.query(clientQuery);

    // Registrar cambios detallados en auditoría
    if (req.user) {
      const fieldsToCheck = [
        { name: 'contract_number', old: currentClient.contract_number, new: contract_number },
        { name: 'defendant_name', old: currentClient.defendant_name, new: defendant_name },
        { name: 'criminal_case', old: currentClient.criminal_case, new: criminal_case },
        { name: 'investigation_file_number', old: currentClient.investigation_file_number, new: invFileOptional },
        { name: 'judge_name', old: currentClient.judge_name, new: judge_name },
        { name: 'court_name', old: currentClient.court_name, new: court_name },
        { name: 'lawyer_name', old: currentClient.lawyer_name, new: lawyer_name },
        { name: 'signer_name', old: currentClient.signer_name, new: signer_name },
        { name: 'hearing_date', old: currentClient.hearing_date?.toISOString().split('T')[0], new: new Date(hearing_date).toISOString().split('T')[0] },
        { name: 'contract_date', old: currentClient.contract_date?.toISOString().split('T')[0], new: contractDateForUpdate },
        { name: 'contract_document', old: currentClient.contract_document, new: contract_document },
        { name: 'contract_duration', old: currentClient.contract_duration, new: contract_duration },
        { name: 'payment_day', old: currentClient.payment_day, new: payment_day },
        { name: 'status', old: currentClient.status, new: newStatus },
      ];

      for (const field of fieldsToCheck) {
        if (field.old !== field.new) {
          await logClientChange({
            client_id,
            user_id: req.user.id,
            user_name: req.user.name || req.user.email,
            action_type: 'UPDATE',
            field_name: field.name,
            old_value: field.old?.toString() || null,
            new_value: field.new?.toString() || null,
            ip_address: req.clientIp,
            user_agent: req.headers['user-agent'],
          });
        }
      }
    }

    // Actualizar contactos
    if (contact_numbers && Array.isArray(contact_numbers)) {
      // Registrar eliminación de contactos existentes
      if (req.user) {
        const currentContactsResult = await pool.query({
          text: "SELECT COUNT(*) as count FROM CLIENT_CONTACTS WHERE client_id = $1",
          values: [client_id],
        });
        const currentContactsCount = parseInt(currentContactsResult.rows[0].count);
        
        if (currentContactsCount > 0) {
          await logClientChange({
            client_id,
            user_id: req.user.id,
            user_name: req.user.name || req.user.email,
            action_type: 'CONTACT_DELETE',
            old_value: `${currentContactsCount} contacto(s) eliminado(s)`,
            ip_address: req.clientIp,
            user_agent: req.headers['user-agent'],
          });
        }
      }

      // Eliminar contactos existentes
      await pool.query({
        text: "DELETE FROM CLIENT_CONTACTS WHERE client_id = $1",
        values: [client_id],
      });

      // Insertar nuevos contactos
      const contactQueries = contact_numbers.map((contact: any) => {
        return pool.query({
          text: "INSERT INTO CLIENT_CONTACTS(client_id, contact_name, relationship_id, phone_number) VALUES($1, $2, $3, $4)",
          values: [client_id, contact.contact_name, contact.relationship_id || null, contact.phone_number],
        });
      });
      await Promise.all(contactQueries);

      // Registrar adición de nuevos contactos
      if (req.user && contact_numbers.length > 0) {
        await logClientChange({
          client_id,
          user_id: req.user.id,
          user_name: req.user.name || req.user.email,
          action_type: 'CONTACT_UPDATE',
          new_value: `${contact_numbers.length} contacto(s) actualizado(s)`,
          ip_address: req.clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
    }

    if (observations && Array.isArray(observations)) {
      // Registrar eliminación de observaciones existentes
      if (req.user) {
        const currentObservationsResult = await pool.query({
          text: "SELECT COUNT(*) as count FROM CLIENT_OBSERVATIONS WHERE client_id = $1",
          values: [client_id],
        });
        const currentObservationsCount = parseInt(currentObservationsResult.rows[0].count);
        
        if (currentObservationsCount > 0) {
          await logClientChange({
            client_id,
            user_id: req.user.id,
            user_name: req.user.name || req.user.email,
            action_type: 'OBSERVATION_DELETE',
            old_value: `${currentObservationsCount} observación(es) eliminada(s)`,
            ip_address: req.clientIp,
            user_agent: req.headers['user-agent'],
          });
        }
      }

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

      // Registrar adición de nuevas observaciones
      if (req.user && observations.length > 0) {
        await logClientChange({
          client_id,
          user_id: req.user.id,
          user_name: req.user.name || req.user.email,
          action_type: 'OBSERVATION_UPDATE',
          new_value: `${observations.length} observación(es) actualizada(s)`,
          ip_address: req.clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
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
    // Obtener información del cliente antes de eliminarlo
    const clientInfoQuery = {
      text: "SELECT defendant_name, contract FROM CLIENTS WHERE client_id = $1",
      values: [clientId],
    };
    const clientInfoResult = await pool.query(clientInfoQuery);
    
    if (!clientInfoResult.rowCount) {
      return res
        .status(404)
        .json({ message: "El cliente que desea eliminar no se encuentra." });
    }
    
    const clientInfo = clientInfoResult.rows[0];

    const query = {
      text: "DELETE FROM CLIENTS WHERE client_id = $1 RETURNING contract",
      values: [clientId],
    };
    const result = await pool.query(query);
    
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

    // Registrar eliminación en auditoría
    if (req.user) {
      await logClientChange({
        client_id: clientId,
        user_id: req.user.id,
        user_name: req.user.name || req.user.email,
        action_type: 'DELETE',
        old_value: `Cliente eliminado: ${clientInfo.defendant_name}`,
        ip_address: req.clientIp,
        user_agent: req.headers['user-agent'],
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

    // Registrar subida de contrato en auditoría
    if (req.user) {
      await logClientChange({
        client_id,
        user_id: req.user.id,
        user_name: req.user.name || req.user.email,
        action_type: 'CONTRACT_UPLOAD',
        new_value: `Contrato subido: ${file.originalname}`,
        ip_address: req.clientIp,
        user_agent: req.headers['user-agent'],
      });
    }

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

    // Registrar eliminación de contrato en auditoría
    if (req.user) {
      await logClientChange({
        client_id,
        user_id: req.user.id,
        user_name: req.user.name || req.user.email,
        action_type: 'CONTRACT_DELETE',
        old_value: `Contrato eliminado: ${filename}`,
        ip_address: req.clientIp,
        user_agent: req.headers['user-agent'],
      });
    }

    return res.status(201).json({
      success: true,
      message: "El cliente se ha modificado correctamente",
    });
  } catch (error: any) {
    next(error);
  }
};

export const uninstallClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { uninstall_reason, uninstall_date } = req.body;
  
  try {
    // Verificar que el cliente existe y está en estado "Colocado"
    const clientQuery = {
      text: "SELECT client_id, defendant_name, status FROM CLIENTS WHERE client_id = $1",
      values: [client_id],
    };
    const clientResult = await pool.query(clientQuery);
    
    if (!clientResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "No se encontró ningún cliente con el ID especificado",
      });
    }
    
    const client = clientResult.rows[0];
    if (client.status !== "Colocado") {
      return res.status(400).json({
        success: false,
        message: "Solo se pueden desinstalar clientes que están en estado 'Colocado'",
      });
    }

    // Registrar datos anteriores para auditoría
    const oldStatus = client.status;

    // Actualizar el estado del cliente a "Desinstalado"
    const updateQuery = {
      text: "UPDATE CLIENTS SET status = 'Desinstalado' WHERE client_id = $1 RETURNING *",
      values: [client_id],
    };
    const updateResult = await pool.query(updateQuery);

    // Registrar la observación de desinstalación
    const observationQuery = {
      text: "INSERT INTO CLIENT_OBSERVATIONS (client_id, observation_date, observation) VALUES ($1, $2, $3)",
      values: [
        client_id,
        uninstall_date || new Date().toISOString(),
        `DESINSTALACIÓN - ${uninstall_reason || 'Sin motivo especificado'}`
      ],
    };
    await pool.query(observationQuery);

    // Registrar el cambio en auditoría
    if (req.user) {
      await logClientChange({
        client_id,
        user_id: req.user.id,
        user_name: req.user.name || req.user.email,
        action_type: 'STATUS_CHANGE',
        field_name: 'status',
        old_value: `${oldStatus} - Motivo: ${uninstall_reason || 'Sin motivo especificado'}`,
        new_value: 'Desinstalado',
        ip_address: req.clientIp,
        user_agent: req.headers['user-agent'],
      });
    }

    // Obtener los datos actualizados del cliente con contactos y observaciones
    const enrichedClientQuery = {
      text: `SELECT client_id as id, contract_number, court_name, criminal_case, 
                    defendant_name as name, hearing_date, investigation_file_number, 
                    judge_name, lawyer_name, prospect_id, signer_name, status, 
                    contract, contract_date, contract_document, contract_duration, payment_day 
             FROM CLIENTS WHERE client_id = $1`,
      values: [client_id],
    };
    const enrichedResult = await pool.query(enrichedClientQuery);
    const clientData = enrichedResult.rows[0];

    // Obtener contactos
    const contactResult = await pool.query({
      text: `SELECT cc.contact_name, cc.phone_number, cc.relationship_id, r.name as relationship_name 
             FROM CLIENT_CONTACTS cc 
             LEFT JOIN RELATIONSHIPS r ON cc.relationship_id = r.relationship_id 
             WHERE cc.client_id = $1`,
      values: [client_id],
    });
    clientData.contact_numbers = contactResult.rows;

    // Obtener observaciones
    const observationResult = await pool.query({
      text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date DESC",
      values: [client_id],
    });
    clientData.observations = observationResult.rows;

    return res.status(200).json({
      success: true,
      message: `El cliente ${client.defendant_name} ha sido desinstalado correctamente`,
      data: clientData,
    });
  } catch (error: any) {
    console.error('Error en uninstallClient:', error);
    
    // Si es un error de PostgreSQL relacionado con enum/tipo de datos
    if (error.code === '22P02') {
      return res.status(500).json({
        success: false,
        message: 'Error de base de datos: El valor "Desinstalado" no es válido para el campo status. Contacte al administrador.',
        error: {
          code: error.code,
          detail: 'El campo status puede tener una restricción que no incluye "Desinstalado"'
        }
      });
    }
    
    next(error);
  }
};
