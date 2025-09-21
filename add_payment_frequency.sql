-- Agregar campo payment_frequency a la tabla CLIENTS con valores específicos
ALTER TABLE CLIENTS 
ADD COLUMN payment_frequency VARCHAR(20) CHECK (payment_frequency IN ('Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Contado'));

-- Comentario: Este campo almacenará la frecuencia de pago del cliente
COMMENT ON COLUMN CLIENTS.payment_frequency IS 'Frecuencia de pago del cliente: Mensual, Bimestral, Trimestral, Semestral o Contado';

-- Establecer un valor por defecto para los clientes existentes (opcional)
-- UPDATE CLIENTS SET payment_frequency = 'Mensual' WHERE payment_frequency IS NULL;
