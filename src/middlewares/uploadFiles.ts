import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
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
    fileSize: 50000000, // 20 MB
  },
});

// Exportar el objeto upload para uso directo
export { upload };

export const uploadContractFile = upload.single("contract");
export const uploadReportFile = upload.single("installation_report");
export const uploadCarrierActFile = upload.single("act_document");
export const uploadRenewalFile = upload.single("renewal_document");
export const uploadProsecutorDocFile = upload.single("document_file");
