import { Request, Response, NextFunction } from "express";
import { logError, logWarning } from "./loggingMiddleware";

// Async error handler wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Request validation middleware with better error logging
export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  // Check for common issues
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
      logWarning(`Empty request body for ${req.method} ${req.originalUrl}`);
    }
  }

  // Check for suspicious requests
  const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip'];
  suspiciousHeaders.forEach(header => {
    if (req.headers[header]) {
      logWarning(`Request from potential proxy: ${header}=${req.headers[header]}`);
    }
  });

  next();
};

// Database connection health check middleware
export const checkDatabaseHealth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // You can add a simple database ping here if needed
    // For now, just proceed
    next();
  } catch (error) {
    logError(error, 'Database Health Check');
    res.status(503).json({
      success: false,
      message: 'Service temporarily unavailable - database connection issue',
      timestamp: new Date().toISOString()
    });
  }
};

// Rate limiting simulation (basic implementation)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const basicRateLimit = (maxRequests: number = 100, windowMs: number = 15 * 60 * 1000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || 'unknown';
    const now = Date.now();
    
    const clientData = requestCounts.get(clientIp);
    
    if (!clientData || now > clientData.resetTime) {
      requestCounts.set(clientIp, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }
    
    if (clientData.count >= maxRequests) {
      logWarning(`Rate limit exceeded for IP: ${clientIp}`);
      res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later.',
        retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
      });
      return;
    }
    
    clientData.count++;
    next();
  };
};

// Request timeout middleware
export const requestTimeout = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logError(`Request timeout: ${req.method} ${req.originalUrl}`, 'Request Timeout');
        res.status(408).json({
          success: false,
          message: 'Request timeout - the server took too long to respond',
          timestamp: new Date().toISOString()
        });
      }
    }, timeoutMs);

    // Clear timeout if response is sent
    const originalSend = res.send;
    res.send = function(data) {
      clearTimeout(timeout);
      return originalSend.call(this, data);
    };

    next();
  };
};
