const express = require('express');
const logger = require('../utils/logger');
const { getConnectionStatus } = require('../config/database');

const router = express.Router();

// @route   OPTIONS /api/health
// @desc    Handle CORS preflight requests
// @access  Public
router.options('/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// @route   GET /api/health
// @desc    Health check endpoint
// @access  Public
router.get('/health', (req, res) => {
  try {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      version: process.env.APP_VERSION || '1.0.0',
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
      },
      database: getConnectionStatus() ? 'connected' : 'disconnected',
      services: {
        auth: 'operational',
        quiz: 'operational',
        tournament: 'operational',
        transaction: 'operational',
        admin: 'operational',
        upload: 'operational',
        websocket: 'operational'
      }
    };

    res.status(200).json({
      success: true,
      data: healthData,
      message: 'Service is healthy'
    });

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'health_check'
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Health check failed'
      }
    });
  }
});

// @route   GET /api/status
// @desc    Detailed status endpoint
// @access  Public
router.get('/status', (req, res) => {
  try {
    const statusData = {
      server: {
        status: 'running',
        uptime: process.uptime(),
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        apiVersion: process.env.API_VERSION || 'v1'
      },
      features: {
        aiQuestions: process.env.ENABLE_AI_QUESTIONS === 'true',
        telegramIntegration: process.env.ENABLE_TELEGRAM_INTEGRATION === 'true',
        analytics: process.env.ENABLE_ANALYTICS === 'true',
        emailNotifications: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
        pushNotifications: process.env.ENABLE_PUSH_NOTIFICATIONS === 'true'
      },
      limits: {
        maxFileSize: process.env.MAX_FILE_SIZE || '5MB',
        rateLimitWindow: process.env.RATE_LIMIT_WINDOW_MS || '15 minutes',
        rateLimitMax: process.env.RATE_LIMIT_MAX_REQUESTS || 100
      }
    };

    res.json({
      success: true,
      data: statusData,
      message: 'Status retrieved successfully'
    });

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'status_check'
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_CHECK_FAILED',
        message: 'Status check failed'
      }
    });
  }
});

// @route   GET /api/info
// @desc    API information endpoint
// @access  Public
router.get('/info', (req, res) => {
  try {
    const infoData = {
      name: process.env.APP_NAME || 'CryptoQuiz API',
      version: process.env.APP_VERSION || '1.0.0',
      description: 'Comprehensive backend API for CryptoQuiz Telegram WebApp',
      author: 'CryptoQuiz Team',
      license: 'MIT',
      endpoints: {
        auth: '/api/auth',
        users: '/api/users',
        quiz: '/api/quiz',
        tournaments: '/api/tournaments',
        transactions: '/api/transactions',
        admin: '/api/admin',
        upload: '/api/upload',
        telegram: '/api/telegram',
        telegramWebapp: '/api/telegram-webapp'
      },
      features: [
        'JWT Authentication',
        'User Management',
        'Quiz System',
        'Tournament Management',
        'Financial Transactions',
        'Admin Panel',
        'File Upload',
        'WebSocket Support',
        'Telegram Integration',
        'Real-time Notifications'
      ],
      technologies: [
        'Node.js',
        'Express.js',
        'MongoDB',
        'Mongoose',
        'Socket.io',
        'JWT',
        'Multer',
        'Sharp',
        'Winston',
        'Helmet',
        'CORS'
      ]
    };

    res.json({
      success: true,
      data: infoData,
      message: 'API information retrieved successfully'
    });

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'api_info'
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INFO_RETRIEVAL_FAILED',
        message: 'Failed to retrieve API information'
      }
    });
  }
});

module.exports = router;