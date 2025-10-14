# Sistema de Renovaciones de Contrato

Este documento explica cómo usar el nuevo sistema de renovaciones de contrato implementado en la API.

## 📋 Características

- **Múltiples renovaciones por cliente**: Un cliente puede tener una o muchas renovaciones
- **Documentos en Azure**: Los documentos PDF se suben automáticamente a Azure Blob Storage
- **Auditoría completa**: Todas las operaciones quedan registradas con timestamps
- **Validación JOI**: Validación robusta de todos los campos

## 🗄️ Estructura de Datos

```typescript
{
  renewal_id: number,           // Auto-generado (PK)
  client_id: number,            // Requerido (FK a CLIENTS)
  renewal_date: "2025-01-15",   // Requerido (DATE)
  renewal_document: "documento.pdf", // Opcional (URL en Azure)
  renewal_duration: "12 meses", // Opcional (VARCHAR 50)
  notes: "Notas de la renovación", // Opcional (TEXT)
  created_at: "2025-01-01T10:00:00Z",  // Auto-generado
  updated_at: "2025-01-02T15:30:00Z"   // Auto-generado y actualizado
}
```

## 🚀 Instalación

### 1. Ejecutar la migración SQL

Ejecuta el script de migración para crear la tabla:

```bash
psql -U tu_usuario -d tu_base_de_datos -f create_contract_renewals.sql
```

O desde un cliente PostgreSQL (pgAdmin, DBeaver), ejecuta el contenido del archivo `create_contract_renewals.sql`.

### 2. Crear el contenedor en Azure

Asegúrate de crear el contenedor `contract-renewals` en tu Azure Blob Storage con las mismas configuraciones que los otros contenedores.

## 📡 Endpoints de la API

### Base URL: `/renewals`

Todas las rutas requieren autenticación (token JWT).

---

### 1. **Obtener todas las renovaciones (Admin)**

```http
GET /renewals
Authorization: Bearer {token}
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Renovaciones obtenidas correctamente",
  "count": 10,
  "data": [
    {
      "renewal_id": 1,
      "client_id": 5,
      "renewal_date": "2025-01-15",
      "renewal_document": "contrato_renovacion_2025.pdf",
      "renewal_duration": "12 meses",
      "notes": "Renovación automática",
      "created_at": "2025-01-01T10:00:00Z",
      "updated_at": "2025-01-01T10:00:00Z",
      "defendant_name": "Juan Pérez",
      "contract_number": "CTR-2024-001"
    }
  ]
}
```

---

### 2. **Obtener renovaciones de un cliente**

```http
GET /renewals/client/:client_id
Authorization: Bearer {token}
```

**Ejemplo:**
```http
GET /renewals/client/5
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Renovaciones obtenidas correctamente",
  "count": 3,
  "data": [
    {
      "renewal_id": 1,
      "client_id": 5,
      "renewal_date": "2025-01-15",
      "renewal_document": "renovacion_2025.pdf",
      "renewal_duration": "12 meses",
      "notes": "Primera renovación",
      "created_at": "2025-01-01T10:00:00Z",
      "updated_at": "2025-01-01T10:00:00Z"
    }
  ]
}
```

---

### 3. **Obtener una renovación específica**

```http
GET /renewals/:renewal_id
Authorization: Bearer {token}
```

**Ejemplo:**
```http
GET /renewals/1
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Renovación obtenida correctamente",
  "data": {
    "renewal_id": 1,
    "client_id": 5,
    "renewal_date": "2025-01-15",
    "renewal_document": "renovacion_2025.pdf",
    "renewal_duration": "12 meses",
    "notes": "Renovación automática acordada",
    "created_at": "2025-01-01T10:00:00Z",
    "updated_at": "2025-01-02T15:30:00Z",
    "defendant_name": "Juan Pérez",
    "contract_number": "CTR-2024-001"
  }
}
```

**Respuesta de error (404):**
```json
{
  "success": false,
  "message": "Renovación no encontrada"
}
```

---

### 4. **Crear una nueva renovación**

```http
POST /renewals
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**Body (FormData):**
```javascript
{
  client_id: 5,                    // Requerido
  renewal_date: "2025-01-15",      // Requerido (YYYY-MM-DD)
  renewal_duration: "12 meses",    // Opcional
  notes: "Renovación automática",  // Opcional
  renewal_document: File           // Opcional (archivo PDF)
}
```

**Ejemplo con JavaScript/Fetch:**
```javascript
const formData = new FormData();
formData.append('client_id', '5');
formData.append('renewal_date', '2025-01-15');
formData.append('renewal_duration', '12 meses');
formData.append('notes', 'Renovación automática acordada');
formData.append('renewal_document', fileInput.files[0]); // Archivo PDF

