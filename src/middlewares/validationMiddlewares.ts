import { NextFunction, Request, Response } from 'express';
import {
  carrierSchema,
  clientSchema,
  prospectSchema,
  uninstallClientSchema,
  carrierActSchema,
  createRenewalSchema,
  updateRenewalSchema,
  createProsecutorDocSchema,
  updateProsecutorDocSchema,
  createAlertProtocolSchema,
  updateAlertProtocolSchema,
  createAlertSchema,
  updateAlertSchema,
  generateWeeklyReportSchema,
} from '../models/modelSchemas';

const messageArrValues = (message: string): string => {
  if (message.includes('information_emails')) {
    return 'Ingrese al menos un correo para información';
  }
  if (message.includes('contact_numbers')) {
    return 'Debe agregar al menos un contacto con nombre y teléfono';
  }
  if (message.includes('contact_name')) {
    return 'El nombre del contacto es obligatorio';
  }
  if (message.includes('phone_number')) {
    return 'El número de teléfono del contacto es obligatorio';
  }
  if (message.includes('relationship')) {
    return 'Debe especificar la relación del contacto (Familiar, Amigo, Abogado, etc.)';
  }
  if (message.includes('act_title')) {
    return 'El título del acta es obligatorio';
  }
  if (message.includes('act_description')) {
    return 'La descripción del acta no es válida';
  }
  if (message.includes('contract_date')) {
    return 'La fecha del contrato debe ser una fecha válida o puede dejarse vacía';
  }
  if (message.includes('transfer_reason')) {
    return 'El motivo de traspaso debe ser texto';
  }
  // Para depuración: mostrar el mensaje original si no coincide con ningún patrón conocido
  console.log('Mensaje de validación no manejado:', message);
  return message;
};

export const validationsProspect = (req: Request, res: Response, next: NextFunction) => {
  const { error } = prospectSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationsClient = (req: Request, res: Response, next: NextFunction) => {
  const { error } = clientSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationsCarrier = (req: Request, res: Response, next: NextFunction) => {
  const { error } = carrierSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationUninstallClient = (req: Request, res: Response, next: NextFunction) => {
  const { error } = uninstallClientSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationCarrierAct = (req: Request, res: Response, next: NextFunction) => {
  const { error } = carrierActSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

// Validaciones para renovaciones de contrato
export const validationCreateRenewal = (req: Request, res: Response, next: NextFunction) => {
  const { error } = createRenewalSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationUpdateRenewal = (req: Request, res: Response, next: NextFunction) => {
  const { error } = updateRenewalSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

// Validaciones para oficios de fiscalía
export const validationCreateProsecutorDoc = (req: Request, res: Response, next: NextFunction) => {
  const { error } = createProsecutorDocSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

export const validationUpdateProsecutorDoc = (req: Request, res: Response, next: NextFunction) => {
  const { error } = updateProsecutorDocSchema.validate(req.body);
  if (error) {
    const message = messageArrValues(error.details[0].message);
    return res.status(400).json({ success: false, message });
  }
  next();
};

// =============================================================================
// Alertas y plantillas
// =============================================================================

export const validationCreateAlertProtocol = (req: Request, res: Response, next: NextFunction) => {
  const { error } = createAlertProtocolSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: messageArrValues(error.details[0].message) });
  }
  next();
};

export const validationUpdateAlertProtocol = (req: Request, res: Response, next: NextFunction) => {
  const { error } = updateAlertProtocolSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: messageArrValues(error.details[0].message) });
  }
  next();
};

export const validationCreateAlert = (req: Request, res: Response, next: NextFunction) => {
  const { error } = createAlertSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: messageArrValues(error.details[0].message) });
  }
  next();
};

export const validationUpdateAlert = (req: Request, res: Response, next: NextFunction) => {
  const { error } = updateAlertSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: messageArrValues(error.details[0].message) });
  }
  next();
};

export const validationGenerateWeeklyReport = (req: Request, res: Response, next: NextFunction) => {
  const { error } = generateWeeklyReportSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: messageArrValues(error.details[0].message) });
  }
  next();
};
