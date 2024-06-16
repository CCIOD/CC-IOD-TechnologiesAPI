import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "default-secret";
const UNAUTHORIZED = {
  success: false,
  message: "No tienes acceso a este recurso",
};
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "No autorizado" });
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json(UNAUTHORIZED);

    const user = decoded as JwtPayload;
    const route = req.baseUrl;

    if ((user.role === 2 || user.role === 3) && route === "/users") {
      return res.status(403).json(UNAUTHORIZED);
    }
    if (user.role === 3 && (route === "/operations" || route === "/carriers")) {
      return res.status(403).json(UNAUTHORIZED);
    }

    next();
  });
};
