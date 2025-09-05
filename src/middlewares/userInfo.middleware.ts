import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { pool } from "../database/connection";

// Extender la interfaz Request para incluir información del usuario
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        role: number;
        name?: string;
      };
      clientIp?: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "default-secret";

/**
 * Middleware para extraer información del usuario autenticado y almacenarla en req.user
 * También extrae la IP del cliente
 */
export const extractUserInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      
      // Obtener información completa del usuario desde la base de datos
      const userQuery = {
        text: "SELECT user_id, name, email, role_id FROM USERS WHERE user_id = $1",
        values: [decoded.id],
      };
      
      const userResult = await pool.query(userQuery);
      
      if (userResult.rows.length > 0) {
        const userData = userResult.rows[0];
        req.user = {
          id: userData.user_id,
          email: userData.email,
          role: userData.role_id,
          name: userData.name,
        };
      }
    }
    
    // Extraer IP del cliente
    req.clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                   req.headers['x-real-ip'] as string || 
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress || 
                   'unknown';
    
    next();
  } catch (error) {
    // Si hay error al extraer la información del usuario, continuamos sin ella
    // El middleware authenticateToken se encargará de la validación de autenticación
    next();
  }
};
