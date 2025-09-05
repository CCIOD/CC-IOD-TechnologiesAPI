-- Script de migración para observaciones de prospectos
-- Fecha: 28 de agosto de 2025

-- 1. Crear la nueva tabla PROSPECT_OBSERVATIONS
CREATE TABLE IF NOT EXISTS PROSPECT_OBSERVATIONS (
    id SERIAL PRIMARY KEY,
    prospect_id INT NOT NULL,
    observation_date DATE NOT NULL,
    observation TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prospect_id) REFERENCES PROSPECTS(prospect_id) ON DELETE CASCADE
);

-- 2. Migrar observaciones existentes de la tabla PROSPECTS
-- Solo migrar registros que tengan observaciones no vacías
INSERT INTO PROSPECT_OBSERVATIONS (prospect_id, observation_date, observation)
SELECT 
    prospect_id,
    date, -- Usar la fecha del prospecto como fecha de observación
    observations
FROM PROSPECTS 
WHERE observations IS NOT NULL 
  AND observations != '' 
  AND TRIM(observations) != '';

-- 3. Verificar la migración (opcional - comentar después de verificar)
-- SELECT 
--     p.prospect_id,
--     p.name,
--     p.observations as old_observations,
--     po.observation_date,
--     po.observation as new_observation
-- FROM PROSPECTS p
-- LEFT JOIN PROSPECT_OBSERVATIONS po ON p.prospect_id = po.prospect_id
-- WHERE p.observations IS NOT NULL AND p.observations != '';

-- 4. Eliminar la columna observations de la tabla PROSPECTS
-- ¡ADVERTENCIA! Esto eliminará permanentemente los datos de observaciones de la tabla original
-- Descomenta la siguiente línea solo después de verificar que la migración fue exitosa
-- ALTER TABLE PROSPECTS DROP COLUMN IF EXISTS observations;

-- 5. Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_prospect_observations_prospect_id ON PROSPECT_OBSERVATIONS(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_observations_date ON PROSPECT_OBSERVATIONS(observation_date);

-- Verificación final - Contar registros migrados
SELECT 
    'Total prospectos' as descripcion,
    COUNT(*) as cantidad
FROM PROSPECTS
UNION ALL
SELECT 
    'Prospectos con observaciones originales' as descripcion,
    COUNT(*) as cantidad
FROM PROSPECTS 
WHERE observations IS NOT NULL AND observations != '' AND TRIM(observations) != ''
UNION ALL
SELECT 
    'Observaciones migradas' as descripcion,
    COUNT(*) as cantidad
FROM PROSPECT_OBSERVATIONS;
