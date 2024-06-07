import { NextFunction, Request, Response } from "express";
import { pool } from "../database/connection";
import { hashPassword } from "../services/password.service";

export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  try {
    const query =
      "SELECT user_id as id, A.name, email, A.role_id, B.name as role_name FROM USERS A INNER JOIN ROLES B ON A.role_id = B.role_id WHERE user_id != 1 ORDER BY user_id";
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún usuario." });
    return res.status(201).json({
      success: true,
      message: "Información de todos los usuarios",
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const user_id = parseInt(req.params.id);
  try {
    const query = {
      name: "get-prospect-id",
      text: "SELECT user_id as id, A.name, email, A.role_id, B.name as role_name FROM USERS A INNER JOIN ROLES B ON A.role_id = B.role_id WHERE user_id = $1",
      values: [user_id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún usuario." });
    return res.status(201).json({
      success: true,
      message: "Datos del usuario obtenidos",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const { name, email, password, role_id } = req.body;
  try {
    if (!role_id)
      return res.status(404).json({
        message: "Para crear el usuario defina su rol.",
      });
    if (parseInt(role_id) !== 2 && parseInt(role_id) !== 3)
      return res.status(404).json({
        message: "Seleccione el rol de Director o Administrativo.",
        role_id,
      });
    const hashedPassword = await hashPassword(password);
    const query = {
      text: "INSERT INTO USERS(name, email, password, role_id) VALUES($1, $2, $3, $4)",
      values: [name, email, hashedPassword, role_id],
    };
    await pool.query(query);
    return res.status(201).json({
      success: true,
      message: "El usuario se ha creado correctamente",
      data: { name, email },
    });
  } catch (error: any) {
    next(error);
  }
};

export const updateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const user_id = parseInt(req.params.id);
  const { name, email, role_id } = req.body;
  try {
    // const hashedPassword = await hashPassword(password);
    const query = {
      text: "UPDATE USERS SET name=$1, email=$2, role_id=$3 WHERE user_id = $4",
      values: [name, email, role_id, user_id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún usuario." });
    return res.status(201).json({
      success: true,
      message: "El usuario se ha modificado correctamente",
      data: { name, email },
    });
  } catch (error: any) {
    next(error);
  }
};
export const updateAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const admin_id = parseInt(req.params.id);
  const { name } = req.body;
  try {
    const id = admin_id === 1 ? admin_id : 1;
    const query = {
      text: "UPDATE USERS SET name=$1 WHERE user_id = $2",
      values: [name, id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún administrador." });
    return res.status(201).json({
      success: true,
      message: "El administrador se ha modificado correctamente",
      data: { name },
    });
  } catch (error: any) {
    next(error);
  }
};
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const user_id = parseInt(req.params.id);
  const { password } = req.body;

  try {
    const hashedPassword = await hashPassword(password);
    const query = {
      text: "UPDATE USERS SET password=$1 WHERE user_id = $2",
      values: [hashedPassword, user_id],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res
        .status(404)
        .json({ message: "No se encontró ningún usuario." });
    return res.status(201).json({
      success: true,
      message: "La contraseña se ha modificado.",
    });
  } catch (error: any) {
    next(error);
  }
};
export const deleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const user_id = parseInt(req.params.id);
  try {
    const role_admin = 1;
    const query = {
      text: "DELETE FROM USERS WHERE user_id = $1 AND role_id != $2",
      values: [user_id, role_admin],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res.status(404).json({
        message:
          "No se pudo eliminar el usuario. Esto puede deberse a que no existe o es un administrador.",
      });
    return res.status(201).json({
      success: true,
      message: `El usuario ${user_id} ha sido eliminado`,
    });
  } catch (error: any) {
    next(error);
  }
};
