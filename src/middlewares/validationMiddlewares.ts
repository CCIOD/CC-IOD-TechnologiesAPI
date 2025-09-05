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
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
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
