import { Response } from "express";

export interface IAzureUpload {
  blob?: Express.Multer.File;
  blobname?: string;
  containerName: "contracts" | "reports" | "carrier-acts";
}
