import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";
import { lowercase } from "../helpers/helpers";

export const getAllProspects = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const prospectQuery =
      "SELECT prospect_id as id, name, email, phone, date, status, relationship FROM PROSPECTS ORDER BY prospect_id";
    const prospectResult = await pool.query(prospectQuery);

    if (!prospectResult.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún prospecto." });

    const prospects = prospectResult.rows;

    // Obtener observaciones para cada prospecto
    const observationQueries = prospects.map(async (prospect: any) => {
      const observationResult = await pool.query({
        text: "SELECT observation_date as date, observation FROM PROSPECT_OBSERVATIONS WHERE prospect_id = $1",
        values: [prospect.id],
      });
      prospect.observations = observationResult.rows;
      return prospect;
    });

    const enrichedProspects = await Promise.all(observationQueries);

    return res.status(201).json({
      success: true,
      message: "Información de todos los prospectos",
      data: enrichedProspects,
    });
  } catch (error) {
    next(error);
  }
};

export const createProspect = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const { name, email, phone, relationship, status, date, observations } =
    req.body;
  try {
    const lowerEmail = lowercase(email);

    // Insertar prospecto
    const prospectQuery = {
      text: "INSERT INTO PROSPECTS(name, email, phone, date, relationship, status) VALUES($1, $2, $3, $4, $5, $6) RETURNING prospect_id",
      values: [name, lowerEmail, phone, date, relationship || 'Familiar', status],
    };
    const prospectResult = await pool.query(prospectQuery);
    const prospectId = prospectResult.rows[0].prospect_id;

    // Insertar observaciones
    if (observations && Array.isArray(observations)) {
      const observationQueries = observations.map((obs: any) => {
        return pool.query({
          text: "INSERT INTO PROSPECT_OBSERVATIONS(prospect_id, observation_date, observation) VALUES($1, $2, $3)",
          values: [prospectId, obs.date, obs.observation],
        });
      });
      await Promise.all(observationQueries);
    }

    return res.status(201).json({
      success: true,
      message: "El prospecto se ha creado correctamente",
      data: {
        id: prospectId,
        name,
        email,
        phone,
        relationship,
        status,
        date,
        observations,
      },
    });
  } catch (error: any) {
    next(error);
  }
};
export const updateProspect = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const prospect_id = parseInt(req.params.id);
  const { name, email, phone, relationship, status, date, observations } =
    req.body;
  try {
    const lowerEmail = lowercase(email);

    // Actualizar prospecto
    const prospectQuery = {
      text: "UPDATE PROSPECTS SET name=$1, email=$2, phone=$3, date=$4, relationship=$5, status=$6 WHERE prospect_id = $7 RETURNING *",
      values: [name, lowerEmail, phone, date, relationship || 'Familiar', status, prospect_id],
    };
    const prospectResult = await pool.query(prospectQuery);

    if (!prospectResult.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún prospecto." });

    // Actualizar observaciones
    if (observations && Array.isArray(observations)) {
      // Eliminar observaciones existentes
      await pool.query({
        text: "DELETE FROM PROSPECT_OBSERVATIONS WHERE prospect_id = $1",
        values: [prospect_id],
      });

      // Insertar nuevas observaciones
      const observationQueries = observations.map((obs: any) => {
        return pool.query({
          text: "INSERT INTO PROSPECT_OBSERVATIONS(prospect_id, observation_date, observation) VALUES($1, $2, $3)",
          values: [prospect_id, obs.date, obs.observation],
        });
      });
      await Promise.all(observationQueries);
    }

    return res.status(201).json({
      success: true,
      message: "El prospecto se ha modificado correctamente",
      data: prospectResult.rows[0],
    });
  } catch (error: any) {
    next(error);
  }
};
export const deleteProspect = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const prospect_id = parseInt(req.params.id);
  try {
    const query = {
      text: "DELETE FROM PROSPECTS WHERE prospect_id = $1",
      values: [prospect_id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "El prospecto que desea eliminar no se encuentra." });
    return res.status(201).json({
      success: true,
      message: `El prospecto ${prospect_id} ha sido eliminado`,
    });
  } catch (error: any) {
    next(error);
  }
};

export const getApprovedProspectsWithoutClient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const query = {
      // name: "get-prospect-id",
      text: "SELECT prospect_id as id, name FROM PROSPECTS WHERE status = 'Aprobado' AND prospect_id NOT IN (SELECT prospect_id FROM CLIENTS)",
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res.status(404).json({
        message: "No se encontró ningún prospecto que pueda ser cliente",
      });
    return res.status(201).json({
      success: true,
      message: "Datos del prospecto aprobados",
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};
