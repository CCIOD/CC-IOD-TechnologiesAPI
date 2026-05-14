export interface IAzureUpload {
  blob?: Express.Multer.File;
  blobname?: string;
  containerName:
    | "contracts"
    | "reports"
    | "carrier-acts"
    | "contract-renewals"
    | "prosecutor-documents"
    | "alert-reports"
    | "weekly-reports"
    | "signatures"
    | "operations-docs";
  folderPath?: string; // Optional folder path for organizing files by client
}
