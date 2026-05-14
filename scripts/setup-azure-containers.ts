import "dotenv/config";
import { BlobServiceClient } from "@azure/storage-blob";

const AZURE_KEY = process.env.AZURE_STORAGE_CONNECTION_STRING;

// Contenedores requeridos en el sistema
const REQUIRED_CONTAINERS = [
  "contracts",
  "reports",
  "carrier-acts",
  "contract-renewals",
  "prosecutor-documents",
  "weekly-reports",
  "alert-reports",
  "signatures",
  "operations-docs"
];

async function ensureAllContainersExist() {
  if (!AZURE_KEY) {
    console.error("❌ Error: AZURE_STORAGE_CONNECTION_STRING no está configurado");
    process.exit(1);
  }

  try {
    console.log("🔍 Verificando contenedores en Azure Storage...\n");
    
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_KEY);
    
    for (const containerName of REQUIRED_CONTAINERS) {
      try {
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const exists = await containerClient.exists();
        
        if (exists) {
          console.log(`✅ Contenedor "${containerName}" existe`);
        } else {
          console.log(`⚠️  Contenedor "${containerName}" no existe. Creándolo...`);
          await containerClient.create({
            access: 'blob' // Acceso público para lectura de blobs
          });
          console.log(`✅ Contenedor "${containerName}" creado exitosamente`);
        }
      } catch (error: any) {
        if (error.code === 'ContainerAlreadyExists') {
          console.log(`✅ Contenedor "${containerName}" existe (detectado en create)`);
        } else {
          console.error(`❌ Error con contenedor "${containerName}":`, error.message);
        }
      }
    }
    
    console.log("\n✅ Todos los contenedores están listos");
    process.exit(0);
  } catch (error: any) {
    console.error("❌ Error general:", error.message);
    process.exit(1);
  }
}

// Ejecutar
ensureAllContainersExist();
