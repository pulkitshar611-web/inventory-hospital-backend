require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import configurations and middleware
const { testConnection } = require('./config');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const facilityRoutes = require('./routes/facilityRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const requisitionRoutes = require('./routes/requisitionRoutes.js');
const dispatchRoutes = require('./routes/dispatchRoutes');
const assetRoutes = require('./routes/assetRoutes');
const reportRoutes = require('./routes/reportRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const departmentRoutes = require('./routes/departmentroutes');
const returnsRecallRoutes = require('./routes/returnsRecallRoutes');
const warehouseRequisitionRoutes = require('./routes/warehouseRequisitionRoutes');
const facilityRequisitionRoutes = require('./routes/facilityRequisitionRoutes');
const inventoryFacilityRoutes = require('./routes/inventoryFacilityRoutes');
const receiptsRoutes = require('./routes/receiptsRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.set('trust proxy', 1);

app.use(helmet());
// app.use(cors({
//   origin: process.env.NODE_ENV === 'production' ? 
//     ['https://yourdomain.com'] : 
//     ['http://localhost:3000', 'http://localhost:5173','https://hospital-inventory-management.netlify.app'],
//   credentials: true
// }));


const allowedOrigins = [
  'https://steady-griffin-4040a6.netlify.app',
  'http://localhost:5173',
  'https://hospitalmanagament.netlify.app',
  'https://resonant-kangaroo-a7cd11.netlify.app',
  'https://hospital-inventory2.netlify.app',
  'https://hospital-inventory-management-new.netlify.app',
  'https://inventory.francisfosugroup.com',
  'https://hospital-inventory.kiaantechnology.com'
];

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true
}));


// Rate limiting
// const limiter = rateLimit({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
//   message: {
//     error: 'Too many requests from this IP, please try again later.'
//   }
// });
// app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
// app.get('/health', (req, res) => {
//   res.status(200).json({
//     status: 'OK',
//     message: 'Hospital Inventory API is running',
//     timestamp: new Date().toISOString(),
//     environment: process.env.NODE_ENV || 'development'
//   });
// });

const morgan = require('morgan');
app.use(morgan(':method :url :status :response-time ms - :res[content-length]'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/facilities', facilityRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/requisitions', requisitionRoutes);
app.use('/api/dispatches', dispatchRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use('/api/department', departmentRoutes);
app.use("/api/returns-recall", returnsRecallRoutes);
app.use("/api/warehouse-requisitions", warehouseRequisitionRoutes);

app.use("/api/facility-requisitions", facilityRequisitionRoutes);
app.use("/api/inventory-facility", inventoryFacilityRoutes);
app.use("/api/receipts", receiptsRoutes);
app.use("/api/suppliers", require('./routes/supplierRoutes'));
app.use("/api/batches", require('./routes/batchRoutes'));
app.use("/api/notifications", require('./routes/notificationRoutes'));
app.use("/api/incoming-goods", require('./routes/incomingGoodsRoutes'));


// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

// Global error handler
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Test database connection (non-blocking)
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.warn('⚠️  Starting server without database connection. Some features may not work.');
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      if (!dbConnected) {
        console.log('⚠️  Note: Database connection failed. Please check your database configuration.');
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    // Don't exit - let user fix the issue
    console.error('Please check your configuration and try again.');
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
