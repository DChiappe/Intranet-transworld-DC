const mysql = require('mysql2');

// Pool de conexiones (recomendado)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'intranet_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'intranet',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
