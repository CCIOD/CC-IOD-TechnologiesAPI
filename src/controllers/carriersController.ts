import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";

export const getAllCarriers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const query = `
      SELECT 
        carrier_id as id, 
        residence_area, 
        A.placement_date as carrier_placement_date, 
        placement_time, 
        electronic_bracelet, 
        beacon, 
        wireless_charger, 
        information_emails, 
        A.contact_numbers as carrier_contact_numbers, 
        A.house_arrest, 
        A.installer_name, 
        A.observations as carrier_observations, 
        A.client_id, 
        A.relationship,
        B.defendant_name as name,
        B.contract_number,
        B.criminal_case,
        B.investigation_file_number,
        B.judge_name,
        B.court_name,
        B.lawyer_name,
        B.signer_name,
        B.placement_date,
        B.contract_date,
        B.contract_document,
        B.contract_duration,
        B.payment_day,
        B.status as client_status,
        B.contract
      FROM CARRIERS A 
      INNER JOIN CLIENTS B ON A.client_id = B.client_id 
      ORDER BY A.placement_date DESC`;
    
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún portador." });

    // Obtener contactos y observaciones para cada cliente asociado
    const enrichedCarriers = await Promise.all(
      result.rows.map(async (carrier: any) => {
        // Obtener contactos del cliente
        const contactResult = await pool.query({
          text: `SELECT cc.contact_name, cc.phone_number, cc.relationship
                 FROM CLIENT_CONTACTS cc 
                 WHERE cc.client_id = $1`,
          values: [carrier.client_id],
        });
        carrier.client_contacts = contactResult.rows;

        // Obtener observaciones del cliente
        const observationResult = await pool.query({
          text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date DESC",
          values: [carrier.client_id],
        });
        carrier.client_observations = observationResult.rows;

        // Obtener actas del portador
        const actsResult = await pool.query({
          text: `SELECT 
                   act_id,
                   act_document_url,
                   act_title,
                   act_description,
                   uploaded_by_name,
                   upload_date,
                   file_name
                 FROM CARRIER_ACTS 
                 WHERE carrier_id = $1 
                 ORDER BY upload_date DESC`,
          values: [carrier.carrier_id || carrier.id],
        });
        carrier.carrier_acts = actsResult.rows;

        return carrier;
      })
    );

    return res.status(200).json({
      success: true,
      message: "Información de todos los portadores",
      data: enrichedCarriers,
    });
  } catch (error) {
    next(error);
  }
};

