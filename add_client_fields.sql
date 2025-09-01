-- Script para agregar nuevos campos a la tabla CLIENTS
-- Fecha: 1 de septiembre de 2025

-- 1. Agregar nuevas columnas a la tabla CLIENTS
ALTER TABLE CLIENTS ADD COLUMN IF NOT EXISTS contract_date DATE;
ALTER TABLE CLIENTS ADD COLUMN IF NOT EXISTS contract_document TEXT;
ALTER TABLE CLIENTS ADD COLUMN IF NOT EXISTS contract_duration VARCHAR(100);
ALTER TABLE CLIENTS ADD COLUMN IF NOT EXISTS payment_day INTEGER CHECK (payment_day >= 1 AND payment_day <= 31);

-- 2. Modificar la columna contract_number para que sea VARCHAR en lugar de INTEGER
-- Primero crear una nueva columna temporal
ALTER TABLE CLIENTS ADD COLUMN contract_number_temp VARCHAR(50);

-- Copiar datos existentes convirtiendo a string
UPDATE CLIENTS SET contract_number_temp = contract_number::VARCHAR WHERE contract_number IS NOT NULL;

-- Eliminar la columna antigua
ALTER TABLE CLIENTS DROP COLUMN contract_number;

-- Renombrar la columna temporal
ALTER TABLE CLIENTS RENAME COLUMN contract_number_temp TO contract_number;

-- 3. Crear índices para mejorar el rendimiento (opcional)
CREATE INDEX IF NOT EXISTS idx_clients_contract_date ON CLIENTS(contract_date);
CREATE INDEX IF NOT EXISTS idx_clients_payment_day ON CLIENTS(payment_day);

-- 4. Verificación de los cambios
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'clients' 
ORDER BY ordinal_position;
