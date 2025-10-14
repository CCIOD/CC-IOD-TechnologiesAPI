import { Response } from "express";

export interface IAzureUpload {
  blob?: Express.Multer.File;
  blobname?: string;
  containerName: "contracts" | "reports" | "carrier-acts" | "contract-renewals" | "prosecutor-documents";
  folderPath?: string; // Optional folder path for organizing files by client
}
