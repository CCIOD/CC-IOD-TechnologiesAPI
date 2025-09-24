import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";
import { azureDeleteBlob, azureUploadBlob } from "../services/azure.service";
import { getBlobName } from "../helpers/helpers";
import { logClientChange } from "../services/audit.service";
import { logError, logSuccess, logInfo, logWarning } from "../middlewares/loggingMiddleware";
import { asyncHandler } from "../middlewares/enhancedMiddlewares";

export const getAllClients = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  logInfo("📋 Retrieving all clients", { 
    requestedBy: (req as any).user?.email || 'Unknown',
    timestamp: new Date().toISOString()
  });

  try {
    const clientQuery =
      "SELECT client_id as id, contract_number, contract_folio, bracelet_type, court_name, criminal_case, defendant_name as name, placement_date, investigation_file_number, judge_name, lawyer_name, prospect_id, signer_name, status, contract, contract_date, contract_document, contract_duration, payment_day, payment_frequency, registered_at FROM CLIENTS ORDER BY contract_number DESC NULLS LAST, client_id";
    
    logInfo("🔍 Executing client query", { query: "SELECT all clients ordered by contract_number DESC" });
    const clientResult = await pool.query(clientQuery);

    if (!clientResult.rowCount) {
      logWarning("📋 No clients found in database");
      return res
        .status(404)
        .json({ 
          success: false,
          message: "No se encontró ningún cliente." 
        });
    }

    const clients = clientResult.rows;
    logInfo(`📊 Found ${clients.length} clients, enriching with contacts and observations`);

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

      // Obtener audiencias
      const hearingsResult = await pool.query({
        text: `SELECT hearing_id, hearing_date, hearing_location, attendees, notes, created_at, updated_at 
               FROM HEARINGS 
               WHERE client_id = $1 
               ORDER BY hearing_date ASC`,
        values: [client.id],
      });
      client.hearings = hearingsResult.rows;

      return client;
    });

    const enrichedClients = await Promise.all(enrichmentQueries);
    
    logSuccess("✅ Successfully retrieved and enriched all clients", {
      clientCount: enrichedClients.length,
      totalContacts: enrichedClients.reduce((acc, client) => acc + client.contact_numbers.length, 0),
      totalObservations: enrichedClients.reduce((acc, client) => acc + client.observations.length, 0),
      totalHearings: enrichedClients.reduce((acc, client) => acc + (client.hearings?.length || 0), 0)
    });

    return res.status(200).json({
      success: true,
      message: "Información de todos los clientes",
      data: enrichedClients,
    });
  } catch (error) {
    logError(error, "getAllClients");
    next(error);
  }
});

export const getClientById = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  
  logInfo("🔍 Retrieving client by ID", { 
    clientId: client_id,
    requestedBy: (req as any).user?.email || 'Unknown'
  });

  if (isNaN(client_id)) {
    logWarning("❌ Invalid client ID provided", { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: "ID de cliente inválido"
    });
  }

  try {
    const clientQuery = `
      SELECT 
        client_id as id, 
        contract_number, 
        contract_folio,
        bracelet_type,
        court_name, 
        criminal_case, 
        defendant_name as name, 
        placement_date, 
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
        payment_day,
        payment_frequency,
        registered_at 
      FROM CLIENTS 
      WHERE client_id = $1
    `;
    
    logInfo("🔍 Executing client query by ID", { clientId: client_id });
    const clientResult = await pool.query(clientQuery, [client_id]);

    if (!clientResult.rowCount) {
      logWarning("📋 Client not found", { clientId: client_id });
      return res.status(404).json({ 
        success: false,
        message: "No se encontró el cliente especificado." 
      });
    }

    const client = clientResult.rows[0];
    logInfo("📊 Client found, retrieving contacts and observations", { clientId: client_id });

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

    // Obtener audiencias del cliente
    const hearingsResult = await pool.query({
      text: `SELECT hearing_id, hearing_date, hearing_location, attendees, notes, created_at, updated_at 
             FROM HEARINGS 
             WHERE client_id = $1 
             ORDER BY hearing_date ASC`,
      values: [client_id],
    });
    client.hearings = hearingsResult.rows;

    logSuccess("✅ Client retrieved successfully", {
      clientId: client_id,
      clientName: client.name,
      contactsCount: client.contact_numbers.length,
      observationsCount: client.observations.length,
      hearingsCount: client.hearings.length
    });

    return res.status(200).json({
      success: true,
      message: "Información del cliente",
      data: client,
    });
  } catch (error) {
    logError(error, `getClientById - clientId: ${client_id}`);
    next(error);
  }
});

