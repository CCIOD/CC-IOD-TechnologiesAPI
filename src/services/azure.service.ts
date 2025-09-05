import { BlobServiceClient, BlockBlobClient } from "@azure/storage-blob";
import { IAzureUpload } from "../models/azure.interface";

const AZURE_KEY = process.env.AZURE_STORAGE_CONNECTION_STRING;
type TResponse = {
  success: boolean;
  message: string;
};

// Función auxiliar para reintentos
const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> => {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Retry] Intento ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error: any) {
      lastError = error;
      console.error(`[Retry] Intento ${attempt} falló:`, error.message);
      
      // No reintentar en errores que no son temporales
      if (error.message.includes('authentication') || 
          error.message.includes('unauthorized') ||
          error.message.includes('not found') ||
          error.code === 'BlobAlreadyExists') {
        throw error;
      }
      
      if (attempt < maxRetries) {
        console.log(`[Retry] Esperando ${delay}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Backoff exponencial
      }
    }
  }
  
  throw lastError;
};

const getBlockBlobClient = (
  containerName: string,
  blobName: string
): BlockBlobClient => {
  if (!AZURE_KEY) {
    console.error('Error: AZURE_STORAGE_CONNECTION_STRING no está configurado');
    throw new Error("La cadena de conexión de Azure Storage no está configurada en las variables de entorno");
  }

  if (!containerName) {
    console.error('Error: Nombre de contenedor no proporcionado');
    throw new Error("Debe especificar un nombre de contenedor");
  }

  if (!blobName) {
    console.error('Error: Nombre de blob no proporcionado');
    throw new Error("Debe especificar un nombre de archivo");
  }

  try {
    console.log(`[Azure Client] Creando cliente para contenedor: ${containerName}, archivo: ${blobName}`);
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_KEY);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    return containerClient.getBlockBlobClient(blobName);
  } catch (error: any) {
    console.error('Error al crear BlobServiceClient:', error);
    if (error.message.includes('connection string')) {
      throw new Error("La cadena de conexión de Azure Storage es inválida");
    }
    throw new Error(`Error al configurar cliente de Azure Storage: ${error.message}`);
  }
};

export const azureUploadBlob = async ({
  blob,
  containerName,
}: IAzureUpload): Promise<TResponse> => {
  try {
    // Validaciones iniciales
    if (!blob) {
      console.error('Error: No se proporcionó archivo');
      return {
        success: false,
        message: "No se proporcionó un archivo para subir."
      };
    }

    if (!blob.originalname) {
      console.error('Error: El archivo no tiene nombre');
      return {
        success: false,
        message: "El archivo debe tener un nombre válido."
      };
    }

    if (!blob.buffer || blob.size === 0) {
      console.error('Error: El archivo está vacío');
      return {
        success: false,
        message: "El archivo está vacío o corrupto."
      };
    }

    console.log(`[Azure Upload] Iniciando subida: ${blob.originalname} (${blob.size} bytes)`);

    const blobName = blob.originalname.replace(/ /g, "_");
    
    // Crear cliente con manejo de errores mejorado
    let blockBlobClient: BlockBlobClient;
    try {
      blockBlobClient = getBlockBlobClient(containerName, blobName);
      console.log(`[Azure Upload] Cliente creado para contenedor: ${containerName}`);
    } catch (error: any) {
      console.error('Error al crear cliente Azure:', error);
      return {
        success: false,
        message: `Error de configuración de Azure Storage: ${error.message}`
      };
    }

    // Verificar si existe el archivo con timeout y reintentos
    console.log(`[Azure Upload] Verificando si existe: ${blobName}`);
    let exists: boolean;
    try {
      exists = await retryOperation(async () => {
        const existsPromise = blockBlobClient.exists();
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout al verificar archivo')), 30000)
        );
        
        return await Promise.race([existsPromise, timeoutPromise]);
      });
      
      console.log(`[Azure Upload] Archivo existe: ${exists}`);
    } catch (error: any) {
      console.error('Error al verificar existencia del archivo:', error);
      if (error.message.includes('Timeout')) {
        return {
          success: false,
          message: "Timeout al conectar con Azure Storage. Intente nuevamente."
        };
      }
      return {
        success: false,
        message: `Error al verificar archivo en Azure: ${error.message}`
      };
    }

    if (exists) {
      console.log(`[Azure Upload] El archivo ya existe: ${blobName}`);
      return {
        success: false,
        message: `Ya existe el archivo ${blobName} en el contenedor ${containerName}.`,
      };
    }

    // Subir archivo con timeout, reintentos y validación
    console.log(`[Azure Upload] Iniciando subida del archivo: ${blobName}`);
    try {
      await retryOperation(async () => {
        const uploadPromise = blockBlobClient.upload(blob.buffer, blob.size);
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout en la subida')), 120000) // 2 minutos
        );
        
        return await Promise.race([uploadPromise, timeoutPromise]);
      });
      
      // Verificar que la subida fue exitosa
      const uploadedExists = await blockBlobClient.exists();
      if (!uploadedExists) {
        throw new Error('El archivo no se subió correctamente');
      }

      console.log(`[Azure Upload] Archivo subido exitosamente: ${blockBlobClient.url}`);
      return { 
        success: true, 
        message: blockBlobClient.url 
      };

    } catch (error: any) {
      console.error('Error durante la subida:', error);
      
      if (error.message.includes('Timeout')) {
        return {
          success: false,
          message: "La subida del archivo tardó demasiado. Verifique su conexión e intente con un archivo más pequeño."
        };
      }
      
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
        return {
          success: false,
          message: "Error de conexión con Azure Storage. Verifique su conexión a internet."
        };
      }

      if (error.message.includes('authentication') || error.message.includes('unauthorized')) {
        return {
          success: false,
          message: "Error de autenticación con Azure Storage. Verifique la configuración."
        };
      }

      return {
        success: false,
        message: `Error al subir archivo: ${error.message || 'Error desconocido'}`
      };
    }

  } catch (error: any) {
    console.error('Error general en azureUploadBlob:', error);
    return { 
      success: false, 
      message: `Error inesperado al subir archivo: ${error.message || 'Error desconocido'}` 
    };
  }
};

export const azureDeleteBlob = async ({
  blobname,
  containerName,
}: IAzureUpload): Promise<TResponse> => {
  try {
    // Validaciones iniciales
    if (!blobname) {
      console.error('Error: No se proporcionó nombre de archivo para eliminar');
      return {
        success: false,
        message: "No se proporcionó el nombre del archivo a eliminar."
      };
    }

    console.log(`[Azure Delete] Iniciando eliminación: ${blobname} del contenedor: ${containerName}`);

    // Crear cliente con manejo de errores
    let blockBlobClient: BlockBlobClient;
    try {
      blockBlobClient = getBlockBlobClient(containerName, blobname);
    } catch (error: any) {
      console.error('Error al crear cliente Azure para eliminación:', error);
      return {
        success: false,
        message: `Error de configuración de Azure Storage: ${error.message}`
      };
    }

    // Verificar si el archivo existe antes de intentar eliminarlo
    try {
      const exists = await blockBlobClient.exists();
      if (!exists) {
        console.log(`[Azure Delete] El archivo no existe: ${blobname}`);
        return {
          success: true,
          message: "El archivo ya no existe en Azure Storage."
        };
      }
    } catch (error: any) {
      console.error('Error al verificar existencia para eliminación:', error);
      // Continuamos con la eliminación aunque falle la verificación
    }

    // Eliminar archivo con timeout
    try {
      const deletePromise = blockBlobClient.delete();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout en la eliminación')), 30000)
      );
      
      await Promise.race([deletePromise, timeoutPromise]);
      
      console.log(`[Azure Delete] Archivo eliminado exitosamente: ${blobname}`);
      return { 
        success: true, 
        message: "El archivo se ha eliminado correctamente." 
      };

    } catch (error: any) {
      console.error('Error durante la eliminación:', error);
      
      if (error.message.includes('Timeout')) {
        return {
          success: false,
          message: "La eliminación del archivo tardó demasiado. Intente nuevamente."
        };
      }

      if (error.code === 'BlobNotFound' || error.message.includes('not found')) {
        return {
          success: true,
          message: "El archivo ya no existe en Azure Storage."
        };
      }
      
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
        return {
          success: false,
          message: "Error de conexión con Azure Storage. El archivo no se pudo eliminar."
        };
      }

      return {
        success: false,
        message: `Error al eliminar archivo: ${error.message || 'Error desconocido'}`
      };
    }

  } catch (error: any) {
    console.error('Error general en azureDeleteBlob:', error);
    return { 
      success: false, 
      message: `Error inesperado al eliminar archivo: ${error.message || 'Error desconocido'}` 
    };
  }
};
