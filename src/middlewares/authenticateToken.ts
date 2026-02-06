import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

// Usar la definición de tipos ya existente del archivo userInfo.middleware.ts
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        role: number;
        name?: string;
      };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
const UNAUTHORIZED = {
  success: false,
  message: 'No tienes acceso a este recurso',
};
export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json(UNAUTHORIZED);

    const user = decoded as JwtPayload;
    const route = req.baseUrl;

    // Solo administradores (role 1) tienen acceso a /users y /carriers
    if (user.role !== 1 && (route === '/users' || route === '/carriers')) {
      return res.status(403).json(UNAUTHORIZED);
    }

    // Administradores (role 1) y Administrativos (role 3) pueden acceder a /operations
    if (route === '/operations' && user.role !== 1 && user.role !== 3) {
      return res.status(403).json(UNAUTHORIZED);
    }

    // ✅ IMPORTANTE: Asignar la información del usuario a req.user
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    next();
  });
};
