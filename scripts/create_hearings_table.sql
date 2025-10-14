-- Crear tabla HEARINGS para múltiples audiencias por cliente
-- Esta tabla reemplaza el campo hearing_date único con múltiples registros

CREATE TABLE IF NOT EXISTS HEARINGS (
    hearing_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES CLIENTS(client_id) ON DELETE CASCADE,
    hearing_date DATE NOT NULL,
    hearing_location VARCHAR(500) NOT NULL,
    attendees TEXT[] DEFAULT '{}', -- Array de asistentes como strings
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_hearings_client_id ON HEARINGS(client_id);
CREATE INDEX IF NOT EXISTS idx_hearings_date ON HEARINGS(hearing_date);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_hearings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updated_at
CREATE TRIGGER trigger_hearings_updated_at
    BEFORE UPDATE ON HEARINGS
    FOR EACH ROW
    EXECUTE FUNCTION update_hearings_updated_at();

COMMENT ON TABLE HEARINGS IS 'Tabla para almacenar múltiples audiencias asociadas a clientes';
COMMENT ON COLUMN HEARINGS.client_id IS 'ID del cliente asociado a la audiencia';
COMMENT ON COLUMN HEARINGS.hearing_date IS 'Fecha de la audiencia';
COMMENT ON COLUMN HEARINGS.hearing_location IS 'Lugar donde se llevará a cabo la audiencia';
COMMENT ON COLUMN HEARINGS.attendees IS 'Array de nombres de personas que asistirán a la audiencia';
COMMENT ON COLUMN HEARINGS.notes IS 'Notas adicionales sobre la audiencia';