export const createClient = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const {
    contract_number,
    contract_folio,
    bracelet_type,
    defendant_name,
    criminal_case,
    investigation_file_number,
    judge_name,
    court_name,
    lawyer_name,
    signer_name,
    contact_numbers,
    placement_date,
    hearings,
    contract_date,
    contract_document,
    contract_duration,
    payment_day,
    payment_frequency,
    observations,
    status,
    prospect_id,
  } = req.body;

  logInfo("👤 Creating new client", { 
    defendantName: defendant_name,
    prospectId: prospect_id,
    requestedBy: (req as any).user?.email || 'Unknown',
    contractsCount: contact_numbers?.length || 0,
    observationsCount: observations?.length || 0
  });

  try {
    const invFileOptional = investigation_file_number
      ? investigation_file_number
      : null;
    const contractDateOptional = contract_date 
      ? new Date(contract_date).toISOString().split('T')[0] 
      : null;

    logInfo("🔍 Validating prospect status", { prospectId: prospect_id });
    const prospect = await pool.query(
      "SELECT status FROM PROSPECTS WHERE prospect_id = $1",
      [prospect_id]
    );

    if (!prospect.rows.length) {
      logWarning("❌ Prospect not found", { prospectId: prospect_id });
      return res.status(404).json({
        success: false,
        message: "No se encontró el prospecto especificado.",
      });
    }

    if (prospect.rows[0].status !== "Aprobado") {
      logWarning("❌ Prospect not approved for client creation", { 
        prospectId: prospect_id, 
        currentStatus: prospect.rows[0].status 
      });
      return res.status(400).json({
        success: false,
        message: "No es posible agregar un cliente sin antes ser aprobado.",
      });
    }

    logInfo("✅ Prospect validation passed, inserting client", { prospectId: prospect_id });

    // Insertar cliente con timestamp de registro automático
    const clientQuery = {
      text: "INSERT INTO CLIENTS(contract_number, contract_folio, bracelet_type, defendant_name, criminal_case, investigation_file_number, judge_name, court_name, lawyer_name, signer_name, placement_date, contract_date, contract_document, contract_duration, payment_day, payment_frequency, status, prospect_id, registered_at) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP) RETURNING client_id",
      values: [
        contract_number || null,
        contract_folio || null,
        bracelet_type || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        placement_date ? new Date(placement_date).toISOString().split('T')[0] : null,
        contractDateOptional,
        contract_document || null,
        contract_duration || null,
        payment_day || null,
        payment_frequency || null,
        status,
        prospect_id,
      ],
    };
    const clientResult = await pool.query(clientQuery);
    const clientId = clientResult.rows[0].client_id;

    logSuccess("✅ Client created successfully", { 
      clientId: clientId,
      defendantName: defendant_name 
    });

    // Insertar contactos
    if (contact_numbers && Array.isArray(contact_numbers) && contact_numbers.length > 0) {
      logInfo("📞 Inserting client contacts", { 
        clientId: clientId,
        contactsCount: contact_numbers.length 
      });

      const contactQueries = contact_numbers.map((contact: any) => {
        return pool.query({
          text: "INSERT INTO CLIENT_CONTACTS(client_id, contact_name, relationship_id, phone_number) VALUES($1, $2, $3, $4)",
          values: [clientId, contact.contact_name, contact.relationship_id || null, contact.phone_number],
        });
      });
      await Promise.all(contactQueries);
      
      logSuccess("✅ Client contacts inserted", { 
        clientId: clientId,
        contactsCount: contact_numbers.length 
      });
    }

    // Insertar observaciones
    if (observations && Array.isArray(observations) && observations.length > 0) {
      logInfo("📝 Inserting client observations", { 
        clientId: clientId,
        observationsCount: observations.length 
      });

      const observationQueries = observations.map((obs: any) => {
        const formattedObsDate = new Date(obs.date).toISOString().split('T')[0];
        return pool.query({
          text: "INSERT INTO CLIENT_OBSERVATIONS(client_id, observation_date, observation) VALUES($1, $2, $3)",
          values: [clientId, formattedObsDate, obs.observation],
        });
      });
      await Promise.all(observationQueries);
      
      logSuccess("✅ Client observations inserted", { 
        clientId: clientId,
        observationsCount: observations.length 
      });
    }

    // Insertar audiencias
    if (hearings && Array.isArray(hearings) && hearings.length > 0) {
      logInfo("🏛️ Inserting client hearings", { 
        clientId: clientId,
        hearingsCount: hearings.length 
      });

      const hearingQueries = hearings.map((hearing: any) => {
        const formattedHearingDate = new Date(hearing.hearing_date).toISOString().split('T')[0];
        return pool.query({
          text: "INSERT INTO HEARINGS(client_id, hearing_date, hearing_location, attendees, notes) VALUES($1, $2, $3, $4, $5)",
          values: [
            clientId, 
            formattedHearingDate, 
            hearing.hearing_location, 
            hearing.attendees || [], 
            hearing.notes || null
          ],
        });
      });
      await Promise.all(hearingQueries);
      
      logSuccess("✅ Client hearings inserted", { 
        clientId: clientId,
        hearingsCount: hearings.length 
      });
    }

    // Registrar en auditoría la creación del cliente
    if ((req as any).user) {
      logInfo("📋 Logging client creation to audit", { 
        clientId: clientId,
        userId: (req as any).user.id 
      });

      await logClientChange({
        client_id: clientId,
        user_id: (req as any).user.id,
        user_name: (req as any).user.name || (req as any).user.email,
        action_type: 'CREATE',
        new_value: `Cliente creado: ${defendant_name}`,
        ip_address: (req as any).clientIp,
        user_agent: req.headers['user-agent'],
      });
      
      // Registrar contactos si existen
      if (contact_numbers && Array.isArray(contact_numbers) && contact_numbers.length > 0) {
        await logClientChange({
          client_id: clientId,
          user_id: (req as any).user.id,
          user_name: (req as any).user.name || (req as any).user.email,
          action_type: 'CONTACT_ADD',
          new_value: `${contact_numbers.length} contacto(s) agregado(s)`,
          ip_address: (req as any).clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
      
      // Registrar observaciones si existen
      if (observations && Array.isArray(observations) && observations.length > 0) {
        await logClientChange({
          client_id: clientId,
          user_id: (req as any).user.id,
          user_name: (req as any).user.name || (req as any).user.email,
          action_type: 'OBSERVATION_ADD',
          new_value: `${observations.length} observación(es) agregada(s)`,
          ip_address: (req as any).clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
    }

    logSuccess("🎉 Client creation completed successfully", {
      clientId: clientId,
      defendantName: defendant_name,
      totalContacts: contact_numbers?.length || 0,
      totalObservations: observations?.length || 0
    });

    return res.status(201).json({
      success: true,
      message: "El cliente se ha creado correctamente",
      data: {
        id: clientId,
        contract_number,
        contract_folio,
        bracelet_type,
        defendant_name,
        criminal_case,
        investigation_file_number: invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        contact_numbers,
        placement_date: placement_date ? new Date(placement_date).toISOString().split('T')[0] : null,
        contract_date: contractDateOptional,
        contract_document,
        contract_duration,
        payment_day,
        payment_frequency,
        status,
        prospect_id,
        observations,
      },
    });
  } catch (error: any) {
    logError(error, `createClient - defendant: ${defendant_name}`);
    next(error);
  }
});

export const updateClient = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const {
    contract_number,
    contract_folio,
    bracelet_type,
    defendant_name,
    criminal_case,
    investigation_file_number,
    judge_name,
    court_name,
    lawyer_name,
    signer_name,
    contact_numbers,
    placement_date,
    hearings,
    contract_date,
    contract_document,
    contract_duration,
    payment_day,
    payment_frequency,
    observations,
    status,
    prospect_id,
  } = req.body;

  logInfo("✏️ Updating client", { 
    clientId: client_id,
    defendantName: defendant_name,
    requestedBy: (req as any).user?.email || 'Unknown'
  });

  if (isNaN(client_id)) {
    logWarning("❌ Invalid client ID for update", { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: "ID de cliente inválido"
    });
  }

  try {
    // Obtener datos actuales del cliente para comparar cambios
    logInfo("🔍 Fetching current client data", { clientId: client_id });
    const currentClientQuery = {
      text: "SELECT * FROM CLIENTS WHERE client_id = $1",
      values: [client_id],
    };
    const currentClientResult = await pool.query(currentClientQuery);
    
    if (!currentClientResult.rowCount) {
      logWarning("📋 Client not found for update", { clientId: client_id });
      return res
        .status(404)
        .json({ 
          success: false,
          message: "No se encontró ningún cliente." 
        });
    }
    
    const currentClient = currentClientResult.rows[0];
    logInfo("📊 Current client data retrieved", { 
      clientId: client_id,
      currentName: currentClient.defendant_name 
    });

    // Verificar si el cliente es portador para ajustar status
    logInfo("🔍 Checking if client is a carrier", { clientId: client_id });
    const carrierCheck = await pool.query(
      "SELECT client_id FROM CARRIERS WHERE client_id = $1",
      [client_id]
    );
    
    const newStatus = carrierCheck.rowCount
      ? status === "Pendiente de colocación" || status === "Colocado"
        ? status
        : "Pendiente de colocación"
      : status;

    if (carrierCheck.rowCount && newStatus !== status) {
      logInfo("⚠️ Status adjusted for carrier client", { 
        clientId: client_id,
        requestedStatus: status,
        adjustedStatus: newStatus 
      });
    }

    const invFileOptional = investigation_file_number
      ? investigation_file_number
      : null;
    const contractDateForUpdate = contract_date 
      ? new Date(contract_date).toISOString().split('T')[0] 
      : null;

    // Actualizar cliente
    logInfo("💾 Updating client data", { clientId: client_id });
    const clientQuery = {
      text: "UPDATE CLIENTS SET contract_number=$1, contract_folio=$2, bracelet_type=$3, defendant_name=$4, criminal_case=$5, investigation_file_number=$6, judge_name=$7, court_name=$8, lawyer_name=$9, signer_name=$10, placement_date=$11, contract_date=$12, contract_document=$13, contract_duration=$14, payment_day=$15, payment_frequency=$16, status=$17 WHERE client_id = $18 RETURNING *",
      values: [
        contract_number || null,
        contract_folio || null,
        bracelet_type || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        placement_date ? new Date(placement_date).toISOString().split('T')[0] : null,
        contractDateForUpdate,
        contract_document || null,
        contract_duration || null,
        payment_day || null,
        payment_frequency || null,
        newStatus,
        client_id,
      ],
    };
    const clientResult = await pool.query(clientQuery);

    logSuccess("✅ Client updated successfully", { 
      clientId: client_id,
      defendantName: defendant_name 
    });

    // Registrar cambios detallados en auditoría
    if ((req as any).user) {
      logInfo("📋 Logging detailed changes to audit", { 
        clientId: client_id,
        userId: (req as any).user.id 
      });

      const fieldsToCheck = [
        { name: 'contract_number', old: currentClient.contract_number, new: contract_number },
        { name: 'contract_folio', old: currentClient.contract_folio, new: contract_folio },
        { name: 'bracelet_type', old: currentClient.bracelet_type, new: bracelet_type },
        { name: 'defendant_name', old: currentClient.defendant_name, new: defendant_name },
        { name: 'criminal_case', old: currentClient.criminal_case, new: criminal_case },
        { name: 'investigation_file_number', old: currentClient.investigation_file_number, new: invFileOptional },
        { name: 'judge_name', old: currentClient.judge_name, new: judge_name },
        { name: 'court_name', old: currentClient.court_name, new: court_name },
        { name: 'lawyer_name', old: currentClient.lawyer_name, new: lawyer_name },
        { name: 'signer_name', old: currentClient.signer_name, new: signer_name },
        { name: 'placement_date', old: currentClient.placement_date?.toISOString().split('T')[0], new: placement_date ? new Date(placement_date).toISOString().split('T')[0] : null },
        { name: 'contract_date', old: currentClient.contract_date?.toISOString().split('T')[0], new: contractDateForUpdate },
        { name: 'contract_document', old: currentClient.contract_document, new: contract_document },
        { name: 'contract_duration', old: currentClient.contract_duration, new: contract_duration },
        { name: 'payment_day', old: currentClient.payment_day, new: payment_day },
        { name: 'payment_frequency', old: currentClient.payment_frequency, new: payment_frequency },
        { name: 'status', old: currentClient.status, new: newStatus },
      ];

      let changesCount = 0;
      for (const field of fieldsToCheck) {
        if (field.old !== field.new) {
          changesCount++;
          await logClientChange({
            client_id,
            user_id: (req as any).user.id,
            user_name: (req as any).user.name || (req as any).user.email,
            action_type: 'UPDATE',
            field_name: field.name,
            old_value: field.old?.toString() || null,
            new_value: field.new?.toString() || null,
            ip_address: (req as any).clientIp,
            user_agent: req.headers['user-agent'],
          });
        }
      }

      logInfo(`📝 Logged ${changesCount} field changes to audit`, { 
        clientId: client_id,
        changesCount 
      });
    }

    // Actualizar contactos
    if (contact_numbers && Array.isArray(contact_numbers)) {
      logInfo("📞 Updating client contacts", { 
        clientId: client_id,
        newContactsCount: contact_numbers.length 
      });

      // Registrar eliminación de contactos existentes
      if ((req as any).user) {
        const currentContactsResult = await pool.query({
          text: "SELECT COUNT(*) as count FROM CLIENT_CONTACTS WHERE client_id = $1",
          values: [client_id],
        });
        const currentContactsCount = parseInt(currentContactsResult.rows[0].count);
        
        if (currentContactsCount > 0) {
          await logClientChange({
            client_id,
            user_id: (req as any).user.id,
            user_name: (req as any).user.name || (req as any).user.email,
            action_type: 'CONTACT_DELETE',
            old_value: `${currentContactsCount} contacto(s) eliminado(s)`,
            ip_address: (req as any).clientIp,
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

      logSuccess("✅ Client contacts updated", { 
        clientId: client_id,
        contactsCount: contact_numbers.length 
      });

      // Registrar adición de nuevos contactos
      if ((req as any).user && contact_numbers.length > 0) {
        await logClientChange({
          client_id,
          user_id: (req as any).user.id,
          user_name: (req as any).user.name || (req as any).user.email,
          action_type: 'CONTACT_UPDATE',
          new_value: `${contact_numbers.length} contacto(s) actualizado(s)`,
          ip_address: (req as any).clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
    }

    // Actualizar observaciones
    if (observations && Array.isArray(observations)) {
      logInfo("📝 Updating client observations", { 
        clientId: client_id,
        newObservationsCount: observations.length 
      });

      // Registrar eliminación de observaciones existentes
      if ((req as any).user) {
        const currentObservationsResult = await pool.query({
          text: "SELECT COUNT(*) as count FROM CLIENT_OBSERVATIONS WHERE client_id = $1",
          values: [client_id],
        });
        const currentObservationsCount = parseInt(currentObservationsResult.rows[0].count);
        
        if (currentObservationsCount > 0) {
          await logClientChange({
            client_id,
            user_id: (req as any).user.id,
            user_name: (req as any).user.name || (req as any).user.email,
            action_type: 'OBSERVATION_DELETE',
            old_value: `${currentObservationsCount} observación(es) eliminada(s)`,
            ip_address: (req as any).clientIp,
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

      logSuccess("✅ Client observations updated", { 
        clientId: client_id,
        observationsCount: observations.length 
      });

      // Registrar adición de nuevas observaciones
      if ((req as any).user && observations.length > 0) {
        await logClientChange({
          client_id,
          user_id: (req as any).user.id,
          user_name: (req as any).user.name || (req as any).user.email,
          action_type: 'OBSERVATION_UPDATE',
          new_value: `${observations.length} observación(es) actualizada(s)`,
          ip_address: (req as any).clientIp,
          user_agent: req.headers['user-agent'],
        });
      }
    }

    // Actualizar audiencias
    if (hearings && Array.isArray(hearings)) {
      logInfo("🏛️ Updating client hearings", { 
        clientId: client_id,
        newHearingsCount: hearings.length 
      });

      // Registrar eliminación de audiencias existentes
      if ((req as any).user) {
        const currentHearingsResult = await pool.query({
          text: "SELECT COUNT(*) as count FROM HEARINGS WHERE client_id = $1",
          values: [client_id],
        });
        const currentHearingsCount = parseInt(currentHearingsResult.rows[0].count);
        
        if (currentHearingsCount > 0) {
          await logClientChange({
            client_id,
            user_id: (req as any).user.id,
            user_name: (req as any).user.name || (req as any).user.email,
            action_type: 'HEARING_DELETE',
            old_value: `${currentHearingsCount} audiencia(s) eliminada(s)`,
            ip_address: (req as any).clientIp,
            user_agent: req.headers['user-agent'],
          });
        }
      }

      // Eliminar audiencias existentes
      await pool.query({
        text: "DELETE FROM HEARINGS WHERE client_id = $1",
        values: [client_id],
      });

      // Insertar nuevas audiencias
      if (hearings.length > 0) {
        const hearingQueries = hearings.map((hearing: any) => {
          const formattedHearingDate = new Date(hearing.hearing_date).toISOString().split('T')[0];
          return pool.query({
            text: "INSERT INTO HEARINGS(client_id, hearing_date, hearing_location, attendees, notes) VALUES($1, $2, $3, $4, $5)",
            values: [
              client_id, 
              formattedHearingDate, 
              hearing.hearing_location, 
              hearing.attendees || [], 
              hearing.notes || null
            ],
          });
        });
        await Promise.all(hearingQueries);

        logSuccess("✅ Client hearings updated", { 
          clientId: client_id,
          hearingsCount: hearings.length 
        });

        // Registrar adición de nuevas audiencias
        if ((req as any).user) {
          await logClientChange({
            client_id,
            user_id: (req as any).user.id,
            user_name: (req as any).user.name || (req as any).user.email,
            action_type: 'HEARING_UPDATE',
            new_value: `${hearings.length} audiencia(s) actualizada(s)`,
            ip_address: (req as any).clientIp,
            user_agent: req.headers['user-agent'],
          });
        }
      }
    }

    logSuccess("🎉 Client update completed successfully", {
      clientId: client_id,
      defendantName: defendant_name,
      totalContacts: contact_numbers?.length || 0,
      totalObservations: observations?.length || 0,
      totalHearings: hearings?.length || 0
    });

    return res.status(200).json({
      success: true,
      message: "El cliente se ha modificado correctamente",
      data: clientResult.rows[0],
    });
  } catch (error) {
    logError(error, `updateClient - clientId: ${client_id}`);
    next(error);
  }
});

export const deleteClient = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const clientId = parseInt(req.params.id);
  
  logInfo("🗑️ Deleting client", { 
    clientId: clientId,
    requestedBy: (req as any).user?.email || 'Unknown' 
  });

  if (isNaN(clientId)) {
    logWarning("❌ Invalid client ID for deletion", { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: "ID de cliente inválido"
    });
  }

  try {
    // Obtener información del cliente antes de eliminarlo
    logInfo("🔍 Fetching client info before deletion", { clientId: clientId });
    const clientInfoQuery = {
      text: "SELECT defendant_name, contract FROM CLIENTS WHERE client_id = $1",
      values: [clientId],
    };
    const clientInfoResult = await pool.query(clientInfoQuery);
    
    if (!clientInfoResult.rowCount) {
      logWarning("📋 Client not found for deletion", { clientId: clientId });
      return res
        .status(404)
        .json({ 
          success: false,
          message: "El cliente que desea eliminar no se encuentra." 
        });
    }
    
    const clientInfo = clientInfoResult.rows[0];
    logInfo("📊 Client found, proceeding with deletion", { 
      clientId: clientId,
      clientName: clientInfo.defendant_name 
    });

    // Eliminar cliente
    const query = {
      text: "DELETE FROM CLIENTS WHERE client_id = $1 RETURNING contract",
      values: [clientId],
    };
    const result = await pool.query(query);
    
    logSuccess("✅ Client deleted from database", { 
      clientId: clientId,
      clientName: clientInfo.defendant_name 
    });
    
    // Eliminar contrato de Azure si existe
    const BDContract: string | null = result.rows[0].contract;
    if (BDContract) {
      logInfo("🗂️ Deleting contract from Azure storage", { 
        clientId: clientId,
        contractUrl: BDContract 
      });

      const contract = getBlobName(BDContract);
      const { message, success } = await azureDeleteBlob({
        blobname: contract,
        containerName: "contracts",
      });
      
      if (!success) {
        logError(`Failed to delete contract from Azure: ${message}`, 'deleteClient - Azure');
        return res.status(500).json({
          success: false,
          message: message,
        });
      }

      logSuccess("✅ Contract deleted from Azure storage", { 
        clientId: clientId,
        contractName: contract 
      });
    }

    // Registrar eliminación en auditoría
    if ((req as any).user) {
      logInfo("📋 Logging client deletion to audit", { 
        clientId: clientId,
        userId: (req as any).user.id 
      });

      await logClientChange({
        client_id: clientId,
        user_id: (req as any).user.id,
        user_name: (req as any).user.name || (req as any).user.email,
        action_type: 'DELETE',
        old_value: `Cliente eliminado: ${clientInfo.defendant_name}`,
        ip_address: (req as any).clientIp,
        user_agent: req.headers['user-agent'],
      });
    }

    logSuccess("🎉 Client deletion completed successfully", {
      clientId: clientId,
      clientName: clientInfo.defendant_name,
      hadContract: !!BDContract
    });

    return res.status(200).json({
      success: true,
      message: `El cliente ${clientId} ha sido eliminado`,
    });
  } catch (error: any) {
    logError(error, `deleteClient - clientId: ${clientId}`);
    next(error);
  }
});

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
      text: `SELECT client_id as id, contract_number, contract_folio, bracelet_type, court_name, criminal_case, 
                    defendant_name as name, placement_date, investigation_file_number, 
                    judge_name, lawyer_name, prospect_id, signer_name, status, 
                    contract, contract_date, contract_document, contract_duration, payment_day, payment_frequency 
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
