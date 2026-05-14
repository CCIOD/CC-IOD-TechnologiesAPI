import { NextFunction, Request, Response } from 'express';
import { comparePasswords, hashPassword } from '../services/password.service';
import { pool } from '../database/connection';
import { generateToken } from '../services/auth.service';
import { IUser } from '../models/user.interface';
import jwt from 'jsonwebtoken';
import { sendEmail } from '../helpers/sendEmail';
import { lowercase } from '../helpers/helpers';
import { logError, logSuccess, logInfo, logWarning } from '../middlewares/loggingMiddleware';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { evaluateLocationRestriction } from '../middlewares/enforceLocationRestriction';
import { logAuthEvent } from '../services/audit.service';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

const validateUser = async (): Promise<boolean> => {
  try {
    logInfo('Checking if admin user exists');
    const query = 'SELECT 1 FROM USERS WHERE role_id = 1 LIMIT 1';
    const res = await pool.query(query);
    const hasAdmin = (res.rowCount ?? 0) > 0;
    logInfo(`Admin user exists: ${hasAdmin}`);
    return hasAdmin;
  } catch (error) {
    logError(error, 'validateUser');
    throw error;
  }
};

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const { name, email, password }: IUser = req.body;

  logInfo('🔐 Admin registration attempt', { email: email?.toLowerCase() });

  try {
    const isAdmin = await validateUser();
    if (isAdmin) {
      logWarning('Registration blocked - Admin already exists');
      return res.status(400).json({ message: 'Administrador ya registrado.' });
    }

    const lowerEmail = lowercase(email);
    const role = 1;
    const hashedPassword = await hashPassword(password);

    logInfo('Creating new admin user', { email: lowerEmail });

    const query = {
      text: 'INSERT INTO USERS(name, email,password, role_id) VALUES($1, $2, $3, $4)',
      values: [name, lowerEmail, hashedPassword, role],
    };

    await pool.query(query);

    logSuccess('Admin user registered successfully', { name, email: lowerEmail });

    return res.status(201).json({
      success: true,
      data: { name, email: lowerEmail },
      message: 'El administrador se ha registrado correctamente',
    });
  } catch (error: any) {
    logError(error, 'register');
    next(error);
  }
});

