import { Request, Response, NextFunction } from "express";

// Helper function to safely check if an object can be used with Object.keys()
const isSafeObject = (obj: any): obj is Record<string, any> => {
  return obj !== null && obj !== undefined && typeof obj === 'object' && !Array.isArray(obj);
};

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// HTTP Method colors
const getMethodColor = (method: string): string => {
  switch (method.toUpperCase()) {
    case "GET":
      return colors.green;
    case "POST":
      return colors.yellow;
    case "PUT":
      return colors.blue;
    case "DELETE":
      return colors.red;
    case "PATCH":
      return colors.magenta;
    default:
      return colors.cyan;
  }
};

// Status code colors
const getStatusColor = (status: number): string => {
  if (status >= 200 && status < 300) return colors.green;
  if (status >= 300 && status < 400) return colors.cyan;
  if (status >= 400 && status < 500) return colors.yellow;
  if (status >= 500) return colors.red;
  return colors.white;
};

// Format timestamp
const getTimestamp = (): string => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
};

// Logging middleware for HTTP requests
export const requestLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();
  const timestamp = getTimestamp();
  const methodColor = getMethodColor(req.method);
  
  // Log incoming request
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ` +
    `${methodColor}${req.method}${colors.reset} ` +
    `${colors.cyan}${req.originalUrl}${colors.reset} ` +
    `${colors.dim}- Started${colors.reset}`
  );

  // Log request body for POST/PUT/PATCH requests (excluding sensitive data)
  if (["POST", "PUT", "PATCH"].includes(req.method) && isSafeObject(req.body) && Object.keys(req.body).length > 0) {
    const sanitizedBody = { ...req.body };
    // Remove sensitive fields
    delete sanitizedBody.password;
    delete sanitizedBody.token;
    delete sanitizedBody.authorization;
    
    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ` +
      `${colors.blue}BODY:${colors.reset} ` +
      `${colors.dim}${JSON.stringify(sanitizedBody, null, 2)}${colors.reset}`
    );
  }

  // Log query parameters if present
  if (isSafeObject(req.query) && Object.keys(req.query).length > 0) {
    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ` +
      `${colors.magenta}QUERY:${colors.reset} ` +
      `${colors.dim}${JSON.stringify(req.query)}${colors.reset}`
    );
  }

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    const statusColor = getStatusColor(res.statusCode);
    const completedTimestamp = getTimestamp();
    
    // Log response
    console.log(
      `${colors.dim}[${completedTimestamp}]${colors.reset} ` +
      `${methodColor}${req.method}${colors.reset} ` +
      `${colors.cyan}${req.originalUrl}${colors.reset} ` +
      `${statusColor}${res.statusCode}${colors.reset} ` +
      `${colors.dim}- Completed in ${duration}ms${colors.reset}`
    );

    // Log response body for errors or when in development
    const isDevelopment = process.env.NODE_ENV !== "production";
    if (res.statusCode >= 400 || isDevelopment) {
      console.log(
        `${colors.dim}[${completedTimestamp}]${colors.reset} ` +
        `${colors.red}RESPONSE:${colors.reset} ` +
        `${colors.dim}${JSON.stringify(body, null, 2)}${colors.reset}`
      );
    }

    return originalJson.call(this, body);
  };

  next();
};

// Error logging utility
export const logError = (error: any, context?: string): void => {
  const timestamp = getTimestamp();
  const contextStr = context ? ` [${context}]` : '';
  
  console.error(
    `${colors.red}${colors.bright}[${timestamp}] ERROR${contextStr}:${colors.reset}`
  );
  
  if (error?.stack) {
    console.error(`${colors.red}${error.stack}${colors.reset}`);
  } else {
    console.error(`${colors.red}${JSON.stringify(error, null, 2)}${colors.reset}`);
  }
  
  // Log additional error details if available
  if (error?.code) {
    console.error(`${colors.yellow}Error Code:${colors.reset} ${error.code}`);
  }
  
  if (error?.constraint) {
    console.error(`${colors.yellow}Constraint:${colors.reset} ${error.constraint}`);
  }
  
  if (error?.detail) {
    console.error(`${colors.yellow}Detail:${colors.reset} ${error.detail}`);
  }
  
  if (error?.hint) {
    console.error(`${colors.yellow}Hint:${colors.reset} ${error.hint}`);
  }
  
  console.error(`${colors.dim}${'='.repeat(50)}${colors.reset}`);
};

// Success logging utility
export const logSuccess = (message: string, data?: any): void => {
  const timestamp = getTimestamp();
  
  console.log(
    `${colors.green}${colors.bright}[${timestamp}] SUCCESS:${colors.reset} ` +
    `${colors.green}${message}${colors.reset}`
  );
  
  if (data) {
    console.log(`${colors.dim}${JSON.stringify(data, null, 2)}${colors.reset}`);
  }
};

// Warning logging utility
export const logWarning = (message: string, data?: any): void => {
  const timestamp = getTimestamp();
  
  console.warn(
    `${colors.yellow}${colors.bright}[${timestamp}] WARNING:${colors.reset} ` +
    `${colors.yellow}${message}${colors.reset}`
  );
  
  if (data) {
    console.warn(`${colors.dim}${JSON.stringify(data, null, 2)}${colors.reset}`);
  }
};

// Info logging utility
export const logInfo = (message: string, data?: any): void => {
  const timestamp = getTimestamp();
  
  console.info(
    `${colors.blue}${colors.bright}[${timestamp}] INFO:${colors.reset} ` +
    `${colors.blue}${message}${colors.reset}`
  );
  
  if (data) {
    console.info(`${colors.dim}${JSON.stringify(data, null, 2)}${colors.reset}`);
  }
};
