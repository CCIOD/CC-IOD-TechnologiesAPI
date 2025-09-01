# Endpoints para Gestión de Clientes con Observaciones - Actualizado

## 1. **Crear Cliente** - `POST /clients`

**Descripción**: Crea un nuevo cliente con múltiples observaciones organizadas por fecha y nuevos campos de contrato.

**Formato del Request Body**:

```json
{
  "contract_number": "CONT-2025-001",
  "defendant_name": "Juan Pérez García",
  "criminal_case": "Caso Penal 2025-001",
  "investigation_file_number": 67890,
  "judge_name": "Juez María González",
  "court_name": "Juzgado Primero Penal",
  "lawyer_name": "Lic. Carlos Rodríguez",
  "signer_name": "Ana Martínez",
  "contact_numbers": ["1234567890", "0987654321"],
  "hearing_date": "2025-09-15T10:00:00.000Z",
  "contract_date": "2025-09-01T06:00:00.000Z",
  "contract_document": "contrato_juan_perez_2025.pdf",
  "contract_duration": "12 meses",
  "payment_day": 15,
  "status": "Pendiente de aprobación",
  "prospect_id": 1,
  "observations": [
    {
      "date": "2025-08-29T06:00:00.000Z",
      "observation": "Cliente creado, documentación completa"
    },
    {
      "date": "2025-08-30T06:00:00.000Z", 
      "observation": "Revisión legal en proceso"
    }
  ]
}
```

**Campos obligatorios**: 
- `defendant_name`, `criminal_case`, `judge_name`, `court_name`, `lawyer_name`, `signer_name`, `contact_numbers`, `hearing_date`, `status`, `prospect_id`

**Campos opcionales**: 
- `contract_number` (string sin validaciones), `investigation_file_number`, `contract_date`, `contract_document`, `contract_duration`, `payment_day` (número entre 1-31), `observations`

### 2. **Actualizar Cliente** - `PUT /clients/:id`

**Descripción**: Actualiza un cliente existente. Las observaciones se reemplazan completamente (elimina las anteriores e inserta las nuevas).

**Formato del Request Body** (igual que para crear):
```json
{
  "contract_number": 12345,
  "defendant_name": "Juan Pérez García Modificado",
  "criminal_case": "Caso Penal 2025-001 Actualizado",
  "investigation_file_number": 67890,
  "judge_name": "Juez María González",
  "court_name": "Juzgado Primero Penal",
  "lawyer_name": "Lic. Carlos Rodríguez",
  "signer_name": "Ana Martínez",
  "contact_numbers": ["1234567890", "0987654321"],
  "hearing_date": "2025-09-20T10:00:00.000Z",
  "status": "Pendiente de audiencia",
  "prospect_id": 1,
  "observations": [
    {
      "date": "2025-09-01T06:00:00.000Z",
      "observation": "Cliente actualizado tras revisión"
    },
    {
      "date": "2025-09-02T06:00:00.000Z",
      "observation": "Nueva fecha de audiencia programada"
    }
  ]
}
```

### 3. **Obtener Todos los Clientes** - `GET /clients`

**Descripción**: Retorna todos los clientes con sus observaciones asociadas.

**Formato de Respuesta**:
```json
{
  "success": true,
  "message": "Información de todos los clientes",
  "data": [
    {
      "id": 1,
      "contact_numbers": ["1234567890", "0987654321"],
      "contract_number": 12345,
      "court_name": "Juzgado Primero Penal",
      "criminal_case": "Caso Penal 2025-001",
      "name": "Juan Pérez García",
      "hearing_date": "2025-09-15T10:00:00.000Z",
      "investigation_file_number": 67890,
      "judge_name": "Juez María González",
      "lawyer_name": "Lic. Carlos Rodríguez",
      "prospect_id": 1,
      "signer_name": "Ana Martínez",
      "status": "Pendiente de aprobación",
      "contract": null,
      "observations": [
        {
          "date": "2025-08-29",
          "observation": "Cliente creado, documentación completa"
        },
        {
          "date": "2025-08-30",
          "observation": "Revisión legal en proceso"
        }
      ]
    }
  ]
}
```

### **Cambios implementados en la base de datos**:
- Nueva tabla `CLIENT_OBSERVATIONS` con referencia al cliente
- Cada observación tiene su propia fecha y texto
- Relación uno a muchos: un cliente puede tener múltiples observaciones
- Foreign key con cascada: al eliminar un cliente se eliminan sus observaciones

### **Validaciones del Schema**:
- Cada observación debe tener `date` (fecha válida en formato ISO 8601) y `observation` (string no vacío)
- El array `observations` es opcional pero si se incluye debe ser un array válido
- Los demás campos siguen las validaciones estándar del cliente
- El `prospect_id` debe corresponder a un prospecto con status "Aprobado"

### **Notas importantes**:
- Las observaciones se almacenan en una tabla separada (`CLIENT_OBSERVATIONS`) 
- Acepta fechas en formato ISO 8601: `2025-11-25T06:00:00.000Z`
- Al actualizar un cliente, todas las observaciones anteriores se eliminan y se insertan las nuevas
- El campo `observations` es opcional - puedes crear/actualizar clientes sin observaciones
- El sistema automáticamente convierte fechas ISO a formato de fecha para PostgreSQL