export const login = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const { email, password }: IUser = req.body;
  try {
    const lowerEmail = lowercase(email);
    const query = {
      name: 'login-user',
      text: 'SELECT u.user_id, u.name, u.email, u.role_id as role, u.password, u.role_id, r.name as role_name FROM USERS u INNER JOIN ROLES r ON u.role_id = r.role_id WHERE u.email = $1',
      values: [lowerEmail],
    };

    let result;
    try {
      result = await pool.query(query);
    } catch (dbError) {
      console.error('Error executing database query:', dbError);
      return res.status(500).json({
        message: 'Error interno del servidor al consultar la base de datos',
      });
    }

    const user = result.rows[0];
    if (!user) {
      await logAuthEvent(req as any, {
        email: lowerEmail,
        method: 'password',
        outcome: 'denied_user',
        failure_reason: 'Usuario no encontrado',
      });
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    const passwordMatch = await comparePasswords(password, user.password);
    if (!passwordMatch) {
      await logAuthEvent(req as any, {
        user_id: user.user_id,
        email: lowerEmail,
        method: 'password',
        outcome: 'denied_password',
      });
      return res.status(401).json({ message: 'Correo y contraseña no coinciden.' });
    }

    const locationCheck = await evaluateLocationRestriction(
      req,
      { user_id: user.user_id, email: user.email, role_id: user.role_id },
      'password',
    );
    if (!locationCheck.allowed) {
      return res.status(403).json({ success: false, message: locationCheck.message });
    }

    const token = generateToken({
      id: user.user_id,
      email: user.email,
      role: user.role,
    });

    await logAuthEvent(req as any, {
      user_id: user.user_id,
      email: user.email,
      method: 'password',
      outcome: 'success',
    });

    return res.status(201).json({
      success: true,
      data: {
        userId: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role_name || 'Usuario',
      },
      token,
      message: 'El usuario ha iniciado sesión',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login rápido por PIN (centro de monitoreo).
 * - Recibe `email` + `pin` (4-8 dígitos).
 * - Verifica el hash bcrypt almacenado en USERS.pin_hash.
 * - Aplica las mismas restricciones de IP/dispositivo que el login normal.
 * - Emite un JWT de duración corta (2h) marcado con `via: 'pin'`.
 */
export const loginPin = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const { email, pin } = req.body as { email?: string; pin?: string };
  try {
    if (!email || !pin) {
      return res.status(400).json({ message: 'Correo y PIN son requeridos.' });
    }
    const lowerEmail = lowercase(email);
    const query = {
      text: `SELECT u.user_id, u.name, u.email, u.role_id, u.pin_hash, r.name as role_name
             FROM USERS u INNER JOIN ROLES r ON u.role_id = r.role_id
             WHERE u.email = $1`,
      values: [lowerEmail],
    };

    const result = await pool.query(query);
    const user = result.rows[0];

    if (!user || !user.pin_hash) {
      await logAuthEvent(req as any, {
        user_id: user?.user_id,
        email: lowerEmail,
        method: 'pin',
        outcome: 'denied_user',
        failure_reason: user ? 'Usuario sin PIN configurado' : 'Usuario no encontrado',
      });
      return res.status(404).json({ message: 'Usuario o PIN no válido.' });
    }

    const pinMatch = await comparePasswords(pin, user.pin_hash);
    if (!pinMatch) {
      await logAuthEvent(req as any, {
        user_id: user.user_id,
        email: lowerEmail,
        method: 'pin',
        outcome: 'denied_pin',
      });
      return res.status(401).json({ message: 'Usuario o PIN no válido.' });
    }

    const locationCheck = await evaluateLocationRestriction(
      req,
      { user_id: user.user_id, email: user.email, role_id: user.role_id },
      'pin',
    );
    if (!locationCheck.allowed) {
      return res.status(403).json({ success: false, message: locationCheck.message });
    }

    const token = generateToken(
      { id: user.user_id, email: user.email, role: user.role_id, via: 'pin' },
      '2h',
    );

    await logAuthEvent(req as any, {
      user_id: user.user_id,
      email: user.email,
      method: 'pin',
      outcome: 'success',
    });

    return res.status(201).json({
      success: true,
      data: {
        userId: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role_name || 'Usuario',
      },
      token,
      message: 'Sesión iniciada por PIN',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Establecer / actualizar el PIN del usuario autenticado.
 * El llamador debe estar autenticado por JWT (cualquier rol).
 */
export const setPin = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<Response | void> => {
  const { pin } = req.body as { pin?: string };
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  if (!pin || !/^[0-9]{4,8}$/.test(pin)) {
    return res.status(400).json({ message: 'El PIN debe contener entre 4 y 8 dígitos.' });
  }
  const hashed = await hashPassword(pin);
  await pool.query({
    text: 'UPDATE USERS SET pin_hash = $1 WHERE user_id = $2',
    values: [hashed, user.id],
  });
  logSuccess('PIN actualizado', { userId: user.id });
  return res.status(200).json({ success: true, message: 'PIN actualizado.' });
});

/**
 * Borrar el PIN del usuario autenticado.
 */
export const deletePin = asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<Response | void> => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  await pool.query({
    text: 'UPDATE USERS SET pin_hash = NULL WHERE user_id = $1',
    values: [user.id],
  });
  return res.status(200).json({ success: true, message: 'PIN eliminado.' });
});

// =============================================================================
// Firma personal del usuario (canvas / mouse / tablet)
// =============================================================================

import { azureUploadBlob } from '../services/azure.service';

/**
 * PUT /auth/signature — body { signature: <data:image/png;base64,...> }
 * Sube la firma a Azure Blob (container 'signatures') y guarda la URL.
 */
export const setSignature = asyncHandler(async (req: Request, res: Response): Promise<Response | void> => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const { signature } = req.body as { signature?: string };
  if (!signature || !/^data:image\/(png|jpeg);base64,/.test(signature)) {
    return res
      .status(400)
      .json({ message: 'La firma debe enviarse como dataURL image/png o image/jpeg.' });
  }

  // Extraer mime y bytes
  const [meta, base64] = signature.split(',', 2);
  const mime = meta.match(/data:(image\/(?:png|jpeg))/)?.[1] || 'image/png';
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length < 200) {
    return res.status(400).json({ message: 'La firma está vacía o es inválida.' });
  }

  const filename = `user-${user.id}-${Date.now()}.${ext}`;
  const upload = await azureUploadBlob({
    blob: {
      originalname: filename,
      buffer,
      size: buffer.length,
      mimetype: mime,
    } as any,
    containerName: 'signatures',
  });
  if (!upload.success) {
    return res.status(500).json({ success: false, message: upload.message });
  }

  await pool.query({
    text: 'UPDATE USERS SET signature_url = $1 WHERE user_id = $2',
    values: [upload.message, user.id],
  });

  logSuccess('Firma actualizada', { userId: user.id });
  return res.status(200).json({
    success: true,
    message: 'Firma guardada.',
    data: { signature_url: upload.message },
  });
});

/**
 * GET /auth/signature — devuelve la URL actual de la firma del usuario.
 */
export const getMySignature = asyncHandler(async (req: Request, res: Response): Promise<Response | void> => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const r = await pool.query<{ signature_url: string | null }>({
    text: 'SELECT signature_url FROM USERS WHERE user_id = $1',
    values: [user.id],
  });
  return res.status(200).json({
    success: true,
    data: { signature_url: r.rows[0]?.signature_url ?? null },
  });
});

/**
 * DELETE /auth/signature — limpia la URL en DB. NO borra el blob de Azure
 * (queda como evidencia histórica por si algún oficio antiguo la referencia).
 */
export const deleteSignature = asyncHandler(async (req: Request, res: Response): Promise<Response | void> => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  await pool.query({
    text: 'UPDATE USERS SET signature_url = NULL WHERE user_id = $1',
    values: [user.id],
  });
  return res.status(200).json({ success: true, message: 'Firma eliminada.' });
});
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const { email }: IUser = req.body;
  try {
    const lowerEmail = lowercase(email);
    const query = {
      name: 'login-user',
      text: 'SELECT user_id, name, email, role_id FROM USERS WHERE email = $1',
      values: [lowerEmail],
    };
    const result = await pool.query(query);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: 'No existe un usuario registrado con este correo.' });
    const token = generateToken({ id: user.user_id, email: user.email, role: user.role_id }, '4h');
    const update = {
      text: 'UPDATE USERS SET forgot_password_token = $1 WHERE email = $2',
      values: [token, lowerEmail],
    };
    const resultUpdate = await pool.query(update);
    if (!resultUpdate.rowCount) {
      return res.status(400).json({
        success: false,
        message: 'Ocurrió un error al intentar guardar el token.',
      });
    }
    await sendEmail(lowerEmail, 'Reestablecer contraseña CCIOD - Technologies', user.name, token);
    return res.status(201).json({
      success: true,
      message: 'Se ha enviado un correo con las intrucciones.',
    });
  } catch (error) {
    next(error);
  }
};
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  const { password }: IUser = req.body;
  const token = req.params.token;
  try {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        res.status(404).json({
          success: false,
          message:
            'El token ha caducado o no hay un token registrado para reestablecer la contraseña. Intenté enviar un nuevo correo para generar una nueva URL.',
        });
      }
    });
    const hashedPassword = await hashPassword(password);
    const query = {
      name: 'login-user',
      text: 'UPDATE USERS SET password=$1, forgot_password_token=$2 WHERE forgot_password_token = $3 RETURNING email, name',
      values: [hashedPassword, null, token],
    };
    const result = await pool.query(query);
    if (!result.rowCount)
      return res.status(404).json({
        success: false,
        message: 'No fue posible cambiar la contraseña. Verifique que el token se válido, recuerde que tiene un tiempo de expiración de 1 día.',
      });
    const { email, name } = result.rows[0];
    await sendEmail(email, 'Contraseña Reestablecida CCIOD', name);
    return res.status(201).json({
      success: true,
      message: 'La contraseña se ha modificado.',
    });
  } catch (error) {
    next(error);
  }
};