export const createCarrier = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const {
    residence_area,
    placement_date,
    placement_time,
    electronic_bracelet,
    beacon,
    wireless_charger,
    information_emails,
    contact_numbers,
    house_arrest,
    installer_name,
    observations,
    client_id,
    relationship,
  } = req.body;
  try {
    const obserOptional = observations ? observations : "";
    const emails = JSON.stringify(information_emails);
    const numbers = JSON.stringify(contact_numbers);

    const client = await pool.query(
      "SELECT status FROM CLIENTS WHERE client_id = $1",
      [client_id]
    );
    if (!client.rowCount) {
      return res.status(404).json({
        success: false,
        message: "No hay ningún cliente con el ID especificado",
      });
    }
    const cStatus = client.rows[0].status;
    if (
      cStatus === "Pendiente de aprobación" ||
      cStatus === "Pendiente de audiencia"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Para agregar un portador este debe estar como cliente en estado Pendiente de colocación o Colocado",
      });
    }
    const query = {
      text: `
        WITH inserted AS (
          INSERT INTO CARRIERS (
            residence_area, placement_date, placement_time, electronic_bracelet, 
            beacon, wireless_charger, information_emails, contact_numbers, 
            house_arrest, installer_name, observations, client_id, relationship
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
          RETURNING *
        ) 
        SELECT 
          A.carrier_id AS id, 
          A.residence_area, 
          A.placement_date, 
          A.placement_time, 
          A.electronic_bracelet, 
          A.beacon, 
          A.wireless_charger, 
          A.information_emails, 
          A.contact_numbers, 
          A.house_arrest, 
          A.installer_name, 
          A.observations, 
          A.client_id, 
          A.relationship, 
          B.defendant_name AS name,
          B.contract_number,
          B.criminal_case,
          B.investigation_file_number,
          B.judge_name,
          B.court_name,
          B.lawyer_name,
          B.signer_name,
          B.placement_date,
          B.contract_date,
          B.contract_document,
          B.contract_duration,
          B.payment_day,
          B.status as client_status,
          B.contract
        FROM inserted A 
        INNER JOIN CLIENTS B ON A.client_id = B.client_id`,
      values: [
        residence_area,
        placement_date,
        placement_time,
        electronic_bracelet,
        beacon,
        wireless_charger,
        emails,
        numbers,
        house_arrest,
        installer_name,
        obserOptional,
        client_id,
        relationship || 'Familiar',
      ],
    };
    const result = await pool.query(query);
    if (!result.rowCount) {
      return res.status(400).json({
        success: false,
        message: "No se pudo agregar el portador.",
      });
    }
    
    const carrierData = result.rows[0];
    const carrier_id = carrierData.id;

    // Si vienen observaciones del cliente en el request, reemplazarlas completamente
    if (observations && Array.isArray(observations)) {
      // Primero eliminar todas las observaciones existentes del cliente
      await pool.query({
        text: "DELETE FROM CLIENT_OBSERVATIONS WHERE client_id = $1",
        values: [client_id],
      });

      // Insertar las nuevas observaciones
      for (const obs of observations) {
        if (obs.date && obs.observation) {
          await pool.query({
            text: "INSERT INTO CLIENT_OBSERVATIONS (client_id, observation_date, observation) VALUES ($1, $2, $3)",
            values: [client_id, obs.date, obs.observation],
          });
        }
      }
    }

    // Si vienen contact_numbers del cliente, actualizarlos en CLIENT_CONTACTS
    if (contact_numbers && Array.isArray(contact_numbers)) {
      // Primero eliminar contactos existentes del cliente para evitar duplicados
      await pool.query({
        text: "DELETE FROM CLIENT_CONTACTS WHERE client_id = $1",
        values: [client_id],
      });

      // Insertar los nuevos contactos
      for (const contact of contact_numbers) {
        if (contact.contact_name && contact.phone_number) {
          await pool.query({
            text: "INSERT INTO CLIENT_CONTACTS (client_id, contact_name, phone_number, relationship) VALUES ($1, $2, $3, $4)",
            values: [
              client_id, 
              contact.contact_name, 
              contact.phone_number, 
              contact.relationship || 'Familiar'
            ],
          });
        }
      }
    }

    // Obtener contactos y observaciones del cliente
    const contactResult = await pool.query({
      text: `SELECT cc.contact_name, cc.phone_number, cc.relationship
             FROM CLIENT_CONTACTS cc 
             WHERE cc.client_id = $1`,
      values: [client_id],
    });
    carrierData.client_contacts = contactResult.rows;

    const observationResult = await pool.query({
      text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date DESC",
      values: [client_id],
    });
    carrierData.client_observations = observationResult.rows;

    // Obtener actas del portador (inicialmente vacío)
    carrierData.carrier_acts = [];

    const query2 = {
      text: "INSERT INTO OPERATIONS(carrier_id) VALUES($1)",
      values: [carrier_id],
    };
    await pool.query(query2);
    
    return res.status(201).json({
      success: true,
      message: "El portador se ha agregado correctamente",
      data: carrierData,
    });
  } catch (error: any) {
    next(error);
  }
};
export const updateCarrier = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const carrier_id = parseInt(req.params.id);
  const {
    residence_area,
    placement_date,
    placement_time,
    electronic_bracelet,
    beacon,
    wireless_charger,
    information_emails,
    contact_numbers,
    house_arrest,
    installer_name,
    observations,
    relationship,
  } = req.body;
  try {
    const obserOptional = observations ? observations : "";
    const emails = JSON.stringify(information_emails);
    const numbers = JSON.stringify(contact_numbers);

    const query = {
      text: `
        WITH updated AS (
          UPDATE CARRIERS CA SET 
            residence_area=$1, placement_date=$2, placement_time=$3, 
            electronic_bracelet=$4, beacon=$5, wireless_charger=$6, 
            information_emails=$7, contact_numbers=$8, house_arrest=$9, 
            installer_name=$10, observations=$11, relationship=$12 
          WHERE carrier_id=$13 
          RETURNING carrier_id, residence_area, placement_date, placement_time, 
                   electronic_bracelet, beacon, wireless_charger, information_emails, 
                   contact_numbers, house_arrest, installer_name, observations, 
                   relationship, client_id
        )
        SELECT 
          A.carrier_id AS id, 
          A.residence_area, 
          A.placement_date, 
          A.placement_time, 
          A.electronic_bracelet, 
          A.beacon, 
          A.wireless_charger, 
          A.information_emails, 
          A.contact_numbers, 
          A.house_arrest, 
          A.installer_name, 
          A.observations, 
          A.client_id, 
          A.relationship, 
          B.defendant_name AS name,
          B.contract_number,
          B.criminal_case,
          B.investigation_file_number,
          B.judge_name,
          B.court_name,
          B.lawyer_name,
          B.signer_name,
          B.placement_date,
          B.contract_date,
          B.contract_document,
          B.contract_duration,
          B.payment_day,
          B.status as client_status,
          B.contract
        FROM updated A 
        INNER JOIN CLIENTS B ON A.client_id = B.client_id`,
      values: [
        residence_area,
        placement_date,
        placement_time,
        electronic_bracelet,
        beacon,
        wireless_charger,
        emails,
        numbers,
        house_arrest,
        installer_name,
        obserOptional,
        relationship || 'Familiar',
        carrier_id,
      ],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún portador." });

    const carrierData = result.rows[0];

    // Si vienen observaciones del cliente en el request, reemplazarlas completamente
    if (observations && Array.isArray(observations)) {
      // Primero eliminar todas las observaciones existentes del cliente
      await pool.query({
        text: "DELETE FROM CLIENT_OBSERVATIONS WHERE client_id = $1",
        values: [carrierData.client_id],
      });

      // Insertar las nuevas observaciones
      for (const obs of observations) {
        if (obs.date && obs.observation) {
          await pool.query({
            text: "INSERT INTO CLIENT_OBSERVATIONS (client_id, observation_date, observation) VALUES ($1, $2, $3)",
            values: [carrierData.client_id, obs.date, obs.observation],
          });
        }
      }
    }

    // Si vienen contact_numbers del cliente, actualizarlos en CLIENT_CONTACTS
    if (contact_numbers && Array.isArray(contact_numbers)) {
      // Primero eliminar contactos existentes del cliente para evitar duplicados
      await pool.query({
        text: "DELETE FROM CLIENT_CONTACTS WHERE client_id = $1",
        values: [carrierData.client_id],
      });

      // Insertar los nuevos contactos
      for (const contact of contact_numbers) {
        if (contact.contact_name && contact.phone_number) {
          await pool.query({
            text: "INSERT INTO CLIENT_CONTACTS (client_id, contact_name, phone_number, relationship) VALUES ($1, $2, $3, $4)",
            values: [
              carrierData.client_id, 
              contact.contact_name, 
              contact.phone_number, 
              contact.relationship || 'Familiar'
            ],
          });
        }
      }
    }

    // Obtener contactos y observaciones del cliente
    const contactResult = await pool.query({
      text: `SELECT cc.contact_name, cc.phone_number, cc.relationship
             FROM CLIENT_CONTACTS cc 
             WHERE cc.client_id = $1`,
      values: [carrierData.client_id],
    });
    carrierData.client_contacts = contactResult.rows;

    const observationResult = await pool.query({
      text: "SELECT observation_date as date, observation FROM CLIENT_OBSERVATIONS WHERE client_id = $1 ORDER BY observation_date DESC",
      values: [carrierData.client_id],
    });
    carrierData.client_observations = observationResult.rows;

    // Obtener actas del portador
    const actsResult = await pool.query({
      text: `SELECT 
               act_id,
               act_document_url,
               act_title,
               act_description,
               uploaded_by_name,
               upload_date,
               file_name
             FROM CARRIER_ACTS 
             WHERE carrier_id = $1 
             ORDER BY upload_date DESC`,
      values: [carrier_id],
    });
    carrierData.carrier_acts = actsResult.rows;

    return res.status(201).json({
      success: true,
      message: "El portador se ha modificado correctamente",
      data: carrierData,
    });
  } catch (error: any) {
    next(error);
  }
};

export const deleteCarrier = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const carrier_id = parseInt(req.params.id);
  try {
    const query = {
      text: "DELETE FROM CARRIERS WHERE carrier_id = $1",
      values: [carrier_id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "El portador que desea eliminar no se encuentra." });
    return res.status(201).json({
      success: true,
      message: `El portador ${carrier_id} ha sido eliminado`,
    });
  } catch (error: any) {
    next(error);
  }
};
