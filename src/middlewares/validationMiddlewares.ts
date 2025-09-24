import { NextFunction, Request, Response } from "express";
import {
  carrierSchema,
  clientSchema,
  prospectSchema,
  uninstallClientSchema,
  carrierActSchema,
} from "../models/modelSchemas";

const messageArrValues = (message: string): string => {
  if (message.includes("information_emails")) {
    return "Ingrese al menos un correo para información";
  }
  if (message.includes("contact_numbers")) {
    return "Debe agregar al menos un contacto con nombre y teléfono";
  }
  if (message.includes("contact_name")) {
    return "El nombre del contacto es obligatorio";
  }
  if (message.includes("phone_number")) {
    return "El número de teléfono del contacto es obligatorio";
  }
  if (message.includes("relationship_id")) {
    return "Debe especificar la relación del contacto (Familiar, Abogado, etc.)";
  }
  if (message.includes("hearings")) {
    if (message.includes("array.items")) {
      return "Una o más audiencias tienen una estructura inválida. Verifique que cada audiencia tenga hearing_date, hearing_location y attendees";
    }
    return "Las audiencias deben ser un arreglo válido";
  }
  if (message.includes("hearing_date")) {
    return "La fecha de audiencia debe ser válida (YYYY-MM-DD)";
  }
  if (message.includes("hearing_location")) {
    return "El lugar de audiencia es obligatorio";
  }
  if (message.includes("attendees")) {
    return "Los asistentes deben ser un arreglo de nombres";
  }
  if (message.includes("placement_date")) {
    return "La fecha de colocación debe ser una fecha válida o puede dejarse vacía";
  }
  if (message.includes("act_title")) {
    return "El título del acta es obligatorio";
  }
  if (message.includes("act_description")) {
    return "La descripción del acta no es válida";
  }
  if (message.includes("contract_date")) {
    return "La fecha del contrato debe ser una fecha válida o puede dejarse vacía";
  }
  // Para depuración: mostrar el mensaje original si no coincide con ningún patrón conocido
  console.log('Mensaje de validación no manejado:', message);
  return message;
};

export const validationsProspect = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { error } = prospectSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationsClient = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { error } = clientSchema.validate(req.body);
  if (error) {
    // Log para depuración
    console.log('🐛 Validation Error Details:', {
      message: error.details[0].message,
      path: error.details[0].path,
      value: error.details[0].context?.value,
      key: error.details[0].context?.key
    });
    
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ 
      success: false, 
      message,
      // Incluir detalles en desarrollo
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          originalMessage: error.details[0].message,
          path: error.details[0].path,
          value: error.details[0].context?.value
        }
      })
    });
  }
  next();
};

export const validationsCarrier = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { error } = carrierSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationUninstallClient = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { error } = uninstallClientSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationCarrierAct = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { error } = carrierActSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};
