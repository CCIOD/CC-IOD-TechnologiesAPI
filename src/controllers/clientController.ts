import { NextFunction, Request, Response } from 'express';
import { pool } from '../database/connection';
import { azureDeleteBlob, azureUploadBlob, azureGetDownloadUrl } from '../services/azure.service';
import { getBlobName } from '../helpers/helpers';
import { logClientChange } from '../services/audit.service';
import { logError, logSuccess, logInfo, logWarning } from '../middlewares/loggingMiddleware';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { renewContract, getContractValidity } from '../services/renewal.service';

export const getAllClients = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  logInfo('📋 Retrieving all clients', {
    requestedBy: (req as any).user?.email || 'Unknown',
    timestamp: new Date().toISOString(),
  });

  try {
    const clientQuery = `
      WITH last_renewals AS (
        SELECT 
          client_id,
          renewal_date,
          renewal_duration,
          ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY renewal_date DESC) as rn
        FROM CONTRACT_RENEWALS
      )
      SELECT 
        c.client_id as id, 
        c.contract_number, 
        c.contract_folio, 
        c.court_name, 
        c.criminal_case, 
        c.defendant_name as name, 
        c.placement_date, 
        c.investigation_file_number, 
        c.judge_name, 
        c.lawyer_name, 
        c.prospect_id, 
        c.signer_name, 
        c.status, 
        c.cancellation_reason, 
        c.transfer_reason,
        c.bracelet_type, 
        c.contract, 
        c.contract_date, 
        c.contract_document, 
        c.contract_duration, 
        c.payment_day, 
        c.payment_frequency, 
        c.registered_at,
        -- Calcular días restantes
        CASE 
          WHEN lr.renewal_date IS NOT NULL THEN
            CEIL(EXTRACT(EPOCH FROM (lr.renewal_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(lr.renewal_duration, '[^0-9]', '', 'g') AS INTEGER) - CURRENT_DATE)) / 86400)
          WHEN c.placement_date IS NOT NULL THEN
            CEIL(EXTRACT(EPOCH FROM (c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) - CURRENT_DATE)) / 86400)
          ELSE
            CEIL(EXTRACT(EPOCH FROM (c.contract_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) - CURRENT_DATE)) / 86400)
        END as dias_restantes
      FROM CLIENTS c
      LEFT JOIN last_renewals lr ON c.client_id = lr.client_id AND lr.rn = 1
      ORDER BY 
        CASE 
          WHEN c.status IN ('Cancelado', 'Desinstalado') THEN 1
          ELSE 0
        END,
        c.contract_number DESC,
        CASE c.bracelet_type
          WHEN 'B1' THEN 1
          WHEN 'G2' THEN 2
          ELSE 3
        END
    `;

    logInfo('🔍 Executing client query', { query: 'SELECT all clients ordered by registered_at DESC' });
    const clientResult = await pool.query(clientQuery);

    if (!clientResult.rowCount) {
      logWarning('📋 No clients found in database');
      return res.status(404).json({
        success: false,
        message: 'No se encontró ningún cliente.',
      });
    }

    const clients = clientResult.rows;
    logInfo(`📊 Found ${clients.length} clients, enriching with contacts and observations`);

    // Obtener contactos y observaciones para cada cliente
    const enrichmentQueries = clients.map(async (client: any) => {
      // Obtener contactos
      const contactResult = await pool.query({
        text: `SELECT cc.contact_name, cc.phone_number, cc.relationship
               FROM CLIENT_CONTACTS cc  
               WHERE cc.client_id = $1`,
        values: [client.id],
      });
      client.contact_numbers = contactResult.rows;

      // Obtener observaciones
      const observationResult = await pool.query({
        text: 'SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date ASC',
        values: [client.id],
      });
      client.observations = observationResult.rows;

      return client;
    });

    const enrichedClients = await Promise.all(enrichmentQueries);

    logSuccess('✅ Successfully retrieved and enriched all clients', {
      clientCount: enrichedClients.length,
      totalContacts: enrichedClients.reduce((acc, client) => acc + client.contact_numbers.length, 0),
      totalObservations: enrichedClients.reduce((acc, client) => acc + client.observations.length, 0),
    });

    return res.status(200).json({
      success: true,
      message: 'Información de todos los clientes',
      data: enrichedClients,
    });
  } catch (error) {
    logError(error, 'getAllClients');
    next(error);
  }
});

