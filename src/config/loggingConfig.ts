// Logging configuration
export const loggingConfig = {
  // Enable/disable logging features
  enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING !== 'false',
  enableErrorLogging: process.env.ENABLE_ERROR_LOGGING !== 'false',
  enableDatabaseLogging: process.env.ENABLE_DB_LOGGING === 'true',
  enablePerformanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING === 'true',
  
  // Logging levels
  logLevel: process.env.LOG_LEVEL || 'info', // error, warn, info, debug
  
  // Request logging options
  logRequestBody: process.env.NODE_ENV !== 'production',
  logRequestHeaders: process.env.NODE_ENV !== 'production',
  logResponseBody: process.env.NODE_ENV !== 'production',
  
  // Error logging options
  logStackTrace: process.env.NODE_ENV !== 'production',
  logErrorDetails: process.env.NODE_ENV !== 'production',
  
  // Performance thresholds (in milliseconds)
  slowRequestThreshold: parseInt(process.env.SLOW_REQUEST_THRESHOLD || '3000'),
  verySlowRequestThreshold: parseInt(process.env.VERY_SLOW_REQUEST_THRESHOLD || '10000'),
  
  // Sensitive fields to exclude from logging
  sensitiveFields: [
    'password',
    'token',
    'authorization',
    'auth',
    'secret',
    'key',
    'private',
    'confidential'
  ],
  
  // Max log message length
  maxLogLength: parseInt(process.env.MAX_LOG_LENGTH || '10000'),
};

// Helper function to check if a field is sensitive
export const isSensitiveField = (fieldName: string): boolean => {
  return loggingConfig.sensitiveFields.some(sensitive => 
    fieldName.toLowerCase().includes(sensitive.toLowerCase())
  );
};

// Helper function to sanitize data for logging
export const sanitizeForLogging = (data: any): any => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLogging(item));
  }

  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveField(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

// Helper function to truncate long messages
export const truncateMessage = (message: string, maxLength?: number): string => {
  const limit = maxLength || loggingConfig.maxLogLength;
  
  if (message.length <= limit) {
    return message;
  }
  
  return message.substring(0, limit - 3) + '...';
};

// Environment-specific logging configuration
export const getEnvironmentConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  
  const configs = {
    development: {
      colorize: true,
      logToConsole: true,
      logToFile: false,
      detailedErrors: true,
      includeStack: true,
    },
    test: {
      colorize: false,
      logToConsole: false,
      logToFile: false,
      detailedErrors: false,
      includeStack: false,
    },
    production: {
      colorize: false,
      logToConsole: true,
      logToFile: true,
      detailedErrors: false,
      includeStack: false,
    },
  };
  
  return configs[env as keyof typeof configs] || configs.development;
};
