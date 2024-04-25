import { Request, Response } from "express";
import { pool } from "../database/connection";

export const getAllProspects = async (req: Request, res: Response): Promise<Response> => {
  try {
    const query = 'SELECT A.*, B.name as relationship_name, C.name as status_name FROM prospects A INNER JOIN relationships B ON A.relationship_id = B.relationship_id INNER JOIN status C ON A.status_id = C.status_id';
    const result = await pool.query(query);
    if(!result.rowCount) return res.status(404).json({ message: "No se encontró ningún prospecto." });
    return res.status(201).json({
      message: 'Información de todos los prospectos',
      data: result.rows
    });
  } catch (error) {
    return res.status(500).json(
      { message: "Ha ocurrido un error en el servidor. Intente de nuevo más tarde", error }
    );
  }
 }

export const getProspectById = async (req: Request, res: Response): Promise<Response> => {
  const prospectId = parseInt(req.params.id);
  try {
    const query = {
      name: 'get-prospect-id',
      text: 'SELECT A.*, B.name as relationship_name, C.name as status_name FROM prospects A INNER JOIN relationships B ON A.relationship_id = B.relationship_id INNER JOIN status C ON A.status_id = C.status_id WHERE prospect_id = $1',
      values: [prospectId],
}
    const result = await pool.query(query);
    if(!result.rowCount) return res.status(404).json({ message: "No se encontró ningún prospecto." });
    return res.status(201).json({
      message: 'Datos del prospecto obtenidos',
      data: result.rows[0]
    });
    
  } catch (error) {
    return res.status(500).json(
      { message: "Ha ocurrido un error en el servidor. Intente de nuevo más tarde", error }
    );
  }
 }

export const createProspect = async (req: Request, res: Response): Promise<Response> => {
  const { name, email, phone, relationshipId, statusId, date, observations } = req.body;
  try {
    const optionalData = observations ? observations : "";

    const query = {
      text: 'INSERT INTO prospects(name, email, phone, date, relationship_id, status_id, observations) VALUES($1, $2, $3, $4, $5, $6, $7)',
      values: [name, email, phone, date, relationshipId, statusId, optionalData],
    }
    await pool.query(query);
    return res.status(201).json({
      message: 'El prospecto se ha creado correctamente',
      data: { name, email }
    });
  } catch (error:any) {
    if (error?.code === "22007") return res.status(400).json({ message: "Verifique que la fecha sea correcta" });
    if (error?.code === "23503" && error.constraint.includes("relationshipid")) return res.status(400).json(
      { message: "Parece que no existe el parentesco seleccionado. Seleccione una correcta" }
    );
    if (error?.code === "23503" && error.constraint.includes("status")) return res.status(400).json(
      { message: "Parece que no existe el estado seleccionado. Seleccione una correcta" }
    );
    return res.status(500).json(
      { message: "Ha ocurrido un error en el servidor. Intente de nuevo más tarde", error }
    );
  }
}
export const updateProspect = async (req: Request, res: Response): Promise<Response> => { 
  const prospectId = parseInt(req.params.id);
  const { name, email, phone, relationshipId, statusId, date, observations } = req.body;
  try {
    const optionalData = observations ? observations : "";
    const query = {
      text: 'UPDATE prospects SET name=$1, email=$2, phone=$3, date=$4, relationship_id=$5, status_id=$6, observations=$7 WHERE prospect_id = $8',
      values: [name, email, phone, date, relationshipId, statusId, optionalData, prospectId],
    }
    const result = await pool.query(query);
    if(!result.rowCount) return res.status(404).json({ message: "No se encontró ningún prospecto." });
    return res.status(201).json({
      message: 'El prospecto se ha modificado correctamente',
      data: { name,email }
    });
  } catch (error) {
    return res.status(500).json(
      { message: "Ha ocurrido un error en el servidor. Intente de nuevo más tarde", error }
    );
  }
}
export const deleteProspect = async (req: Request, res: Response) => { 
  const prospectId = parseInt(req.params.id);
  try {
    const query = {
      text: 'DELETE FROM prospects WHERE prospect_id = $1',
      values: [prospectId],
    }
    const result = await pool.query(query);
    if(!result.rowCount) return res.status(404).json({ message: "El prospecto que desea eliminar no se encuentra." });
    return res.status(201).json({
      message: `El prospecto ${prospectId} ha sido eliminado`,
    });
  } catch (error) {
    return res.status(500).json(
      { message: "Ha ocurrido un error en el servidor. Intente de nuevo más tarde", error }
    );
  }
}