export const getClientById = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);

  logInfo('🔍 Retrieving client by ID', {
    clientId: client_id,
    requestedBy: (req as any).user?.email || 'Unknown',
  });

  if (isNaN(client_id)) {
    logWarning('❌ Invalid client ID provided', { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    const clientQuery = `
      SELECT 
        client_id as id, 
        contract_number, 
        contract_folio, 
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
        cancellation_reason,
        transfer_reason,
        bracelet_type,
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

    logInfo('🔍 Executing client query by ID', { clientId: client_id });
    const clientResult = await pool.query(clientQuery, [client_id]);

    if (!clientResult.rowCount) {
      logWarning('📋 Client not found', { clientId: client_id });
      return res.status(404).json({
        success: false,
        message: 'No se encontró el cliente especificado.',
      });
    }

    const client = clientResult.rows[0];
    logInfo('📊 Client found, retrieving contacts and observations', { clientId: client_id });

    // Obtener contactos del cliente
    const contactResult = await pool.query({
      text: `SELECT cc.contact_name, cc.phone_number, cc.relationship
             FROM CLIENT_CONTACTS cc 
             WHERE cc.client_id = $1`,
      values: [client_id],
    });
    client.contact_numbers = contactResult.rows;

    // Obtener observaciones del cliente
    const observationResult = await pool.query({
      text: 'SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date ASC',
      values: [client_id],
    });
    client.observations = observationResult.rows;

    logSuccess('✅ Client retrieved successfully', {
      clientId: client_id,
      clientName: client.name,
      contactsCount: client.contact_numbers.length,
      observationsCount: client.observations.length,
    });

    return res.status(200).json({
      success: true,
      message: 'Información del cliente',
      data: client,
    });
  } catch (error) {
    logError(error, `getClientById - clientId: ${client_id}`);
    next(error);
  }
});

export const createClient = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const {
    contract_number,
    contract_folio,
    defendant_name,
    criminal_case,
    investigation_file_number,
    judge_name,
    court_name,
    lawyer_name,
    signer_name,
    contact_numbers,
    placement_date,
    contract_date,
    contract_document,
    contract_duration,
    payment_day,
    payment_frequency,
    bracelet_type,
    observations,
    status,
    prospect_id,
    contract_original_amount,
  } = req.body;

  logInfo('👤 Creating new client', {
    defendantName: defendant_name,
    prospectId: prospect_id,
    requestedBy: (req as any).user?.email || 'Unknown',
    contractsCount: contact_numbers?.length || 0,
    observationsCount: observations?.length || 0,
  });

  try {
    const invFileOptional = investigation_file_number ? investigation_file_number : null;
    const contractDateOptional = contract_date ? new Date(contract_date).toISOString().split('T')[0] : null;

    const placementDateOptional = placement_date && placement_date.trim() !== '' ? new Date(placement_date).toISOString().split('T')[0] : null;

    logInfo('🔍 Validating prospect status', { prospectId: prospect_id });
    const prospect = await pool.query('SELECT status FROM PROSPECTS WHERE prospect_id = $1', [prospect_id]);

    if (!prospect.rows.length) {
      logWarning('❌ Prospect not found', { prospectId: prospect_id });
      return res.status(404).json({
        success: false,
        message: 'No se encontró el prospecto especificado.',
      });
    }

    if (prospect.rows[0].status !== 'Aprobado') {
      logWarning('❌ Prospect not approved for client creation', {
        prospectId: prospect_id,
        currentStatus: prospect.rows[0].status,
      });
      return res.status(400).json({
        success: false,
        message: 'No es posible agregar un cliente sin antes ser aprobado.',
      });
    }

    logInfo('✅ Prospect validation passed, inserting client', { prospectId: prospect_id });

    // Insertar cliente con timestamp de registro automático
    const clientQuery = {
      text: 'INSERT INTO CLIENTS(contract_number, contract_folio, defendant_name, criminal_case, investigation_file_number, judge_name, court_name, lawyer_name, signer_name, placement_date, contract_date, contract_document, contract_duration, payment_day, payment_frequency, bracelet_type, status, prospect_id, contract_original_amount, registered_at) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP) RETURNING client_id',
      values: [
        contract_number || null,
        contract_folio || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        placementDateOptional,
        contractDateOptional,
        contract_document || null,
        contract_duration || null,
        payment_day || null,
        payment_frequency || null,
        bracelet_type || null,
        status,
        prospect_id,
        contract_original_amount || null,
      ],
    };
    const clientResult = await pool.query(clientQuery);
    const clientId = clientResult.rows[0].client_id;

    logSuccess('✅ Client created successfully', {
      clientId: clientId,
      defendantName: defendant_name,
    });

    // Insertar contactos
    if (contact_numbers && Array.isArray(contact_numbers) && contact_numbers.length > 0) {
      logInfo('📞 Inserting client contacts', {
        clientId: clientId,
        contactsCount: contact_numbers.length,
      });

      const contactQueries = contact_numbers.map((contact: any) => {
        return pool.query({
          text: 'INSERT INTO CLIENT_CONTACTS(client_id, contact_name, relationship, phone_number) VALUES($1, $2, $3, $4)',
          values: [clientId, contact.contact_name, contact.relationship || 'Familiar', contact.phone_number],
        });
      });
      await Promise.all(contactQueries);

      logSuccess('✅ Client contacts inserted', {
        clientId: clientId,
        contactsCount: contact_numbers.length,
      });
    }

    // Insertar observaciones
    if (observations && Array.isArray(observations) && observations.length > 0) {
      logInfo('📝 Inserting client observations', {
        clientId: clientId,
        observationsCount: observations.length,
      });

      const observationQueries = observations.map((obs: any) => {
        const formattedObsDate = new Date(obs.date).toISOString().split('T')[0];
        return pool.query({
          text: 'INSERT INTO CLIENT_OBSERVATIONS(client_id, observation_date, observation) VALUES($1, $2, $3)',
          values: [clientId, formattedObsDate, obs.observation],
        });
      });
      await Promise.all(observationQueries);

      logSuccess('✅ Client observations inserted', {
        clientId: clientId,
        observationsCount: observations.length,
      });
    }

    // Registrar en auditoría la creación del cliente
    if ((req as any).user) {
      logInfo('📋 Logging client creation to audit', {
        clientId: clientId,
        userId: (req as any).user.id,
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

    logSuccess('🎉 Client creation completed successfully', {
      clientId: clientId,
      defendantName: defendant_name,
      totalContacts: contact_numbers?.length || 0,
      totalObservations: observations?.length || 0,
    });

    return res.status(201).json({
      success: true,
      message: 'El cliente se ha creado correctamente',
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
        placement_date,
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

export const updateClient = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const {
    contract_number,
    contract_folio,
    defendant_name,
    criminal_case,
    investigation_file_number,
    judge_name,
    court_name,
    lawyer_name,
    signer_name,
    contact_numbers,
    placement_date,
    contract_date,
    contract_document,
    contract_duration,
    payment_day,
    payment_frequency,
    bracelet_type,
    observations,
    status,
    cancellation_reason,
    transfer_reason,
    prospect_id,
    contract_original_amount,
  } = req.body;

  logInfo('✏️ Updating client', {
    clientId: client_id,
    defendantName: defendant_name,
    requestedBy: (req as any).user?.email || 'Unknown',
  });

  if (isNaN(client_id)) {
    logWarning('❌ Invalid client ID for update', { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    // Obtener datos actuales del cliente para comparar cambios
    logInfo('🔍 Fetching current client data', { clientId: client_id });
    const currentClientQuery = {
      text: 'SELECT * FROM CLIENTS WHERE client_id = $1',
      values: [client_id],
    };
    const currentClientResult = await pool.query(currentClientQuery);

    if (!currentClientResult.rowCount) {
      logWarning('📋 Client not found for update', { clientId: client_id });
      return res.status(404).json({
        success: false,
        message: 'No se encontró ningún cliente.',
      });
    }

    const currentClient = currentClientResult.rows[0];
    logInfo('📊 Current client data retrieved', {
      clientId: client_id,
      currentName: currentClient.defendant_name,
    });

    // Verificar si el cliente es portador para ajustar status
    logInfo('🔍 Checking if client is a carrier', { clientId: client_id });
    const carrierCheck = await pool.query('SELECT client_id FROM CARRIERS WHERE client_id = $1', [client_id]);

    // Si es carrier y está Colocado, no permitir cambios de estado
    if (carrierCheck.rowCount && currentClient.status === 'Colocado' && status !== 'Colocado') {
      logWarning('⚠️ Cannot change status for carrier client that is Colocado', {
        clientId: client_id,
        currentStatus: currentClient.status,
        requestedStatus: status,
      });
      return res.status(400).json({
        success: false,
        message: 'No se puede cambiar el estado de un portador colocado. Debe desinstalarse desde el módulo de portadores.',
      });
    }

    // Para carriers: solo permitir Pendiente de colocación o Colocado
    const newStatus = carrierCheck.rowCount ? (status === 'Pendiente de colocación' || status === 'Colocado' ? status : 'Pendiente de colocación') : status;

    if (carrierCheck.rowCount && newStatus !== status) {
      logInfo('⚠️ Status adjusted for carrier client', {
        clientId: client_id,
        requestedStatus: status,
        adjustedStatus: newStatus,
      });
    }

    const invFileOptional = investigation_file_number ? investigation_file_number : null;
    const contractDateForUpdate = contract_date ? new Date(contract_date).toISOString().split('T')[0] : null;
    const placementDateForUpdate = placement_date && placement_date.trim() !== '' ? new Date(placement_date).toISOString().split('T')[0] : null;

    // Actualizar cliente
    logInfo('💾 Updating client data', { clientId: client_id });
    const clientQuery = {
      text: 'UPDATE CLIENTS SET contract_number=$1, contract_folio=$2, defendant_name=$3, criminal_case=$4, investigation_file_number=$5, judge_name=$6, court_name=$7, lawyer_name=$8, signer_name=$9, placement_date=$10, contract_date=$11, contract_document=$12, contract_duration=$13, payment_day=$14, payment_frequency=$15, bracelet_type=$16, status=$17, cancellation_reason=$18, transfer_reason=$19, contract_original_amount=$20 WHERE client_id = $21 RETURNING *',
      values: [
        contract_number || null,
        contract_folio || null,
        defendant_name,
        criminal_case,
        invFileOptional,
        judge_name,
        court_name,
        lawyer_name,
        signer_name,
        placementDateForUpdate,
        contractDateForUpdate,
        contract_document || null,
        contract_duration || null,
        payment_day || null,
        payment_frequency || null,
        bracelet_type || null,
        newStatus,
        cancellation_reason || null,
        transfer_reason || null,
        contract_original_amount || null,
        client_id,
      ],
    };
    const clientResult = await pool.query(clientQuery);

    logSuccess('✅ Client updated successfully', {
      clientId: client_id,
      defendantName: defendant_name,
    });

    // Registrar cambios detallados en auditoría
    if ((req as any).user) {
      logInfo('📋 Logging detailed changes to audit', {
        clientId: client_id,
        userId: (req as any).user.id,
      });

      const fieldsToCheck = [
        { name: 'contract_number', old: currentClient.contract_number, new: contract_number },
        { name: 'contract_folio', old: currentClient.contract_folio, new: contract_folio },
        { name: 'defendant_name', old: currentClient.defendant_name, new: defendant_name },
        { name: 'criminal_case', old: currentClient.criminal_case, new: criminal_case },
        { name: 'investigation_file_number', old: currentClient.investigation_file_number, new: invFileOptional },
        { name: 'judge_name', old: currentClient.judge_name, new: judge_name },
        { name: 'court_name', old: currentClient.court_name, new: court_name },
        { name: 'lawyer_name', old: currentClient.lawyer_name, new: lawyer_name },
        { name: 'signer_name', old: currentClient.signer_name, new: signer_name },
        { name: 'placement_date', old: currentClient.placement_date?.toISOString().split('T')[0], new: placementDateForUpdate },
        { name: 'contract_date', old: currentClient.contract_date?.toISOString().split('T')[0], new: contractDateForUpdate },
        { name: 'contract_document', old: currentClient.contract_document, new: contract_document },
        { name: 'contract_duration', old: currentClient.contract_duration, new: contract_duration },
        { name: 'payment_day', old: currentClient.payment_day, new: payment_day },
        { name: 'payment_frequency', old: currentClient.payment_frequency, new: payment_frequency },
        { name: 'bracelet_type', old: currentClient.bracelet_type, new: bracelet_type },
        { name: 'status', old: currentClient.status, new: newStatus },
        { name: 'cancellation_reason', old: currentClient.cancellation_reason, new: cancellation_reason },
        { name: 'transfer_reason', old: currentClient.transfer_reason, new: transfer_reason },
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
        changesCount,
      });
    }

    // Actualizar contactos
    if (contact_numbers && Array.isArray(contact_numbers)) {
      logInfo('📞 Updating client contacts', {
        clientId: client_id,
        newContactsCount: contact_numbers.length,
      });

      // Registrar eliminación de contactos existentes
      if ((req as any).user) {
        const currentContactsResult = await pool.query({
          text: 'SELECT COUNT(*) as count FROM CLIENT_CONTACTS WHERE client_id = $1',
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
        text: 'DELETE FROM CLIENT_CONTACTS WHERE client_id = $1',
        values: [client_id],
      });

      // Insertar nuevos contactos
      const contactQueries = contact_numbers.map((contact: any) => {
        return pool.query({
          text: 'INSERT INTO CLIENT_CONTACTS(client_id, contact_name, relationship, phone_number) VALUES($1, $2, $3, $4)',
          values: [client_id, contact.contact_name, contact.relationship || 'Familiar', contact.phone_number],
        });
      });
      await Promise.all(contactQueries);

      logSuccess('✅ Client contacts updated', {
        clientId: client_id,
        contactsCount: contact_numbers.length,
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
      logInfo('📝 Updating client observations', {
        clientId: client_id,
        newObservationsCount: observations.length,
      });

      // Registrar eliminación de observaciones existentes
      if ((req as any).user) {
        const currentObservationsResult = await pool.query({
          text: 'SELECT COUNT(*) as count FROM CLIENT_OBSERVATIONS WHERE client_id = $1',
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
        text: 'DELETE FROM CLIENT_OBSERVATIONS WHERE client_id = $1',
        values: [client_id],
      });

      // Insertar nuevas observaciones
      const observationQueries = observations.map((obs: any) => {
        const formattedObsDate = new Date(obs.date).toISOString().split('T')[0];
        return pool.query({
          text: 'INSERT INTO CLIENT_OBSERVATIONS(client_id, observation_date, observation) VALUES($1, $2, $3)',
          values: [client_id, formattedObsDate, obs.observation],
        });
      });
      await Promise.all(observationQueries);

      logSuccess('✅ Client observations updated', {
        clientId: client_id,
        observationsCount: observations.length,
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

    logSuccess('🎉 Client update completed successfully', {
      clientId: client_id,
      defendantName: defendant_name,
      totalContacts: contact_numbers?.length || 0,
      totalObservations: observations?.length || 0,
    });

    return res.status(200).json({
      success: true,
      message: 'El cliente se ha modificado correctamente',
      data: clientResult.rows[0],
    });
  } catch (error) {
    logError(error, `updateClient - clientId: ${client_id}`);
    next(error);
  }
});

export const deleteClient = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const clientId = parseInt(req.params.id);

  logInfo('🗑️ Deleting client', {
    clientId: clientId,
    requestedBy: (req as any).user?.email || 'Unknown',
  });

  if (isNaN(clientId)) {
    logWarning('❌ Invalid client ID for deletion', { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    // Obtener información del cliente antes de eliminarlo
    logInfo('🔍 Fetching client info before deletion', { clientId: clientId });
    const clientInfoQuery = {
      text: 'SELECT defendant_name, contract FROM CLIENTS WHERE client_id = $1',
      values: [clientId],
    };
    const clientInfoResult = await pool.query(clientInfoQuery);

    if (!clientInfoResult.rowCount) {
      logWarning('📋 Client not found for deletion', { clientId: clientId });
      return res.status(404).json({
        success: false,
        message: 'El cliente que desea eliminar no se encuentra.',
      });
    }

    const clientInfo = clientInfoResult.rows[0];
    logInfo('📊 Client found, proceeding with deletion', {
      clientId: clientId,
      clientName: clientInfo.defendant_name,
    });

    // Eliminar cliente
    const query = {
      text: 'DELETE FROM CLIENTS WHERE client_id = $1 RETURNING contract',
      values: [clientId],
    };
    const result = await pool.query(query);

    logSuccess('✅ Client deleted from database', {
      clientId: clientId,
      clientName: clientInfo.defendant_name,
    });

    // Eliminar contrato de Azure si existe
    const BDContract: string | null = result.rows[0].contract;
    if (BDContract) {
      logInfo('🗂️ Deleting contract from Azure storage', {
        clientId: clientId,
        contractUrl: BDContract,
      });

      const contract = getBlobName(BDContract);
      const { message, success } = await azureDeleteBlob({
        blobname: contract,
        containerName: 'contracts',
      });

      if (!success) {
        logError(`Failed to delete contract from Azure: ${message}`, 'deleteClient - Azure');
        return res.status(500).json({
          success: false,
          message: message,
        });
      }

      logSuccess('✅ Contract deleted from Azure storage', {
        clientId: clientId,
        contractName: contract,
      });
    }

    // Registrar eliminación en auditoría
    if ((req as any).user) {
      logInfo('📋 Logging client deletion to audit', {
        clientId: clientId,
        userId: (req as any).user.id,
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

    logSuccess('🎉 Client deletion completed successfully', {
      clientId: clientId,
      clientName: clientInfo.defendant_name,
      hadContract: !!BDContract,
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

export const getApprovedClientsWithoutCarrier = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const query = {
      text: "SELECT client_id as id, defendant_name as name FROM CLIENTS WHERE (status = 'Pendiente de colocación' OR status = 'Colocado')  AND client_id NOT IN (SELECT client_id FROM CARRIERS)",
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res.status(404).json({
        message: 'No se encontró ningún cliente que pueda ser portador',
      });
    return res.status(201).json({
      success: true,
      message: 'Prospectos con estado Pendiente de colocación o Colocado',
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadContract = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Parece que no hay ningún cambio que hacer.',
      });
    }
    const file = req.file;
    const { message, success } = await azureUploadBlob({
      blob: file,
      containerName: 'contracts',
    });
    if (!success)
      return res.status(500).json({
        success: false,
        message: message,
      });
    const contract = message;
    const query = {
      text: 'UPDATE CLIENTS SET contract = $1 WHERE client_id = $2 RETURNING contract',
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
      message: 'El contrato se ha subido.',
      data: { contract: result.rows[0].contract },
    });
  } catch (error: any) {
    next(error);
  }
};

export const deleteContract = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { filename } = req.body;
  try {
    const { message, success } = await azureDeleteBlob({
      blobname: filename,
      containerName: 'contracts',
    });
    if (!success)
      return res.status(500).json({
        success: false,
        message: message,
      });

    const query = {
      text: 'UPDATE CLIENTS SET contract = $1 WHERE client_id = $2',
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
      message: 'El cliente se ha modificado correctamente',
    });
  } catch (error: any) {
    next(error);
  }
};

export const uninstallClient = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { uninstall_reason, uninstall_date } = req.body;

  try {
    // Verificar que el cliente existe y está en estado "Colocado"
    const clientQuery = {
      text: 'SELECT client_id, defendant_name, status FROM CLIENTS WHERE client_id = $1',
      values: [client_id],
    };
    const clientResult = await pool.query(clientQuery);

    if (!clientResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'No se encontró ningún cliente con el ID especificado',
      });
    }

    const client = clientResult.rows[0];
    if (client.status !== 'Colocado') {
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
      text: 'INSERT INTO CLIENT_OBSERVATIONS (client_id, observation_date, observation) VALUES ($1, $2, $3)',
      values: [client_id, uninstall_date || new Date().toISOString(), `DESINSTALACIÓN - ${uninstall_reason || 'Sin motivo especificado'}`],
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
                    defendant_name as name, placement_date, investigation_file_number, 
                    judge_name, lawyer_name, prospect_id, signer_name, status, cancellation_reason,
                    bracelet_type, contract, contract_date, contract_document, contract_duration, payment_day 
             FROM CLIENTS WHERE client_id = $1`,
      values: [client_id],
    };
    const enrichedResult = await pool.query(enrichedClientQuery);
    const clientData = enrichedResult.rows[0];

    // Obtener contactos
    const contactResult = await pool.query({
      text: `SELECT cc.contact_name, cc.phone_number, cc.relationship
             FROM CLIENT_CONTACTS cc 
             WHERE cc.client_id = $1`,
      values: [client_id],
    });
    clientData.contact_numbers = contactResult.rows;

    // Obtener observaciones
    const observationResult = await pool.query({
      text: 'SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date ASC',
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
          detail: 'El campo status puede tener una restricción que no incluye "Desinstalado"',
        },
      });
    }

    next(error);
  }
};

