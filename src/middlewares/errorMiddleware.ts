import { Request, Response, NextFunction } from "express";
import { handleDatabaseError, sendResponse } from "../helpers/errorHandlers";
import { logError } from "./loggingMiddleware";

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log detailed error information
  const context = `${req.method} ${req.originalUrl}`;
  logError(err, context);

  // Log additional request context for debugging
  console.error('📍 Request Context:');
  console.error(`  - IP: ${req.ip}`);
  console.error(`  - User-Agent: ${req.get('User-Agent')}`);
  console.error(`  - Headers: ${JSON.stringify(req.headers, null, 2)}`);
  
  if (req.body && Object.keys(req.body).length > 0) {
    const sanitizedBody = { ...req.body };
    delete sanitizedBody.password;
    delete sanitizedBody.token;
    console.error(`  - Body: ${JSON.stringify(sanitizedBody, null, 2)}`);
  }
  
  if (req.params && Object.keys(req.params).length > 0) {
    console.error(`  - Params: ${JSON.stringify(req.params, null, 2)}`);
  }
  
  if (req.query && Object.keys(req.query).length > 0) {
    console.error(`  - Query: ${JSON.stringify(req.query, null, 2)}`);
  }

  const errorResponse = handleDatabaseError(err);
  sendResponse(res, errorResponse);
};
