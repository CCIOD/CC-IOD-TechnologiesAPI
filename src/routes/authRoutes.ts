import express from "express";
import {
  deletePin,
  deleteSignature,
  forgotPassword,
  getMySignature,
  login,
  loginPin,
  register,
  resetPassword,
  setPin,
  setSignature,
} from "../controllers/authController";
import {
  webauthnAuthenticationOptions,
  webauthnAuthenticationVerify,
  webauthnRegistrationOptions,
  webauthnRegistrationVerify,
  listWebauthnCredentials,
  deleteWebauthnCredential,
} from "../controllers/webauthnController";
import {
  validationChangePass,
  validationEmail,
  validationsLogin,
  validationsRegister,
} from "../middlewares/authMiddelewares";
import { authenticateToken } from "../middlewares/authenticateToken";
import { extractUserInfo } from "../middlewares/userInfo.middleware";
import { errorMiddleware } from "../middlewares/errorMiddleware";

const router = express.Router();

// Públicas
router.post("/register", validationsRegister, register);
router.post("/login", validationsLogin, login);
router.post("/login-pin", loginPin);
router.put("/forgot-password", validationEmail, forgotPassword);
router.put("/reset-password/:token", validationChangePass, resetPassword);

// WebAuthn — autenticación (públicas, requieren email previo)
router.post("/webauthn/login-options", webauthnAuthenticationOptions);
router.post("/webauthn/login-verify", webauthnAuthenticationVerify);

// WebAuthn — registro y gestión de credenciales (requieren sesión)
router.post(
  "/webauthn/register-options",
  authenticateToken,
  extractUserInfo,
  webauthnRegistrationOptions,
);
router.post(
  "/webauthn/register-verify",
  authenticateToken,
  extractUserInfo,
  webauthnRegistrationVerify,
);
router.get(
  "/webauthn/credentials",
  authenticateToken,
  extractUserInfo,
  listWebauthnCredentials,
);
router.delete(
  "/webauthn/credentials/:credentialId",
  authenticateToken,
  extractUserInfo,
  deleteWebauthnCredential,
);

// PIN — gestión por el propio usuario
router.put("/pin", authenticateToken, extractUserInfo, setPin);
router.delete("/pin", authenticateToken, extractUserInfo, deletePin);

// Firma personal
router.get("/signature", authenticateToken, extractUserInfo, getMySignature);
router.put("/signature", authenticateToken, extractUserInfo, setSignature);
router.delete("/signature", authenticateToken, extractUserInfo, deleteSignature);

router.use(errorMiddleware);

export default router;