/**
 * ============================================================================
 * NUEVOS ENDPOINTS - VIGENCIA DE CONTRATO Y RENOVACIONES
 * ============================================================================
 */

/**
 * PUT /clientes/:id/renovar-contrato
 *
 * Renueva el contrato de un cliente agregando meses adicionales
 *
 * Flujo:
 * 1. Calcula la fecha de vencimiento actual
 * 2. Suma los meses nuevos
 * 3. Registra la renovación en la tabla CONTRACT_RENEWALS
 * 4. Actualiza los campos del cliente (months_contracted, contract_expiration_date)
 * 5. Retorna la nueva vigencia
 *
 * Payload esperado:
 * {
 *   "months_new": 6,
 *   "renewal_document_url": "https://storage.azure.com/...",
 *   "renewal_date": "2025-10-28",
 *   "renewal_amount": 15000,      // Opcional: Monto de la renovación
 *   "payment_frequency": "Mensual" // Opcional: Frecuencia de pago
 * }
 *
 * Respuesta esperada (200):
 * {
 *   "success": true,
 *   "message": "Contrato renovado correctamente",
 *   "data": {
 *     "client_id": 123,
 *     "new_expiration_date": "2026-10-28",
 *     "total_months_contracted": 18,
 *     "days_remaining": 365,
 *     "previous_expiration_date": "2026-04-28",
 *     "renewal_date": "2025-10-28",
 *     "months_added": 6
 *   }
 * }
 */
