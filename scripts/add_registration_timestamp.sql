-- Agregar campo para registrar el momento de conversión de prospecto a cliente
ALTER TABLE CLIENTS 
ADD COLUMN registered_at TIMESTAMP;

-- Comentario: Este campo almacenará el momento exacto cuando un prospecto se registra como cliente
COMMENT ON COLUMN CLIENTS.registered_at IS 'Timestamp que registra el momento exacto cuando el prospecto se convierte en cliente';

-- Para los clientes existentes, establecer la fecha de registro igual a la fecha de contrato si existe
UPDATE CLIENTS 
SET registered_at = contract_date 
WHERE contract_date IS NOT NULL AND registered_at IS NULL;

-- Para clientes sin fecha de contrato, usar un timestamp por defecto (fecha actual)
UPDATE CLIENTS 
SET registered_at = hearing_date
WHERE registered_at IS NULL;

