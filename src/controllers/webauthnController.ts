import { Request, Response, NextFunction } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server/script/deps';
import { pool } from '../database/connection';
import { generateToken } from '../services/auth.service';
import { lowercase } from '../helpers/helpers';
import { logSuccess, logWarning, logError } from '../middlewares/loggingMiddleware';
import { asyncHandler } from '../middlewares/enhancedMiddlewares';
import { logAuthEvent } from '../services/audit.service';
import { evaluateLocationRestriction } from '../middlewares/enforceLocationRestriction';

/**
 * Identifica el "relying party" (sitio web) ante el autenticador WebAuthn.
 * En desarrollo se permite `localhost`; en producción debe coincidir con el
 * dominio servido al usuario (sin protocolo ni puerto para `rpID`).
 */
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'CCIOD Technologies';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const EXPECTED_ORIGIN =
  process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173';
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutos

interface UserRow {
  user_id: number;
  email: string;
  role_id: number;
  role_name: string;
  name: string;
}

const findUserByEmail = async (email: string): Promise<UserRow | null> => {
  const result = await pool.query<UserRow>({
    text: `SELECT u.user_id, u.email, u.role_id, u.name, r.name AS role_name
           FROM USERS u INNER JOIN ROLES r ON u.role_id = r.role_id
           WHERE u.email = $1`,
    values: [email],
  });
  return result.rows[0] ?? null;
};

const storeChallenge = async (
  email: string,
  challenge: string,
  purpose: 'registration' | 'authentication',
) => {
  await pool.query({
    text: `INSERT INTO WEBAUTHN_CHALLENGES (email, challenge, purpose, expires_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '${CHALLENGE_TTL_MS} milliseconds')`,
    values: [email, challenge, purpose],
  });
};

const consumeChallenge = async (
  email: string,
  purpose: 'registration' | 'authentication',
): Promise<string | null> => {
  const result = await pool.query<{ challenge_id: number; challenge: string }>({
    text: `SELECT challenge_id, challenge FROM WEBAUTHN_CHALLENGES
           WHERE email = $1 AND purpose = $2 AND expires_at > NOW()
           ORDER BY created_at DESC LIMIT 1`,
    values: [email, purpose],
  });
  const row = result.rows[0];
  if (!row) return null;
  await pool.query({
    text: 'DELETE FROM WEBAUTHN_CHALLENGES WHERE challenge_id = $1',
    values: [row.challenge_id],
  });
  return row.challenge;
};

// =============================================================================
// REGISTRO — Solo usuarios autenticados pueden enrolar una credencial.
// =============================================================================

export const webauthnRegistrationOptions = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ message: 'No autorizado' });

  const userResult = await pool.query<UserRow>({
    text: 'SELECT user_id, email, role_id, name FROM USERS WHERE user_id = $1',
    values: [authUser.id],
  });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

  const existing = await pool.query<{ credential_id: string; transports: string }>({
    text: 'SELECT credential_id, transports FROM WEBAUTHN_CREDENTIALS WHERE user_id = $1',
    values: [user.user_id],
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(String(user.user_id)),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.rows.map((row) => ({
      id: row.credential_id,
      transports: (row.transports?.split(',') ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await storeChallenge(user.email, options.challenge, 'registration');
  return res.status(200).json({ success: true, data: options });
});

export const webauthnRegistrationVerify = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ message: 'No autorizado' });

  const body = req.body as { response?: RegistrationResponseJSON; deviceLabel?: string };
  if (!body?.response) {
    return res.status(400).json({ message: 'Falta la respuesta del autenticador.' });
  }

  const expectedChallenge = await consumeChallenge(authUser.email, 'registration');
  if (!expectedChallenge) {
    return res.status(400).json({ message: 'Challenge expirado o no encontrado.' });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (error) {
    logError(error, 'webauthnRegistrationVerify');
    return res.status(400).json({ message: 'No se pudo verificar el registro.' });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ message: 'Registro no verificado.' });
  }

  const { credential } = verification.registrationInfo;
  await pool.query({
    text: `INSERT INTO WEBAUTHN_CREDENTIALS
             (credential_id, user_id, public_key, counter, transports, device_label)
           VALUES ($1, $2, $3, $4, $5, $6)`,
    values: [
      credential.id,
      authUser.id,
      Buffer.from(credential.publicKey),
      Number(credential.counter ?? 0),
      (credential.transports ?? []).join(','),
      body.deviceLabel?.slice(0, 120) ?? null,
    ],
  });

  logSuccess('Credencial WebAuthn registrada', { userId: authUser.id });
  return res.status(201).json({ success: true, message: 'Credencial registrada.' });
});

// =============================================================================
// AUTENTICACIÓN — Inicio de sesión con huella/llave.
// =============================================================================