export const renewContractEndpoint = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const clientId = parseInt(req.params.id);

  logInfo('🔄 Renewing contract', {
    clientId,
    requestedBy: (req as any).user?.email || 'Unknown',
    monthsNew: req.body.months_new,
  });

  if (isNaN(clientId)) {
    logWarning('❌ Invalid client ID provided', { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    let renewal_document_url: string | null = null;

    // Si hay un archivo, subirlo a Azure
    if (req.file) {
      const file = req.file;
      const containerName = 'contract-renewals';
      const folderPath = `client-${clientId}`;

      logInfo('📄 Uploading renewal document to Azure', {
        clientId,
        fileName: file.originalname,
        containerName,
      });

      const uploadResult = await azureUploadBlob({
        blob: file,
        containerName: containerName,
        folderPath: folderPath,
      });

      if (!uploadResult.success) {
        logError(`Failed to upload renewal document: ${uploadResult.message}`, 'renewContractEndpoint');
        return res.status(500).json({
          success: false,
          message: `Error al subir el documento: ${uploadResult.message}`,
        });
      }

      // Sanitizar el nombre del archivo de la misma forma que Azure lo hace
      const sanitizedFileName = file.originalname
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_')
        .toLowerCase();

      renewal_document_url = `${folderPath}/${sanitizedFileName}`;
      logSuccess('✅ Renewal document uploaded to Azure', {
        clientId,
        documentUrl: renewal_document_url,
      });
    }

    const response = await renewContract({
      client_id: String(clientId),
      months_new: req.body.months_new,
      renewal_document_url: renewal_document_url || req.body.renewal_document_url,
      renewal_date: req.body.renewal_date,
      renewal_amount: req.body.renewal_amount,
      payment_frequency: req.body.payment_frequency,
    });

    logSuccess('✅ Contract renewed successfully', {
      clientId,
      newExpirationDate: response.data.new_expiration_date,
      monthsAdded: response.data.months_added,
    });

    return res.status(200).json(response);
  } catch (error) {
    logError(error, 'renewContractEndpoint');
    next(error);
  }
});

