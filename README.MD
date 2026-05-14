# CC-IOD Technologies API

**Sistema de Gestión de Clientes, Contratos y Pagos**

## 📋 Descripción

API backend construida con Express.js y TypeScript para la gestión integral de:
- ✅ Clientes y prospectos
- ✅ Contratos y vigencia
- ✅ Pagos y finanzas
- ✅ Audiencias y renovaciones
- ✅ Auditoría y registros
- ✅ Operaciones administrativas

## 🚀 Características Principales

### Vigencia de Contrato (NEW ✨)
- Cálculo automático de días restantes
- Registro de renovaciones con documentación
- Validaciones de duplicados
- Transacciones atómicas

### Control de Pagos (NEW ✨)
- CRUD completo de pagos
- Sumatorias automáticas (pagado/adeudado)
- Estadísticas por tipo de pago
- Historial y resumen financiero

### Módulos Existentes
- Gestión de clientes
- Operaciones
- Auditoría
- Usuarios y roles
- Archivos y documentos

## 📦 Requisitos Previos

```bash
Node.js >= 18
PostgreSQL >= 12
npm o yarn
```

## 🔧 Instalación

```bash
# Instalar dependencias
npm install

# Instalar tipos de PostgreSQL
npm install pg
npm install --save-dev @types/pg

# Configurar variables de entorno
cp .env.template .env.local

# Ejecutar servidor en desarrollo
npm run dev

# Compilar para producción
npm run build

# Ejecutar en producción
npm start
```

## 📂 Estructura del Proyecto

```
src/
├── controllers/          # Controladores HTTP
├── services/            # Lógica de negocio
│   ├── renewal.service.ts      ← NUEVO
│   ├── payment.service.ts      ← NUEVO
│   └── ...
├── models/              # Interfaces y tipos
│   ├── renewal.interface.ts    ← NUEVO
│   ├── payment.interface.ts    ← NUEVO
│   └── ...
├── routes/              # Definición de rutas
│   ├── paymentsRoutes.ts       ← NUEVO
│   └── ...
├── middlewares/         # Middlewares
├── helpers/             # Funciones auxiliares
├── database/            # Conexión a DB
└── config/              # Configuración

```

## 🛣️ Endpoints Principales

### Clientes
```
GET    /clientes                    - Listar todos
GET    /clientes/:id                - Obtener por ID
POST   /clientes                    - Crear nuevo
PUT    /clientes/:id                - Actualizar
DELETE /clientes/:id                - Eliminar
```

### Vigencia de Contrato (NEW)
```
GET    /clientes/:id/vigencia              - Obtener vigencia actual
PUT    /clientes/:id/renovar-contrato     - Renovar contrato
```

### Pagos (NEW)
```
POST   /pagos                       - Crear pago
GET    /pagos/:clientId             - Listar pagos por cliente
GET    /pagos/:clientId/resumen     - Resumen financiero
GET    /pagos/:clientId/por-tipo    - Estadísticas por tipo
PUT    /pagos/:id                   - Editar pago
DELETE /pagos/:id                   - Eliminar pago
```

### Otros Módulos
```
GET    /prospects                   - Prospectos
GET    /carriers                    - Empresas transportistas
GET    /operations                  - Operaciones
GET    /users                       - Usuarios
GET    /audit                       - Auditoria
GET    /prosecutor-docs             - Documentos de fiscalía
```

## 🔐 Autenticación

Todos los endpoints requieren JWT token:

```
Authorization: Bearer {token}
```

Los tokens se obtienen mediante:
```
POST /auth/login
```

## 📚 DOCUMENTACIÓN PARA FRONTEND

### Implementación de Vigencia de Contrato
- **Archivo:** `FRONTEND_CONTRACT_VALIDITY.md`
- **Contiene:** Endpoints, tipos TypeScript, componentes React, servicios HTTP
- **Componentes:** ContractValidity.tsx, RenewalModal.tsx
- **Servicios:** contractService.ts

### Implementación de Pagos
- **Archivo:** `FRONTEND_PAYMENTS.md`
- **Contiene:** Endpoints, tipos TypeScript, componentes React, servicios HTTP
- **Componentes:** PaymentsManager.tsx, PaymentTable.tsx, PaymentModal.tsx, PaymentSummary.tsx
- **Servicios:** paymentService.ts

### Guía de Integración General
- **Archivo:** `FRONTEND_INTEGRATION_GUIDE.md`
- **Contiene:** Estructura completa, checklist de 50+ items, troubleshooting
- **Incluye:** Fases de implementación organizadas y ordenadas

