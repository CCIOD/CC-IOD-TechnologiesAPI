-- Agregar campos folio del contrato y tipo de brazalete a la tabla CLIENTS
-- Fecha: 2025-09-22
-- Descripción: Se agregan dos nuevos campos VARCHAR para el folio del contrato y el tipo de brazalete

ALTER TABLE CLIENTS 
ADD COLUMN contract_folio VARCHAR(255),
ADD COLUMN bracelet_type VARCHAR(255);

-- Comentarios para documentar los campos
COMMENT ON COLUMN CLIENTS.contract_folio IS 'Folio del contrato del cliente';
COMMENT ON COLUMN CLIENTS.bracelet_type IS 'Tipo de brazalete asignado al cliente';

-- Verificar que los campos se agregaron correctamente
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'clients' 
AND column_name IN ('contract_folio', 'bracelet_type');

|-- Cambiar el tipo de dato de contract_number de VARCHAR a INTEGER
-- Fecha: 2025-09-22
-- Descripción: Se convierte el campo contract_number a tipo INTEGER para ordenamiento numérico correcto

-- Primero verificar el tipo actual
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'clients' AND column_name = 'contract_number';

-- Cambiar el tipo de dato a INTEGER
-- Si hay valores NULL o no numéricos, se convertirán a NULL
ALTER TABLE CLIENTS 
ALTER COLUMN contract_number TYPE INTEGER USING (
  CASE 
    WHEN contract_number ~ '^[0-9]+$' THEN contract_number::INTEGER
    ELSE NULL
  END
);

-- Verificar que el cambio se aplicó correctamente
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'clients' AND column_name = 'contract_number';

-- Comentario actualizado
COMMENT ON COLUMN CLIENTS.contract_number IS 'Número de contrato del cliente (tipo entero)';

-- Cambiar el tipo de dato de contract_number de INTEGER a BIGINT
-- Fecha: 2025-09-22
-- Descripción: Se convierte el campo contract_number a BIGINT para manejar números de contrato más grandes

-- Primero verificar el tipo actual
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'clients' AND column_name = 'contract_number';

-- Cambiar el tipo de dato a BIGINT
ALTER TABLE CLIENTS 
ALTER COLUMN contract_number TYPE BIGINT;

-- Verificar que el cambio se aplicó correctamente
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'clients' AND column_name = 'contract_number';

-- Comentario actualizado
COMMENT ON COLUMN CLIENTS.contract_number IS 'Número de contrato del cliente (tipo BIGINT para números grandes)';