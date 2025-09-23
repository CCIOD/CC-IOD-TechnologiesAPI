-- Script de migración para observaciones de clientes
-- Fecha: 29 de agosto de 2025

-- 1. Crear la nueva tabla CLIENT_OBSERVATIONS
CREATE TABLE IF NOT EXISTS CLIENT_OBSERVATIONS (
    id SERIAL PRIMARY KEY,
    client_id INT NOT NULL,
    observation_date DATE NOT NULL,
    observation TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES CLIENTS(client_id) ON DELETE CASCADE
);

-- 2. Migrar observaciones existentes de la tabla CLIENTS
-- Solo migrar registros que tengan observaciones no vacías
INSERT INTO CLIENT_OBSERVATIONS (client_id, observation_date, observation)
SELECT 
    client_id,
    hearing_date, -- Usar la fecha de audiencia como fecha de observación
    observations
FROM CLIENTS 
WHERE observations IS NOT NULL 
  AND observations != '' 
  AND TRIM(observations) != '';

-- 3. Verificar la migración (opcional - comentar después de verificar)
-- SELECT 
--     c.client_id,
--     c.defendant_name,
--     c.observations as old_observations,
--     co.observation_date,
--     co.observation as new_observation
-- FROM CLIENTS c
-- LEFT JOIN CLIENT_OBSERVATIONS co ON c.client_id = co.client_id
-- WHERE c.observations IS NOT NULL AND c.observations != '';

-- 4. Eliminar la columna observations de la tabla CLIENTS
-- ¡ADVERTENCIA! Esto eliminará permanentemente los datos de observaciones de la tabla original
-- Descomenta la siguiente línea solo después de verificar que la migración fue exitosa
-- ALTER TABLE CLIENTS DROP COLUMN IF EXISTS observations;

-- 5. Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_client_observations_client_id ON CLIENT_OBSERVATIONS(client_id);
CREATE INDEX IF NOT EXISTS idx_client_observations_date ON CLIENT_OBSERVATIONS(observation_date);

-- Verificación final - Contar registros migrados
SELECT 
    'Total clientes' as descripcion,
    COUNT(*) as cantidad
FROM CLIENTS
UNION ALL
SELECT 
    'Clientes con observaciones originales' as descripcion,
    COUNT(*) as cantidad
FROM CLIENTS 
WHERE observations IS NOT NULL AND observations != '' AND TRIM(observations) != ''
UNION ALL
SELECT 
    'Observaciones de clientes migradas' as descripcion,
    COUNT(*) as cantidad
FROM CLIENT_OBSERVATIONS;