/**
 * GET /clientes/:id/vigencia
 *
 * Obtiene la información de vigencia actual del contrato
 *
 * Retorna:
 * - Fecha de colocación
 * - Fecha de vencimiento
 * - Duración original del contrato (meses)
 * - Total de meses contratados (incluye renovaciones)
 * - Días restantes
 * - Estado (activo/expirado)
 * - Información de última renovación
 *
 * Respuesta esperada (200):
 * {
 *   "success": true,
 *   "message": "Vigencia del contrato",
 *   "data": {
 *     "client_id": 123,
 *     "placement_date": "2025-01-01",
 *     "contract_date": "2025-01-01",
 *     "contract_duration": 12,
 *     "expiration_date": "2026-01-01",
 *     "months_contracted": 12,
 *     "days_remaining": 128,
 *     "is_active": true,
 *     "last_renewal": {
 *       "renewal_date": "2025-10-01",
 *       "months_added": 6
 *     }
 *   }
 * }
 */
export const getContractValidityEndpoint = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const clientId = parseInt(req.params.id);

  logInfo('📅 Getting contract validity', {
    clientId,
    requestedBy: (req as any).user?.email || 'Unknown',
  });

  if (isNaN(clientId)) {
    logWarning('❌ Invalid client ID provided', { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    const validity = await getContractValidity(clientId);

    logSuccess('✅ Contract validity retrieved', {
      clientId,
      daysRemaining: validity.days_remaining,
      isActive: validity.is_active,
    });

    // Obtener información del contrato original con su plan de pago
    const originalContractQuery = `
      SELECT 
        c.client_id,
        c.contract_number as "numeroContrato",
        c.contract_date as "fechaContrato",
        c.contract_duration as "duracionContrato",
        c.contract_original_amount as "montoOriginal",
        c.placement_date as "fechaColocacion",
        p.payment_frequency as "frecuenciaPago",
        p.plan_id as "planId",
        p.contract_amount as "montoContrato",
        p.total_scheduled_amount as "montoProgramado",
        p.total_paid_amount as "montoPagado",
        p.total_pending_amount as "montoPendiente",
        p.status as "estadoPlan"
      FROM CLIENTS c
      LEFT JOIN CONTRACT_PAYMENT_PLANS p ON c.client_id = p.client_id AND p.contract_type = 'original'
      WHERE c.client_id = $1
    `;
    const originalContractResult = await pool.query(originalContractQuery, [clientId]);

    // Obtener todas las renovaciones con sus planes de pago
    const renewalsQuery = `
      SELECT 
        r.renewal_id as id,
        r.renewal_date as "fechaRenovacion",
        r.renewal_duration as "duracionRenovacion",
        r.renewal_amount as "montoRenovacion",
        r.renewal_document as "documentoRenovacion",
        r.created_at as "fechaCreacion",
        r.updated_at as "fechaActualizacion",
        p.payment_frequency as "frecuenciaPago",
        p.plan_id as "planId",
        p.contract_amount as "montoContrato",
        p.total_scheduled_amount as "montoProgramado",
        p.total_paid_amount as "montoPagado",
        p.total_pending_amount as "montoPendiente",
        p.status as "estadoPlan"
      FROM CONTRACT_RENEWALS r
      LEFT JOIN CONTRACT_PAYMENT_PLANS p ON r.renewal_id = p.renewal_id AND p.contract_type = 'renewal'
      WHERE r.client_id = $1
      ORDER BY r.renewal_date ASC
    `;
    const renewalsResult = await pool.query(renewalsQuery, [clientId]);

    // Generar URLs de descarga para los documentos de renovación
    const renewalsWithUrls = await Promise.all(
      (renewalsResult.rows || []).map(async (renewal: any) => {
        if (renewal.documentoRenovacion) {
          logInfo('🔗 Generating download URL for renewal document', {
            clientId,
            renewalId: renewal.id,
            blobName: renewal.documentoRenovacion,
          });

          const downloadUrl = await azureGetDownloadUrl('contract-renewals', renewal.documentoRenovacion, 60);

          if (downloadUrl) {
            logSuccess('✅ Download URL generated successfully', {
              renewalId: renewal.id,
            });
          } else {
            logWarning('⚠️ Failed to generate download URL', {
              renewalId: renewal.id,
              blobName: renewal.documentoRenovacion,
            });
          }

          return {
            ...renewal,
            urlDescarga: downloadUrl,
          };
        }
        return {
          ...renewal,
          urlDescarga: null,
        };
      }),
    );

    // Convertir fechas a formato YYYY-MM-DD para consistencia
    // Pero validar primero que sean fechas válidas
    const responseData = {
      ...validity,
      placement_date:
        validity.placement_date === 'N/A'
          ? 'N/A'
          : validity.placement_date instanceof Date
            ? validity.placement_date.toISOString().split('T')[0]
            : typeof validity.placement_date === 'string'
              ? new Date(validity.placement_date).toISOString().split('T')[0]
              : 'N/A',
      contract_date:
        validity.contract_date === 'N/A'
          ? 'N/A'
          : validity.contract_date instanceof Date
            ? validity.contract_date.toISOString().split('T')[0]
            : typeof validity.contract_date === 'string'
              ? new Date(validity.contract_date).toISOString().split('T')[0]
              : 'N/A',
      expiration_date:
        validity.expiration_date === 'N/A'
          ? 'N/A'
          : validity.expiration_date instanceof Date
            ? validity.expiration_date.toISOString().split('T')[0]
            : typeof validity.expiration_date === 'string'
              ? new Date(validity.expiration_date).toISOString().split('T')[0]
              : 'N/A',
      contratoOriginal: originalContractResult.rows[0] || null,
      renovaciones: renewalsWithUrls,
      totalRenovaciones: renewalsWithUrls.length,
    };

    return res.status(200).json({
      success: true,
      message: 'Vigencia del contrato',
      data: responseData,
    });
  } catch (error) {
    logError(error, 'getContractValidityEndpoint');
    next(error);
  }
});

