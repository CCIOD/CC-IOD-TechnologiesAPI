import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken";
import { extractUserInfo } from "../middlewares/userInfo.middleware";
import {
  createClient,
  deleteClient,
  deleteContract,
  getAllClients,
  getClientById,
  getApprovedClientsWithoutCarrier,
  updateClient,
  uploadContract,
  uninstallClient,
} from "../controllers/clientController";
import { errorMiddleware } from "../middlewares/errorMiddleware";
import { validationFiles } from "../middlewares/validationFiles";
import { uploadContractFile } from "../middlewares/uploadFiles";
import { validationsClient, validationUninstallClient } from "../middlewares/validationMiddlewares";

const router = express.Router();

router.use(authenticateToken);
router.use(extractUserInfo);
router.get("/", getAllClients);
router.get("/approved-without-carrier/", getApprovedClientsWithoutCarrier);
router.get("/:id", getClientById);
router.post("/", validationsClient, createClient);
router.put("/:id", validationsClient, updateClient);
router.put(
  "/upload-contract/:id",
  uploadContractFile,
  uploadContract,
  validationFiles
);
router.delete("/:id", deleteClient);
router.put("/delete-contract/:id", deleteContract);
router.put("/uninstall/:id", validationUninstallClient, uninstallClient);
router.use(errorMiddleware);

export default router;
