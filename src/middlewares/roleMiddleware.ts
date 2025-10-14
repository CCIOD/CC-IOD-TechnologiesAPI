import { NextFunction, Request, Response } from "express";

/**
 * Middleware para verificar roles permitidos
 * @param allowedRoles - Array de role_ids permitidos
 */
export const checkRole = (allowedRoles: number[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user || !user.role) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Usuario no autenticado.",
      });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Acceso denegado. No tienes permisos para acceder a este recurso.",
        requiredRoles: allowedRoles,
        yourRole: user.role,
      });
    }

    next();
  };
};

/**
 * Middleware específico para el módulo de Administración/Contabilidad
 * Roles permitidos:
 * - 1: Admin (acceso total)
 * - 2: Director (acceso total a administración)
 * - 4: Contador (acceso exclusivo a administración)
 * 
 * Roles NO permitidos:
 * - 3: Administrativo (sin acceso a administración)
 */
export const checkAdministrationAccess = checkRole([1, 2, 4]);

/**
 * Middleware para verificar si es Admin
 * Solo role_id = 1
 */
export const checkAdmin = checkRole([1]);

/**
 * Middleware para verificar si es Director o Admin
 * Roles: 1 (Admin), 2 (Director)
 */
export const checkDirectorOrAdmin = checkRole([1, 2]);

/**
 * Middleware para verificar si es Administrativo, Director o Admin
 * Roles: 1 (Admin), 2 (Director), 3 (Administrativo)
 */
export const checkStaffAccess = checkRole([1, 2, 3]);

/**
 * Middleware para verificar acceso a módulos contables
 * Roles: 1 (Admin), 2 (Director), 4 (Contador)
 */
export const checkAccountingAccess = checkRole([1, 2, 4]);