/**
 * PATCH /clientes/:id/renovaciones/:renewal_id
 *
 * Actualiza el documento de una renovación existente
 * Útil cuando una renovación se creó sin documento o el documento está mal
 */
export const updateRenewalDocument = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const clientId = parseInt(req.params.id);
  const renewalId = parseInt(req.params.renewal_id);

  logInfo('📄 Updating renewal document', {
    clientId,
    renewalId,
    requestedBy: (req as any).user?.email || 'Unknown',
    hasFile: !!req.file,
  });

  if (isNaN(clientId) || isNaN(renewalId)) {
    logWarning('❌ Invalid IDs provided', { clientId: req.params.id, renewalId: req.params.renewal_id });
    return res.status(400).json({
      success: false,
      message: 'ID de cliente o renovación inválido',
    });
  }

  if (!req.file) {
    logWarning('❌ No file provided for renewal document update', { clientId, renewalId });
    return res.status(400).json({
      success: false,
      message: 'Debe proporcionar un archivo para actualizar',
    });
  }

  try {
    // Verificar que la renovación existe y pertenece al cliente
    const renewalCheck = await pool.query(
      `SELECT renewal_id, client_id, renewal_document 
       FROM CONTRACT_RENEWALS 
       WHERE renewal_id = $1 AND client_id = $2`,
      [renewalId, clientId],
    );

    if (renewalCheck.rowCount === 0) {
      logWarning('📋 Renewal not found', { clientId, renewalId });
      return res.status(404).json({
        success: false,
        message: 'No se encontró la renovación especificada para este cliente',
      });
    }

    const oldDocument = renewalCheck.rows[0].renewal_document;

    // Subir el nuevo archivo a Azure
    const file = req.file;
    const containerName = 'contract-renewals';
    const folderPath = `client-${clientId}`;

    logInfo('☁️ Uploading document to Azure', {
      clientId,
      renewalId,
      fileName: file.originalname,
      fileSize: file.size,
    });

    const uploadResult = await azureUploadBlob({
      blob: file,
      containerName: containerName,
      folderPath: folderPath,
    });

    if (!uploadResult.success) {
      logError(`Failed to upload renewal document: ${uploadResult.message}`, 'updateRenewalDocument');
      return res.status(500).json({
        success: false,
        message: `Error al subir el documento: ${uploadResult.message}`,
      });
    }

    // Sanitizar el nombre del archivo de la misma forma que Azure lo hace
    const sanitizedFileName = file.originalname
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();

    const renewal_document_url = `${folderPath}/${sanitizedFileName}`;

    // Actualizar la base de datos
    const updateQuery = `
      UPDATE CONTRACT_RENEWALS 
      SET renewal_document = $1, updated_at = CURRENT_TIMESTAMP
      WHERE renewal_id = $2 AND client_id = $3
      RETURNING renewal_id, renewal_document, updated_at
    `;

    const updateResult = await pool.query(updateQuery, [renewal_document_url, renewalId, clientId]);

    logSuccess('✅ Renewal document updated successfully', {
      clientId,
      renewalId,
      documentUrl: renewal_document_url,
      oldDocument,
    });

    // Registrar en auditoría
    if ((req as any).user) {
      await logClientChange({
        client_id: clientId,
        user_id: (req as any).user.id,
        user_name: (req as any).user.name || (req as any).user.email,
        action_type: 'RENEWAL_DOCUMENT_UPDATE',
        new_value: `Documento de renovación #${renewalId} actualizado: ${file.originalname}`,
        old_value: oldDocument ? `Documento anterior: ${oldDocument}` : 'Sin documento previo',
        ip_address: (req as any).clientIp,
        user_agent: req.headers['user-agent'],
      });
    }

    // Generar URL de descarga
    const downloadUrl = await azureGetDownloadUrl('contract-renewals', renewal_document_url, 60);

    return res.status(200).json({
      success: true,
      message: 'Documento de renovación actualizado correctamente',
      data: {
        renewal_id: updateResult.rows[0].renewal_id,
        document: updateResult.rows[0].renewal_document,
        download_url: downloadUrl,
        updated_at: updateResult.rows[0].updated_at,
      },
    });
  } catch (error) {
    logError(error, 'updateRenewalDocument');
    next(error);
  }
});

