-- ==========================================
-- ARREGLO RÁPIDO PARA QUE FUNCIONE /clients
-- ==========================================

-- Crear tabla CLIENT_CONTACTS si no existe
CREATE TABLE IF NOT EXISTS CLIENT_CONTACTS (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    phone VARCHAR(10) NOT NULL,
    contact_name VARCHAR(255) NOT NULL,
    relationship_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla CLIENT_OBSERVATIONS si no existe
CREATE TABLE IF NOT EXISTS CLIENT_OBSERVATIONS (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    observation_date DATE NOT NULL,
    observation TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agregar columnas que faltan en CLIENTS (si no existen)
DO $$ 
BEGIN
    -- contract_date
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'clients' AND column_name = 'contract_date') THEN
        ALTER TABLE CLIENTS ADD COLUMN contract_date DATE;
    END IF;
    
    -- contract_duration_months
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'clients' AND column_name = 'contract_duration_months') THEN
        ALTER TABLE CLIENTS ADD COLUMN contract_duration_months INTEGER;
    END IF;
    
    -- payment_day
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'clients' AND column_name = 'payment_day') THEN
        ALTER TABLE CLIENTS ADD COLUMN payment_day INTEGER;
    END IF;
END $$;

-- Agregar claves foráneas si no existen
DO $$
BEGIN
    -- FK para CLIENT_CONTACTS
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'fk_client_contacts_client') THEN
        ALTER TABLE CLIENT_CONTACTS 
        ADD CONSTRAINT fk_client_contacts_client 
        FOREIGN KEY (client_id) REFERENCES CLIENTS(client_id) ON DELETE CASCADE;
    END IF;
    
    -- FK para CLIENT_OBSERVATIONS
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'fk_client_observations_client') THEN
        ALTER TABLE CLIENT_OBSERVATIONS 
        ADD CONSTRAINT fk_client_observations_client 
        FOREIGN KEY (client_id) REFERENCES CLIENTS(client_id) ON DELETE CASCADE;
    END IF;
END $$;

-- Verificar que todo está listo
SELECT 'VERIFICACIÓN FINAL' as status;

SELECT table_name, 'Tabla creada' as status
FROM information_schema.tables 
WHERE table_name IN ('client_contacts', 'client_observations')
  AND table_schema = 'public'

UNION ALL

SELECT column_name, 'Columna agregada' as status
FROM information_schema.columns 
WHERE table_name = 'clients' 
  AND column_name IN ('contract_date', 'contract_duration_months', 'payment_day');

SELECT 'El endpoint /clients debería funcionar ahora' as mensaje;