fetch('/renewals', {
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
  "message": "Renovación de contrato creada correctamente",
  "data": {
    "renewal_id": 1,
    "client_id": 5,
    "renewal_date": "2025-01-15",
    "renewal_document": "renovacion_2025.pdf",
    "renewal_duration": "12 meses",
    "notes": "Renovación automática acordada",
    "created_at": "2025-01-01T10:00:00Z",
    "updated_at": "2025-01-01T10:00:00Z"
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
  "message": "La fecha de renovación es requerida"
}

// Error al subir archivo (500)
{
  "success": false,
  "message": "Error al subir el archivo a Azure Storage"
}
```

---

### 5. **Actualizar una renovación**

```http
PUT /renewals/:renewal_id
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**Body (FormData) - Todos los campos son opcionales:**
```javascript
{
  renewal_date: "2025-02-15",      // Opcional
  renewal_duration: "18 meses",    // Opcional
  notes: "Renovación extendida",   // Opcional
  renewal_document: File           // Opcional (archivo PDF nuevo)
}
```

**Ejemplo:**
```javascript
const formData = new FormData();
formData.append('renewal_date', '2025-02-15');
formData.append('renewal_duration', '18 meses');
formData.append('notes', 'Renovación extendida por acuerdo');
formData.append('renewal_document', newFileInput.files[0]);

fetch('/renewals/1', {
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
  "message": "Renovación actualizada correctamente",
  "data": {
    "renewal_id": 1,
    "client_id": 5,
    "renewal_date": "2025-02-15",
    "renewal_document": "renovacion_actualizada_2025.pdf",
    "renewal_duration": "18 meses",
    "notes": "Renovación extendida por acuerdo",
    "created_at": "2025-01-01T10:00:00Z",
    "updated_at": "2025-01-10T14:20:00Z"
  }
}
```

**Nota:** Si subes un nuevo documento, el documento anterior se eliminará automáticamente de Azure.

---

### 6. **Eliminar una renovación**

```http
DELETE /renewals/:renewal_id
Authorization: Bearer {token}
```

**Ejemplo:**
```http
DELETE /renewals/1
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Renovación eliminada correctamente"
}
```

**Respuesta de error (404):**
```json
{
  "success": false,
  "message": "Renovación no encontrada"
}
```

**Nota:** Al eliminar una renovación, el documento asociado también se eliminará de Azure Blob Storage.

---

## ✅ Validaciones

### Campos requeridos para crear:
- `client_id`: Debe ser un número entero positivo
- `renewal_date`: Debe ser una fecha válida en formato YYYY-MM-DD

### Campos opcionales:
- `renewal_document`: Archivo PDF (máximo 50MB)
- `renewal_duration`: String de máximo 50 caracteres
- `notes`: Texto libre

### Validaciones de archivo:
- **Formato**: Solo archivos PDF
- **Tamaño máximo**: 50 MB
- **Contenedor Azure**: `contract-renewals`

## 🔒 Seguridad

- ✅ Todas las rutas requieren autenticación JWT
- ✅ Validación de permisos por rol de usuario
- ✅ Validación de existencia de cliente antes de crear
- ✅ Limpieza automática de archivos en caso de error
- ✅ Sanitización de nombres de archivo (espacios reemplazados por _)

## 📊 Base de Datos

### Tabla: `CONTRACT_RENEWALS`

```sql
CREATE TABLE CONTRACT_RENEWALS (
    renewal_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES CLIENTS(client_id) ON DELETE CASCADE,
    renewal_date DATE NOT NULL,
    renewal_document TEXT,
    renewal_duration VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Índices:
- `idx_renewals_client_id`: Para búsquedas rápidas por cliente
- `idx_renewals_date`: Para búsquedas y ordenamiento por fecha

### Trigger:
- `trigger_update_renewal_timestamp`: Actualiza automáticamente `updated_at` en cada UPDATE

## 🧪 Ejemplos de Uso

### Ejemplo 1: Crear renovación sin documento
```javascript
const response = await fetch('/renewals', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    client_id: 5,
    renewal_date: '2025-06-01',
    renewal_duration: '12 meses',
    notes: 'Renovación automática sin cambios'
  })
});
```

### Ejemplo 2: Crear renovación con documento
```javascript
const formData = new FormData();
formData.append('client_id', '5');
formData.append('renewal_date', '2025-06-01');
formData.append('renewal_duration', '12 meses');
formData.append('renewal_document', pdfFile);

const response = await fetch('/renewals', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Ejemplo 3: Actualizar solo las notas
```javascript
const response = await fetch('/renewals/1', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    notes: 'Renovación confirmada por el cliente'
  })
});
```

### Ejemplo 4: Obtener historial de renovaciones de un cliente
```javascript
const response = await fetch('/renewals/client/5', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
console.log(`Cliente tiene ${data.count} renovaciones`);
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

## 📝 Notas Importantes

1. **Cascade Delete**: Al eliminar un cliente, todas sus renovaciones se eliminan automáticamente
2. **Documentos**: Los archivos se almacenan en Azure con nombres únicos para evitar conflictos
3. **Timestamps**: `created_at` y `updated_at` se manejan automáticamente por la base de datos
4. **Orden**: Las renovaciones se devuelven ordenadas por fecha descendente (más reciente primero)

## 🔄 Integración con Frontend

El sistema está completamente integrado y listo para usar. El frontend ya tiene la estructura necesaria para:
- Crear nuevas renovaciones
- Ver historial de renovaciones
- Editar renovaciones existentes
- Eliminar renovaciones
- Subir y reemplazar documentos PDF

---

**Fecha de creación**: 9 de octubre de 2025  
**Versión**: 1.0.0  
**Autor**: Sistema CC-IOD Technologies
