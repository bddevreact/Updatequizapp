const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const fileUpload = require('express-fileupload');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('express-async-errors');
require('dotenv').config();

// Set NODE_ENV to production for Railway deployment
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const quizRoutes = require('./routes/quiz');
const tournamentRoutes = require('./routes/tournaments');
const transactionRoutes = require('./routes/transactions');
const referralRoutes = require('./routes/referrals');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const telegramRoutes = require('./routes/telegram');
const telegramWebAppRoutes = require('./routes/telegramWebApp');
const healthRoutes = require('./routes/health');
const activitiesRoutes = require('./routes/activities');
const achievementsRoutes = require('./routes/achievements');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const auth = require('./middleware/auth');
const adminAuth = require('./middleware/auth').admin;

// Import services
const logger = require('./utils/logger');
const { connectDB } = require('./config/database');
const socketHandler = require('./services/socketHandler');

// Import models (to ensure they are registered)
require('./models/User');
require('./models/Quiz');
require('./models/Tournament');
require('./models/Transaction');
require('./models/Referral');
require('./models/Task');
require('./models/Achievement');
require('./models/Activity');

const app = express();
const server = createServer(app);

// Trust proxy for Railway deployment
app.set('trust proxy', 1);

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000', 
  'http://127.0.0.1:3000', 
  'http://localhost:5173',
  'http://localhost:3001',
  'https://animated-klepon-616113.netlify.app',
  'https://your-frontend-domain.netlify.app',
  'https://your-frontend-domain.vercel.app'
];

// Add CORS_ORIGIN from environment if provided
if (process.env.CORS_ORIGIN) {
  allowedOrigins.push(process.env.CORS_ORIGIN);
}

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000, // limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting in development mode
    if (process.env.NODE_ENV === 'development') {
      return true;
    }
    // Skip rate limiting for health checks in production
    return req.path === '/api/health';
  }
});

app.use(limiter);

// Log CORS configuration
console.log('CORS Configuration:');
console.log('Allowed Origins:', allowedOrigins);
console.log('CORS_ORIGIN env var:', process.env.CORS_ORIGIN);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS: Blocked origin:', origin);
      console.log('CORS: Allowed origins:', allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Cache-Control',
    'Pragma',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  optionsSuccessStatus: 200
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Data sanitization middleware
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// File upload middleware
app.use(fileUpload({
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB
  },
  abortOnLimit: true,
  responseOnLimit: 'File size limit has been reached',
  uploadTimeout: 60000, // 60 seconds
  useTempFiles: true,
  tempFileDir: process.env.UPLOAD_PATH || './uploads/temp'
}));

// Static files
app.use('/uploads', express.static(process.env.UPLOAD_PATH || './uploads'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', auth, userRoutes);
app.use('/api/quiz', auth, quizRoutes);
app.use('/api/tournaments', auth, tournamentRoutes);
app.use('/api/transactions', auth, transactionRoutes);
app.use('/api/referrals', auth, referralRoutes);
app.use('/api/admin', adminAuth, adminRoutes);
app.use('/api/upload', auth, uploadRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/telegram-webapp', telegramWebAppRoutes);
app.use('/api', healthRoutes);
app.use('/api/activities', auth, activitiesRoutes);
app.use('/api/achievements', auth, achievementsRoutes);

// WebSocket connection handling
socketHandler(io);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Process terminated');
    mongoose.connection.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Process terminated');
    mongoose.connection.close();
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Promise Rejection:', err);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  logger.info(`📱 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  logger.info(`🔗 API Base URL: ${process.env.APP_URL || 'http://localhost:5000'}/api`);
  logger.info(`🌐 WebSocket running on port ${process.env.WS_PORT || 5001}`);
});

module.exports = { app, server, io };
