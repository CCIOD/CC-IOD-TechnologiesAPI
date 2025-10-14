# Sistema de Oficios de Fiscalía

Sistema completo para gestionar oficios y documentos emitidos por la fiscalía relacionados con cada cliente.

## 📋 Características

- **CRUD Completo**: Crear, leer, actualizar y eliminar oficios
- **Documentos en Azure**: Upload automático de archivos PDF a Azure Blob Storage
- **Relación con Clientes**: Cada oficio está vinculado a un cliente específico
- **Auditoría**: Timestamps automáticos de creación y actualización
- **Validación JOI**: Validación robusta de todos los campos

## 🗄️ Estructura de Datos

```typescript
{
  prosecutor_doc_id: number,           // Auto-generado (PK)
  client_id: number,                   // Requerido (FK a CLIENTS)
  document_type: "Oficio de Solicitud",// Requerido (VARCHAR 100)
  document_number: "OF-2024-001",      // Opcional (VARCHAR 50)
  issue_date: "2024-01-15",            // Requerido (DATE)
  document_file: "oficio.pdf",         // Opcional (URL en Azure)
  prosecutor_office: "Fiscalía General", // Opcional (VARCHAR 200)
  notes: "Notas adicionales",          // Opcional (TEXT)
  created_at: "2024-01-15T10:00:00Z",  // Auto-generado
  updated_at: "2024-01-15T10:00:00Z"   // Auto-actualizado
}
```

## 🚀 Instalación

### 1. Ejecutar la migración SQL

```bash
psql -U tu_usuario -d tu_base_de_datos -f create_prosecutor_documents.sql
```

O ejecuta el contenido del archivo `create_prosecutor_documents.sql` desde tu cliente PostgreSQL.

### 2. Crear el contenedor en Azure

```bash
npm run setup:azure
```

Este comando verifica y crea todos los contenedores necesarios, incluyendo `prosecutor-documents`.

## 📡 Endpoints de la API

### Base URL: `/prosecutor-docs`

Todas las rutas requieren autenticación (token JWT).

---

### 1. **Obtener todos los oficios (Admin)**

```http
GET /prosecutor-docs
Authorization: Bearer {token}
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Oficios obtenidos correctamente",
  "count": 10,
  "data": [
    {
      "prosecutor_doc_id": 1,
      "client_id": 5,
      "document_type": "Oficio de Solicitud",
      "document_number": "OF-2024-001",
      "issue_date": "2024-01-15",
      "document_file": "oficio_5_1705305600000.pdf",
      "prosecutor_office": "Fiscalía General del Estado",
      "notes": "Solicitud de información sobre el caso",
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z",
      "defendant_name": "Juan Pérez",
      "contract_number": "CTR-2024-001"
    }
  ]
}
```

---

### 2. **Obtener oficios de un cliente**

```http
GET /prosecutor-docs/client/:client_id
Authorization: Bearer {token}
```

**Ejemplo:**
```http
GET /prosecutor-docs/client/5
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Oficios obtenidos correctamente",
  "count": 3,
  "data": [
    {
      "prosecutor_doc_id": 1,
      "client_id": 5,
      "document_type": "Oficio de Solicitud",
      "document_number": "OF-2024-001",
      "issue_date": "2024-01-15",
      "document_file": "oficio_5_1705305600000.pdf",
      "prosecutor_office": "Fiscalía General del Estado",
      "notes": "Solicitud de información",
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### 3. **Obtener un oficio específico**

```http
GET /prosecutor-docs/:prosecutor_doc_id
Authorization: Bearer {token}
```

**Ejemplo:**
```http
GET /prosecutor-docs/1
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Oficio obtenido correctamente",
  "data": {
    "prosecutor_doc_id": 1,
    "client_id": 5,
    "document_type": "Oficio de Solicitud",
    "document_number": "OF-2024-001",
    "issue_date": "2024-01-15",
    "document_file": "oficio_5_1705305600000.pdf",
    "prosecutor_office": "Fiscalía General del Estado",
    "notes": "Solicitud de información sobre el caso",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z",
    "defendant_name": "Juan Pérez",
    "contract_number": "CTR-2024-001"
  }
}
```

**Respuesta de error (404):**
```json
{
  "success": false,
  "message": "Oficio no encontrado"
}
```

---

### 4. **Crear un nuevo oficio**

```http
POST /prosecutor-docs
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**Body (FormData):**
```javascript
{
  client_id: 5,                                    // Requerido
  document_type: "Oficio de Solicitud",            // Requerido
  document_number: "OF-2024-001",                  // Opcional
  issue_date: "2024-01-15",                        // Requerido (YYYY-MM-DD)
  prosecutor_office: "Fiscalía General del Estado",// Opcional
  notes: "Solicitud de información sobre el caso", // Opcional
  document_file: File                              // Opcional (archivo PDF)
}
```

