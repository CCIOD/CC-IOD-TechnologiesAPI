import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(
        new multer.MulterError(
          "LIMIT_UNEXPECTED_FILE",
          "Only PDF files are allowed"
        )
      );
    }
    cb(null, true);
  },
  limits: {
    fileSize: 50000000, // 50 MB
  },
});

// Multer separado para imágenes — usado por attachments de reportes semanales.
const uploadImage = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    if (!ok) {
      return cb(
        new multer.MulterError(
          "LIMIT_UNEXPECTED_FILE",
          "Only PNG/JPEG/WEBP images are allowed"
        )
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB por imagen
});

// Exportar el objeto upload para uso directo
export { upload };

export const uploadContractFile = upload.single("contract");
export const uploadReportFile = upload.single("installation_report");
export const uploadCarrierActFile = upload.single("act_document");
export const uploadRenewalFile = upload.single("renewal_document");
export const uploadProsecutorDocFile = upload.single("document_file");
export const uploadAlertReportFile = upload.single("report_document");
export const uploadWeeklyReportFile = upload.single("weekly_report_document");

// Attachments para reportes semanales: hasta 20 imágenes por request.
export const uploadWeeklyReportAttachments = uploadImage.array("images", 20);

// Adjuntos del reporte a autoridad (alerta): hasta 10 imágenes.
export const uploadAlertReportAttachments = uploadImage.array("images", 10);

// Documentos de operación: cualquier tipo de archivo, hasta 20 por request, 50MB c/u.
const anyFile = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});
export const uploadOperationsDocsFiles = anyFile.array("files", 20);
