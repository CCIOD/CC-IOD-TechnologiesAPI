import { BlobServiceClient } from '@azure/storage-blob';

const AZURE_KEY = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER = 'operations-docs';
const FOLDER_KEEP = '.keep';

const getContainer = () => {
  if (!AZURE_KEY) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING no está configurado.');
  }
  const svc = BlobServiceClient.fromConnectionString(AZURE_KEY);
  return svc.getContainerClient(CONTAINER);
};

/**
 * Normaliza un prefijo para que termine en "/" o quede vacío (root).
 * Permite letras, números, espacios, guiones y barras "/" como separador.
 */
export const normalizePrefix = (raw?: string | null): string => {
  if (!raw) return '';
  let p = raw.trim();
  if (!p) return '';
  // Quita barra inicial
  p = p.replace(/^\/+/, '');
  // Asegura barra final
  if (!p.endsWith('/')) p = `${p}/`;
  return p;
};

/**
 * Devuelve el segmento final del prefijo (nombre de la carpeta visible).
 * Ej: "Contratos/2026/" -> "2026"
 */
export const prefixDisplayName = (prefix: string): string => {
  const trimmed = prefix.replace(/\/$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || '';
};

export interface FolderEntry {
  type: 'folder';
  prefix: string;
  name: string;
}

export interface FileEntry {
  type: 'file';
  name: string;
  fullName: string; // incluye prefix
  url: string;
  size: number;
  lastModified: string | null;
  contentType: string | null;
}

export type DocEntry = FolderEntry | FileEntry;

/**
 * Lista una "carpeta" del container. Devuelve subcarpetas Y archivos,
 * usando listBlobsByHierarchy("/", {prefix}) que respeta los separadores.
 */
export const listFolder = async (prefix = ''): Promise<DocEntry[]> => {
  const container = getContainer();
  const entries: DocEntry[] = [];
  const iter = container.listBlobsByHierarchy('/', { prefix });
  for await (const item of iter) {
    if (item.kind === 'prefix') {
      const name = prefixDisplayName(item.name);
      if (!name) continue;
      entries.push({ type: 'folder', prefix: item.name, name });
    } else if (item.kind === 'blob') {
      // Saltar los marcadores .keep que mantienen carpetas vacías
      if (item.name.endsWith(FOLDER_KEEP)) continue;
      const blobName = item.name.slice(prefix.length);
      entries.push({
        type: 'file',
        name: blobName,
        fullName: item.name,
        url: container.getBlockBlobClient(item.name).url,
        size: item.properties.contentLength ?? 0,
        lastModified: item.properties.lastModified?.toISOString() ?? null,
        contentType: item.properties.contentType ?? null,
      });
    }
  }
  // Carpetas primero, ordenadas alfabéticamente
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  });
  return entries;
};

/**
 * "Crea" una carpeta subiendo un blob marcador `prefix/.keep`. Sin esto, las
 * carpetas vacías no existen en blob storage.
 */
export const createFolder = async (
  parent: string,
  folderName: string,
): Promise<{ prefix: string }> => {
  const cleanName = folderName.trim().replace(/[/\\]+/g, '').slice(0, 120);
  if (!cleanName) throw new Error('Nombre de carpeta inválido.');
  const prefix = normalizePrefix(parent) + cleanName + '/';
  const container = getContainer();
  const blob = container.getBlockBlobClient(prefix + FOLDER_KEEP);
  await blob.upload(Buffer.alloc(0), 0, {
    blobHTTPHeaders: { blobContentType: 'application/x-keep' },
  });
  return { prefix };
};

export const uploadFileToFolder = async (
  prefix: string,
  file: Express.Multer.File,
): Promise<{ url: string; blobName: string }> => {
  const container = getContainer();
  const safeName = file.originalname
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .replace(/\s+/g, '_');
  const blobName = normalizePrefix(prefix) + safeName;
  const blob = container.getBlockBlobClient(blobName);
  await blob.upload(file.buffer, file.size, {
    blobHTTPHeaders: {
      blobContentType: file.mimetype,
      blobContentDisposition: `inline; filename="${safeName}"`,
    },
  });
  return { url: blob.url, blobName };
};

export const deleteFile = async (blobName: string): Promise<void> => {
  const container = getContainer();
  await container.deleteBlob(blobName);
};

/**
 * Elimina toda una "carpeta": borra todos los blobs cuyo nombre comienza con
 * el prefijo dado. Cuidado: irreversible.
 */
export const deleteFolder = async (prefix: string): Promise<number> => {
  const container = getContainer();
  const norm = normalizePrefix(prefix);
  let count = 0;
  const iter = container.listBlobsFlat({ prefix: norm });
  for await (const blob of iter) {
    await container.deleteBlob(blob.name);
    count++;
  }
  return count;
};

/**
 * Genera la URL del blob (los blobs son públicos según el setup actual).
 */
export const getFileUrl = (blobName: string): string => {
  const container = getContainer();
  return container.getBlockBlobClient(blobName).url;
};
