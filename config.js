const mysql = require('mysql2/promise');
const cloudinary = require('cloudinary').v2;

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'switchback.proxy.rlwy.net',
  user: process.env.DB_USER || 'root',
  password:  'wvtbWVozAzPoLzIWnQeuMGFpEmHMdkbv',
  database: process.env.DB_NAME || 'railway',
  port: process.env.DB_PORT || 56348,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000
}; 


// Create connection pool
const pool = mysql.createPool(dbConfig);

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dkqcqrrbp',
  api_key: process.env.CLOUDINARY_API_KEY || '418838712271323',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'p12EKWICdyHWx8LcihuWYqIruWQ'
});

// Test database connection
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = {
  pool,
  cloudinary,
  testConnection,
  dbConfig
};
