import { NextFunction, Request, Response } from "express";
import { comparePasswords, hashPassword } from "../services/password.service";
import { pool } from "../database/connection";
import { generateToken } from "../services/auth.service";
import { IUser } from "../models/user.interface";
import jwt from "jsonwebtoken";
import { sendEmail } from "../helpers/sendEmail";
import { lowercase } from "../helpers/helpers";
import { logError, logSuccess, logInfo, logWarning } from "../middlewares/loggingMiddleware";
import { asyncHandler } from "../middlewares/enhancedMiddlewares";

const JWT_SECRET = process.env.JWT_SECRET || "default-secret";

const validateUser = async (): Promise<boolean> => {
  try {
    logInfo("Checking if admin user exists");
    const query = "SELECT 1 FROM USERS WHERE role_id = 1 LIMIT 1";
    const res = await pool.query(query);
    const hasAdmin = (res.rowCount ?? 0) > 0;
    logInfo(`Admin user exists: ${hasAdmin}`);
    return hasAdmin;
  } catch (error) {
    logError(error, "validateUser");
    throw error;
  }
};

export const register = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const { name, email, password }: IUser = req.body;
  
  logInfo("🔐 Admin registration attempt", { email: email?.toLowerCase() });
  
  try {
    const isAdmin = await validateUser();
    if (isAdmin) {
      logWarning("Registration blocked - Admin already exists");
      return res.status(400).json({ message: "Administrador ya registrado." });
    }
    
    const lowerEmail = lowercase(email);
    const role = 1;
    const hashedPassword = await hashPassword(password);
    
    logInfo("Creating new admin user", { email: lowerEmail });
    
    const query = {
      text: "INSERT INTO USERS(name, email,password, role_id) VALUES($1, $2, $3, $4)",
      values: [name, lowerEmail, hashedPassword, role],
    };
    
    await pool.query(query);
    
    logSuccess("Admin user registered successfully", { name, email: lowerEmail });

    return res.status(201).json({
      success: true,
      data: { name, email: lowerEmail },
      message: "El administrador se ha registrado correctamente",
    });
  } catch (error: any) {
    logError(error, "register");
    next(error);
  }
});

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const { email, password }: IUser = req.body;
  try {
    const lowerEmail = lowercase(email);
    const query = {
      name: "login-user",
      text: "SELECT user_id, name, email, role_id as role, password, role_id FROM USERS WHERE email = $1",
      values: [lowerEmail],
    };
    
    let result;
    try {
      result = await pool.query(query);
    } catch (dbError) {
      console.error('Error executing database query:', dbError);
      return res.status(500).json({ 
        message: "Error interno del servidor al consultar la base de datos"  
      });
    }
    
    const user = result.rows[0];
    if (!user)
      return res.status(404).json({ message: "Usuario no encontrado" });
    const passwordMatch = await comparePasswords(password, user.password);
    if (!passwordMatch)
      return res
        .status(401)
        .json({ message: "Correo y contraseña no coinciden." });
    const token = generateToken({
      id: user.user_id,
      email: user.email,
      role: user.role,
    });
    const role =
      user.role_id === 1
        ? "Administrador"
        : user.role_id === 2
        ? "Director"
        : "Administrativo";
    return res.status(201).json({
      success: true,
      data: {
        userId: user.user_id,
        name: user.name,
        email: user.email,
        role,
      },
      token,
      message: "El usuario ha iniciado sesión",
    });
  } catch (error) {
    next(error);
  }
};
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const { email }: IUser = req.body;
  try {
    const lowerEmail = lowercase(email);
    const query = {
      name: "login-user",
      text: "SELECT user_id, name, email, role_id FROM USERS WHERE email = $1",
      values: [lowerEmail],
    };
    const result = await pool.query(query);
    const user = result.rows[0];
    if (!user)
      return res
        .status(404)
        .json({ message: "No existe un usuario registrado con este correo." });
    const token = generateToken(
      { id: user.user_id, email: user.email, role: user.role_id },
      "4h"
    );
    const update = {
      text: "UPDATE USERS SET forgot_password_token = $1 WHERE email = $2",
      values: [token, lowerEmail],
    };
    const resultUpdate = await pool.query(update);
    if (!resultUpdate.rowCount) {
      return res.status(400).json({
        success: false,
        message: "Ocurrió un error al intentar guardar el token.",
      });
    }
    await sendEmail(
      lowerEmail,
      "Reestablecer contraseña CCIOD - Technologies",
      user.name,
      token
    );
    return res.status(201).json({
      success: true,
      message: "Se ha enviado un correo con las intrucciones.",
    });
  } catch (error) {
    next(error);
  }
};
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  const { password }: IUser = req.body;
  const token = req.params.token;
  try {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        res.status(404).json({
          success: false,
          message:
            "El token ha caducado o no hay un token registrado para reestablecer la contraseña. Intenté enviar un nuevo correo para generar una nueva URL.",
        });
      }
    });
    const hashedPassword = await hashPassword(password);
    const query = {
      name: "login-user",
      text: "UPDATE USERS SET password=$1, forgot_password_token=$2 WHERE forgot_password_token = $3 RETURNING email, name",
      values: [hashedPassword, null, token],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res.status(404).json({
        success: false,
        message:
          "No fue posible cambiar la contraseña. Verifique que el token se válido, recuerde que tiene un tiempo de expiración de 1 día.",
      });
    const { email, name } = result.rows[0];
    await sendEmail(email, "Contraseña Reestablecida CCIOD", name);
    return res.status(201).json({
      success: true,
      message: "La contraseña se ha modificado.",
    });
  } catch (error) {
    next(error);
  }
};
