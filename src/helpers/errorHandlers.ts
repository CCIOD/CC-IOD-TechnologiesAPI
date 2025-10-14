export interface ErrorResponse {
  status: number;
  success: boolean;
  message: string;
  error?: any;
  timestamp?: string;
}

export const handleDatabaseError = (error: any): ErrorResponse => {
  const success = false;
  let message = "Ocurrió un error en el servidor. Intente de nuevo más tarde.";
  let status = 500;
  const timestamp = new Date().toISOString();

  // Enhanced error logging with more details
  console.error('🔍 Detailed Error Analysis:');
  console.error(`  - Error Type: ${error.constructor.name}`);
  console.error(`  - Error Code: ${error.code || 'N/A'}`);
  console.error(`  - Error Severity: ${error.severity || 'N/A'}`);
  console.error(`  - Error Detail: ${error.detail || 'N/A'}`);
  console.error(`  - Error Hint: ${error.hint || 'N/A'}`);
  console.error(`  - Error Position: ${error.position || 'N/A'}`);
  console.error(`  - Error Constraint: ${error.constraint || 'N/A'}`);
  console.error(`  - Error Table: ${error.table || 'N/A'}`);
  console.error(`  - Error Column: ${error.column || 'N/A'}`);
  console.error(`  - Error Schema: ${error.schema || 'N/A'}`);

  if (error?.code === "22007") {
    status = 400;
    message = "Verifique que la fecha sea correcta";
  } else if (error?.code === "23505") {
    status = 400;
    if (error.constraint.includes("electronic_bracelet")) {
      message = "El brazalete ya está registrado a otro portador.";
    } else if (error.constraint.includes("beacon")) {
      message = "El BEACON ya está registrado a otro portador.";
    } else if (error.constraint.includes("wireless_charger")) {
      message = "El cargador inalámbrico ya está registrado a otro portador.";
    } else if (error.constraint.includes("client_id")) {
      message = "El ID cliente ya ha sido registrado.";
    } else if (error.constraint.includes("contract_number")) {
      message = "El contrato ya existe en base de datos.";
    } else if (error.constraint.includes("defendant_name")) {
      message = "El nombre del imputado ya está registrado";
    } else if (error.constraint.includes("prospect_id")) {
      message = "El prospecto ya se registró como cliente.";
    } else if (error.constraint.includes("email")) {
      message = "Ya existe un usuario con este correo registrado.";
    }
  } else if (error?.code === "23503") {
    status = 400;
    if (error.constraint.includes("relationship_id")) {
      message = "Seleccione un parentesco válido.";
    } else if (error.constraint.includes("status")) {
      message = "El estado seleccionado no existe.";
    } else if (error.constraint.includes("client_id")) {
      message = "No es posible eliminar a un cliente que es portador";
    } else if (error.constraint.includes("carrier_id")) {
      message =
        "No es posible eliminar a un portador que sin eliminar su operación.";
    } else if (error.constraint.includes("prospect_id")) {
      message = "No es posible eliminar a un prospecto que es un cliente.";
    }
  } else if (error?.code === "42P01") {
    status = 500;
    message = "Error en la base de datos: Tabla no encontrada";
    console.error('❌ Database Schema Error - Table not found');
  } else if (error?.code === "42703") {
    status = 500;
    message = "Error en la base de datos: Columna no encontrada";
    console.error('❌ Database Schema Error - Column not found');
  } else if (error?.code === "08P01") {
    status = 500;
    message = "Error de conexión con la base de datos";
    console.error('❌ Database Connection Error');
  } else if (error?.code === "28000") {
    status = 500;
    message = "Error de autenticación con la base de datos";
    console.error('❌ Database Authentication Error');
  } else if (error?.code === "22001") {
    status = 400;
    message = "Datos demasiado largos para el campo especificado";
  } else if (error?.code === "23502") {
    status = 400;
    message = "Campo requerido faltante en la petición";
  }

  // Include more error details in development
  const isDevelopment = process.env.NODE_ENV !== "production";
  const errorDetails = isDevelopment ? {
    code: error.code,
    detail: error.detail,
    hint: error.hint,
    constraint: error.constraint,
    table: error.table,
    column: error.column,
    originalError: error.message,
    stack: error.stack
  } : undefined;

  return { status, success, message, error: errorDetails, timestamp };
};

import { Response } from "express";

interface ResponseParams {
  status: number;
  success: boolean;
  message: string;
  data?: any;
  error?: any;
  timestamp?: string;
}

export const sendResponse = (
  res: Response,
  { status, success, message, data, error, timestamp }: ResponseParams
): void => {
  const response: any = { success, message };
  
  if (data !== undefined) {
    response.data = data;
  }
  
  if (error !== undefined) {
    response.error = error;
  }
  
  if (timestamp) {
    response.timestamp = timestamp;
  }
  
  // Add request ID for better tracking (if available)
  if (res.locals.requestId) {
    response.requestId = res.locals.requestId;
  }
  
  res.status(status).json(response);
};

export const sendSuccess = (
  res: Response,
  message: string,
  data?: any
): void => {
  sendResponse(res, {
    status: 200,
    success: true,
    message,
    data,
  });
};
export const sendCreated = (
  res: Response,
  message: string,
  data?: any
): void => {
  sendResponse(res, {
    status: 201,
    success: true,
    message,
    data,
  });
};

export const sendError = (
  res: Response,
  status: number,
  message: string,
  error?: any
): void => {
  sendResponse(res, {
    status,
    success: false,
    message,
    data: error,
  });
};