export const webauthnAuthenticationOptions = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ message: 'Correo requerido.' });

  const lowerEmail = lowercase(email);
  const user = await findUserByEmail(lowerEmail);
  if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

  const credsResult = await pool.query<{ credential_id: string; transports: string }>({
    text: 'SELECT credential_id, transports FROM WEBAUTHN_CREDENTIALS WHERE user_id = $1',
    values: [user.user_id],
  });

  if (credsResult.rowCount === 0) {
    return res.status(404).json({ message: 'El usuario no tiene credenciales WebAuthn registradas.' });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: credsResult.rows.map((row) => ({
      id: row.credential_id,
      transports: (row.transports?.split(',') ?? []) as AuthenticatorTransportFuture[],
    })),
    userVerification: 'preferred',
  });

  await storeChallenge(lowerEmail, options.challenge, 'authentication');
  return res.status(200).json({ success: true, data: options });
});

export const webauthnAuthenticationVerify = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const { email, response } = req.body as {
      email?: string;
      response?: AuthenticationResponseJSON;
    };
    if (!email || !response) {
      return res.status(400).json({ message: 'Correo y respuesta del autenticador requeridos.' });
    }

    const lowerEmail = lowercase(email);
    const user = await findUserByEmail(lowerEmail);
    if (!user) {
      await logAuthEvent(req as any, {
        email: lowerEmail,
        method: 'webauthn',
        outcome: 'denied_user',
        failure_reason: 'Usuario no encontrado',
      });
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const expectedChallenge = await consumeChallenge(lowerEmail, 'authentication');
    if (!expectedChallenge) {
      return res.status(400).json({ message: 'Challenge expirado o no encontrado.' });
    }

    const credResult = await pool.query<{
      credential_id: string;
      public_key: Buffer;
      counter: string;
      transports: string;
    }>({
      text: `SELECT credential_id, public_key, counter, transports
             FROM WEBAUTHN_CREDENTIALS
             WHERE user_id = $1 AND credential_id = $2`,
      values: [user.user_id, response.id],
    });
    const cred = credResult.rows[0];
    if (!cred) {
      await logAuthEvent(req as any, {
        user_id: user.user_id,
        email: lowerEmail,
        method: 'webauthn',
        outcome: 'denied_webauthn',
        failure_reason: 'Credencial no registrada',
      });
      return res.status(404).json({ message: 'Credencial no registrada para este usuario.' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: EXPECTED_ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: cred.credential_id,
          publicKey: new Uint8Array(cred.public_key),
          counter: Number(cred.counter),
          transports: (cred.transports?.split(',') ?? []) as AuthenticatorTransportFuture[],
        },
      });
    } catch (error) {
      logWarning('WebAuthn verifyAuthenticationResponse failed', { error: (error as Error).message });
      await logAuthEvent(req as any, {
        user_id: user.user_id,
        email: lowerEmail,
        method: 'webauthn',
        outcome: 'denied_webauthn',
        failure_reason: (error as Error).message,
      });
      return res.status(400).json({ message: 'No se pudo verificar la autenticación.' });
    }

    if (!verification.verified) {
      await logAuthEvent(req as any, {
        user_id: user.user_id,
        email: lowerEmail,
        method: 'webauthn',
        outcome: 'denied_webauthn',
        failure_reason: 'verified=false',
      });
      return res.status(401).json({ message: 'Autenticación no verificada.' });
    }

    const locationCheck = await evaluateLocationRestriction(
      req,
      { user_id: user.user_id, email: user.email, role_id: user.role_id },
      'webauthn',
    );
    if (!locationCheck.allowed) {
      return res.status(403).json({ success: false, message: locationCheck.message });
    }

    await pool.query({
      text: `UPDATE WEBAUTHN_CREDENTIALS
             SET counter = $1, last_used_at = NOW()
             WHERE credential_id = $2`,
      values: [verification.authenticationInfo.newCounter, cred.credential_id],
    });

    const token = generateToken({
      id: user.user_id,
      email: user.email,
      role: user.role_id,
      via: 'webauthn',
    });

    await logAuthEvent(req as any, {
      user_id: user.user_id,
      email: user.email,
      method: 'webauthn',
      outcome: 'success',
    });

    return res.status(200).json({
      success: true,
      data: {
        userId: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role_name || 'Usuario',
      },
      token,
      message: 'Sesión iniciada por WebAuthn',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lista las credenciales WebAuthn del usuario autenticado.
 */
export const listWebauthnCredentials = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ message: 'No autorizado' });
  const result = await pool.query({
    text: `SELECT credential_id, device_label, created_at, last_used_at
           FROM WEBAUTHN_CREDENTIALS WHERE user_id = $1 ORDER BY created_at DESC`,
    values: [authUser.id],
  });
  return res.status(200).json({ success: true, data: result.rows });
});

/**
 * Elimina una credencial WebAuthn propia.
 */
export const deleteWebauthnCredential = asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ message: 'No autorizado' });
  const { credentialId } = req.params;
  const result = await pool.query({
    text: 'DELETE FROM WEBAUTHN_CREDENTIALS WHERE credential_id = $1 AND user_id = $2',
    values: [credentialId, authUser.id],
  });
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'Credencial no encontrada.' });
  }
  return res.status(200).json({ success: true, message: 'Credencial eliminada.' });
});
