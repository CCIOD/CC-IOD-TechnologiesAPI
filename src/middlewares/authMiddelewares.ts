import { NextFunction, Request, Response } from 'express';
import { changePassSchema, emailSchema, loginSchema, registerSchema, updateAdminSchema, updateUserSchema } from '../models/modelSchemas';
const handleRes = (res: Response, message: string) => {
  return res.status(400).json({ success: false, message });
};
export const validationsRegister = (req: Request, res: Response, next: NextFunction) => {
  const { error } = registerSchema.validate(req.body);
  if (error) return handleRes(res, error.details[0].message);
  next();
};
export const validationsUpdate = (req: Request, res: Response, next: NextFunction) => {
  const { error } = updateUserSchema.validate(req.body);
  if (error) return handleRes(res, error.details[0].message);
  next();
};
export const validationsUpdateAdmin = (req: Request, res: Response, next: NextFunction) => {
  const { error } = updateAdminSchema.validate(req.body);
  if (error) return handleRes(res, error.details[0].message);
  next();
};
export const validationEmail = (req: Request, res: Response, next: NextFunction) => {
  const { error } = emailSchema.validate(req.body);
  if (error) return handleRes(res, error.details[0].message);
  next();
};
export const validationChangePass = (req: Request, res: Response, next: NextFunction) => {
  const { error } = changePassSchema.validate(req.body);
  if (error) return handleRes(res, error.details[0].message);
  next();
};
export const validationsLogin = (req: Request, res: Response, next: NextFunction) => {
  const { error } = loginSchema.validate(req.body);
  if (error) return handleRes(res, error.details[0].message);
  next();
};