**Ejemplo con JavaScript/Fetch:**
```javascript
const formData = new FormData();
formData.append('client_id', '5');
formData.append('document_type', 'Oficio de Solicitud');
formData.append('document_number', 'OF-2024-001');
formData.append('issue_date', '2024-01-15');
formData.append('prosecutor_office', 'Fiscalía General del Estado');
formData.append('notes', 'Solicitud de información sobre el caso');
formData.append('document_file', fileInput.files[0]); // Archivo PDF

fetch('/prosecutor-docs', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

**Respuesta exitosa (201):**
```json
{
  "success": true,
  "message": "Oficio creado correctamente",
  "data": {
    "prosecutor_doc_id": 1,
    "client_id": 5,
    "document_type": "Oficio de Solicitud",
    "document_number": "OF-2024-001",
    "issue_date": "2024-01-15",
    "document_file": "oficio_5_1705305600000.pdf",
    "prosecutor_office": "Fiscalía General del Estado",
    "notes": "Solicitud de información sobre el caso",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Respuestas de error:**
```json
// Cliente no encontrado (404)
{
  "success": false,
  "message": "Cliente no encontrado"
}

// Error de validación (400)
{
  "success": false,
  "message": "El tipo de documento es obligatorio"
}

// Error al subir archivo (500)
{
  "success": false,
  "message": "Error al subir el archivo a Azure Storage"
}
```

---

### 5. **Actualizar un oficio**

```http
PUT /prosecutor-docs/:prosecutor_doc_id
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**Body (FormData) - Todos los campos son opcionales:**
```javascript
{
  document_type: "Resolución Final",     // Opcional
  document_number: "OF-2024-001-MOD",    // Opcional
  issue_date: "2024-02-15",              // Opcional
  prosecutor_office: "Nueva Fiscalía",   // Opcional
  notes: "Resolución actualizada",       // Opcional
  document_file: File                    // Opcional (archivo PDF nuevo)
}
```

**Ejemplo:**
```javascript
const formData = new FormData();
formData.append('document_type', 'Resolución Final');
formData.append('notes', 'Resolución actualizada por acuerdo');
formData.append('document_file', newFileInput.files[0]);

fetch('/prosecutor-docs/1', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Oficio actualizado correctamente",
  "data": {
    "prosecutor_doc_id": 1,
    "client_id": 5,
    "document_type": "Resolución Final",
    "document_number": "OF-2024-001-MOD",
    "issue_date": "2024-02-15",
    "document_file": "oficio_5_1707998400000.pdf",
    "prosecutor_office": "Nueva Fiscalía",
    "notes": "Resolución actualizada por acuerdo",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-02-15T14:20:00.000Z"
  }
}
```

**Nota:** Si subes un nuevo documento, el documento anterior se eliminará automáticamente de Azure.

---

### 6. **Eliminar un oficio**

```http
DELETE /prosecutor-docs/:prosecutor_doc_id
Authorization: Bearer {token}
```

**Ejemplo:**
```http
DELETE /prosecutor-docs/1
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Oficio eliminado correctamente"
}
```

**Respuesta de error (404):**
```json
{
  "success": false,
  "message": "Oficio no encontrado"
}
```

**Nota:** Al eliminar un oficio, el documento asociado también se eliminará de Azure Blob Storage.

---

## ✅ Validaciones

### Campos requeridos para crear:
- `client_id`: Debe ser un número entero positivo y existir en CLIENTS
- `document_type`: String no vacío, máximo 100 caracteres
- `issue_date`: Fecha válida en formato YYYY-MM-DD

### Campos opcionales:
- `document_number`: String de máximo 50 caracteres
- `document_file`: Archivo PDF (máximo 50MB)
- `prosecutor_office`: String de máximo 200 caracteres
- `notes`: Texto libre

### Validaciones de archivo:
- **Formato**: Solo archivos PDF
- **Tamaño máximo**: 50 MB
- **Contenedor Azure**: `prosecutor-documents`

## 🔒 Seguridad

- ✅ Todas las rutas requieren autenticación JWT
- ✅ Validación de existencia de cliente antes de crear
- ✅ Limpieza automática de archivos en caso de error
- ✅ Sanitización de nombres de archivo (espacios reemplazados por _)
- ✅ Consultas parametrizadas para prevenir SQL injection

## 📊 Base de Datos

### Tabla: `PROSECUTOR_DOCUMENTS`

```sql
CREATE TABLE PROSECUTOR_DOCUMENTS (
    prosecutor_doc_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES CLIENTS(client_id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL,
    document_number VARCHAR(50),
    issue_date DATE NOT NULL,
    document_file TEXT,
    prosecutor_office VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Índices:
- `idx_prosecutor_client`: Para búsquedas rápidas por cliente
- `idx_prosecutor_issue_date`: Para búsquedas y ordenamiento por fecha
- `idx_prosecutor_type`: Para filtrar por tipo de documento

### Trigger:
- `trigger_prosecutor_updated_at`: Actualiza automáticamente `updated_at` en cada UPDATE

## 🧪 Ejemplos de Uso

### Ejemplo 1: Crear oficio sin documento
```javascript
const response = await fetch('/prosecutor-docs', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    client_id: 5,
    document_type: 'Citatorio',
    document_number: 'CIT-2024-045',
    issue_date: '2024-06-01',
    prosecutor_office: 'Fiscalía Regional',
    notes: 'Citatorio para audiencia preliminar'
  })
});
```

### Ejemplo 2: Crear oficio con documento
```javascript
const formData = new FormData();
formData.append('client_id', '5');
formData.append('document_type', 'Oficio de Solicitud');
formData.append('document_number', 'OF-2024-001');
formData.append('issue_date', '2024-06-01');
formData.append('prosecutor_office', 'Fiscalía General');
formData.append('document_file', pdfFile);

const response = await fetch('/prosecutor-docs', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Ejemplo 3: Actualizar solo las notas
```javascript
const response = await fetch('/prosecutor-docs/1', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    notes: 'Resolución confirmada por el fiscal'
  })
});
```

### Ejemplo 4: Obtener historial de oficios de un cliente
```javascript
const response = await fetch('/prosecutor-docs/client/5', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
console.log(`Cliente tiene ${data.count} oficios registrados`);
```

## 🐛 Manejo de Errores

Todos los errores siguen el formato estándar:
```json
{
  "success": false,
  "message": "Descripción del error"
}
```

### Códigos de estado HTTP:
- `200`: Operación exitosa
- `201`: Recurso creado exitosamente
- `400`: Error de validación
- `404`: Recurso no encontrado
- `500`: Error interno del servidor

## 📦 Contenedores de Azure

| Contenedor | Estado | Uso |
|------------|--------|-----|
| `prosecutor-documents` | ✅ Activo | Documentos de fiscalía |

### Nomenclatura de archivos:
- **Formato**: `{originalname_sanitizado}.pdf`
- **Ejemplo**: `oficio_fiscal_2024.pdf`

## 📝 Notas Importantes

1. **Cascade Delete**: Al eliminar un cliente, todos sus oficios se eliminan automáticamente
2. **Documentos**: Los archivos se almacenan en Azure con nombres sanitizados
3. **Timestamps**: `created_at` y `updated_at` se manejan automáticamente
4. **Orden**: Los oficios se devuelven ordenados por fecha de emisión descendente

## 🔄 Integración con Clientes

Para obtener un cliente con todos sus oficios:

```sql
SELECT 
  c.*,
  json_agg(
    json_build_object(
      'prosecutor_doc_id', pd.prosecutor_doc_id,
      'document_type', pd.document_type,
      'document_number', pd.document_number,
      'issue_date', pd.issue_date,
      'document_file', pd.document_file,
      'prosecutor_office', pd.prosecutor_office,
      'notes', pd.notes
    )
  ) AS prosecutor_documents
FROM CLIENTS c
LEFT JOIN PROSECUTOR_DOCUMENTS pd ON c.client_id = pd.client_id
WHERE c.client_id = $1
GROUP BY c.client_id;
```

---

**Fecha de creación**: 9 de octubre de 2025  
**Versión**: 1.0.0  
**Autor**: Sistema CC-IOD Technologies
