-- Migración: Renombrar hearing_date a placement_date y crear registros iniciales en HEARINGS
-- IMPORTANTE: Ejecutar después de crear la tabla HEARINGS

BEGIN;

-- 1. Agregar nueva columna placement_date
ALTER TABLE CLIENTS ADD COLUMN placement_date DATE;

-- 2. Migrar datos de hearing_date a placement_date
UPDATE CLIENTS 
SET placement_date = hearing_date 
WHERE hearing_date IS NOT NULL;

-- 3. Migrar datos existentes a la tabla HEARINGS
-- Crear un registro de audiencia inicial para cada cliente que tenga hearing_date
INSERT INTO HEARINGS (client_id, hearing_date, hearing_location, attendees, notes)
SELECT 
    client_id,
    hearing_date,
    COALESCE(court_name, 'Lugar por definir') as hearing_location,
    ARRAY[COALESCE(lawyer_name, 'Abogado por definir')] as attendees,
    'Audiencia migrada desde el sistema anterior' as notes
FROM CLIENTS 
WHERE hearing_date IS NOT NULL;

-- 4. Eliminar la columna hearing_date original
ALTER TABLE CLIENTS DROP COLUMN hearing_date;

-- 5. Agregar comentario a la nueva columna
COMMENT ON COLUMN CLIENTS.placement_date IS 'Fecha de colocación del cliente (anteriormente fecha de audiencia)';

COMMIT;

-- Verificar migración
SELECT 'Clientes con placement_date:' as info, COUNT(*) as total FROM CLIENTS WHERE placement_date IS NOT NULL
UNION ALL
SELECT 'Audiencias creadas:', COUNT(*) FROM HEARINGS;