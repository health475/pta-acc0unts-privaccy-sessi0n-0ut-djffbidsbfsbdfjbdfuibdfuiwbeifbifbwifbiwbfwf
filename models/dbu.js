

const mysql = require('mysql2');
require('dotenv').config();

// MySQL database configuration using pool
const dbu = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER1,
  password: process.env.DB_PASSWORD1,
  database: process.env.DB_DATABASE1,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

// Test the connection
dbu.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to UserDB:', err);
    return;
  }
  console.log('Connected to UserDb');
  connection.release();
});

// Export the pool
module.exports = dbu;