### Resumen Ejecutivo
- **Archivo:** `IMPLEMENTATION_SUMMARY.md`
- **Contiene:** Resumen de todo lo implementado, especificaciones técnicas, flujos de trabajo

## 🗄️ Base de Datos

### Tablas Nuevas

#### contract_renewals
```sql
CREATE TABLE CONTRACT_RENEWALS (
    renewal_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES CLIENTS(client_id),
    renewal_date DATE NOT NULL,
    months_added INTEGER NOT NULL,
    renewal_document_url VARCHAR,
    previous_expiration_date DATE,
    new_expiration_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### payments
```sql
CREATE TABLE PAYMENTS (
    payment_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES CLIENTS(client_id),
    payment_date DATE NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('contado', 'credito', 'viatico', 'otro')),
    observations VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Campos a Agregar a CLIENTS
```sql
ALTER TABLE CLIENTS ADD COLUMN IF NOT EXISTS months_contracted INTEGER;
ALTER TABLE CLIENTS ADD COLUMN IF NOT EXISTS contract_expiration_date DATE;
```

## 🧪 Testing

```bash
# Ejecutar tests
npm test

# Con cobertura
npm test -- --coverage
```

## 📝 Variables de Entorno

```env
# Servidor
PORT=<port>
NODE_ENV=development

# Base de datos (PostgreSQL)
PGHOST=<host>
PGPORT=<port>
PGDATABASE=<database_name>
PGUSER=<user>
PGPASSWORD=<password>

# JWT
JWT_SECRET=<secret>
JWT_EXPIRATION=24h

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=<connection_string>
AZURE_CONTAINER_NAME=<container_name>

# Email
SMTP_HOST=<host>
SMTP_PORT=<port>
SMTP_USER=<user>
SMTP_PASSWORD=<password>

# CORS
CORS_ORIGIN=<frontend_origin>
```

> ⚠️ Nunca subir el archivo `.env` al repositorio. Usar `.env.template` como referencia.

## 🔄 Flujos de Trabajo

### Vigencia de Contrato
1. GET `/clientes/:id/vigencia` - Obtener estado actual
2. PUT `/clientes/:id/renovar-contrato` - Renovar agregando meses
3. Datos se actualizan automáticamente en CLIENTS y CONTRACT_RENEWALS

### Control de Pagos
1. POST `/pagos` - Registrar nuevo pago
2. GET `/pagos/:clientId` - Obtener historial
3. GET `/pagos/:clientId/resumen` - Obtener sumatorias
4. PUT `/pagos/:id` - Editar pago (recalcula sumatorias)
5. DELETE `/pagos/:id` - Eliminar pago (recalcula sumatorias)

## 🚨 Manejo de Errores

La API retorna errores consistentes:

```json
{
  "success": false,
  "message": "Descripción del error",
  "data": null
}
```

Códigos HTTP:
- `200` - OK
- `201` - Creado
- `400` - Solicitud inválida
- `401` - No autenticado
- `403` - No autorizado
- `404` - No encontrado
- `500` - Error del servidor

## 📊 Logging

Toda la aplicación incluye logging detallado:

```
✅ logInfo()    - Información general
✅ logSuccess() - Operaciones exitosas
✅ logWarning() - Advertencias
✅ logError()   - Errores críticos
```

Los logs incluyen:
- Timestamp
- Nivel de severidad
- Usuario que realizó la acción
- Detalles de la operación
- Errores si aplica

## 🔐 Seguridad

- ✅ JWT Authentication
- ✅ SQL Injection Prevention (prepared statements)
- ✅ CORS Configuration
- ✅ Input Validation
- ✅ Rate Limiting (middleware)
- ✅ Transaction Support

## 📈 Performance

- Índices de base de datos configurados
- Paginación soportada
- Caching de datos cuando es posible
- Queries optimizadas
- Conexión de pool a DB

## 🤝 Contribuciones

1. Crear rama: `git checkout -b feature/nueva-funcionalidad`
2. Commit: `git commit -am 'Agregar funcionalidad'`
3. Push: `git push origin feature/nueva-funcionalidad`
4. Pull Request

## 📝 Licencia

ISC

## 📞 Contacto

Para reportar bugs o sugerir mejoras, crear issue en el repositorio.

---

**Última actualización:** 28 de octubre de 2025
**Versión:** 1.0.0