export const updatePaymentObservations = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const client_id = parseInt(req.params.id);
  const { payment_observations } = req.body;

  logInfo('📝 Updating payment observations', {
    clientId: client_id,
    requestedBy: (req as any).user?.email || 'Unknown',
  });

  if (isNaN(client_id)) {
    logWarning('❌ Invalid client ID for payment observations update', { providedId: req.params.id });
    return res.status(400).json({
      success: false,
      message: 'ID de cliente inválido',
    });
  }

  try {
    // Verificar que el cliente existe
    const clientCheck = await pool.query({
      text: 'SELECT client_id, payment_observations FROM CLIENTS WHERE client_id = $1',
      values: [client_id],
    });

    if (!clientCheck.rowCount) {
      logWarning('📋 Client not found for payment observations update', { clientId: client_id });
      return res.status(404).json({
        success: false,
        message: 'No se encontró el cliente especificado.',
      });
    }

    const oldValue = clientCheck.rows[0].payment_observations;

    // Actualizar observaciones de pago
    logInfo('💾 Updating payment observations in database', { clientId: client_id });
    const updateQuery = {
      text: 'UPDATE CLIENTS SET payment_observations = $1 WHERE client_id = $2 RETURNING payment_observations',
      values: [payment_observations || null, client_id],
    };
    const result = await pool.query(updateQuery);

    logSuccess('✅ Payment observations updated successfully', {
      clientId: client_id,
    });

    // Registrar cambio en auditoría
    if ((req as any).user) {
      await logClientChange({
        client_id,
        user_id: (req as any).user.id,
        user_name: (req as any).user.name || (req as any).user.email,
        action_type: 'UPDATE',
        field_name: 'payment_observations',
        old_value: oldValue,
        new_value: payment_observations || null,
        ip_address: (req as any).clientIp,
        user_agent: req.headers['user-agent'],
      });

      logInfo('📋 Payment observations change logged to audit', { clientId: client_id });
    }

    return res.status(200).json({
      success: true,
      message: 'Las observaciones de pago se han actualizado correctamente',
      data: {
        client_id,
        payment_observations: result.rows[0].payment_observations,
      },
    });
  } catch (error) {
    logError(error, `updatePaymentObservations - clientId: ${client_id}`);
    next(error);
  }
});
