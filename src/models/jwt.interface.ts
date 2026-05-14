export interface JwtPayload {
  id: number;
  email: string;
  role: number;
  /** Método de autenticación que emitió el token. */
  via?: 'password' | 'pin' | 'webauthn';
}
