import pkg from "pg";

const { Pool } = pkg;
const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || "5432"),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  allowExitOnIdle: true,
  ssl: isProduction ? { rejectUnauthorized: false } : false, // Azure requiere SSL siempre
  connectionTimeoutMillis: 30000, // 30 segundos timeout
  idleTimeoutMillis: 30000, // 30 segundos idle timeout
  max: 10, // máximo 10 conexiones
  min: 2, // mínimo 2 conexiones
  query_timeout: 60000, // 60 segundos para queries
});

// Manejo de errores de conexión
pool.on('error', (err) => {
  console.error('Error inesperado en el cliente de la base de datos:', err);
});

pool.on('connect', () => {
  console.log('Conectado a la base de datos PostgreSQL');
});

// Verificar conexión al inicializar
pool.connect()
  .then(client => {
    console.log('Pool de conexiones inicializado correctamente');
    client.release();
  })
  .catch(err => {
    console.error('Error al conectar con la base de datos:', err);
  });
