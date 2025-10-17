const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const User = require('../models/User');
const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');
const Quiz = require('../models/Quiz');
const { authenticateAdmin } = require('../utils/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: errors.array()
      }
    });
  }
  next();
};

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private (Admin only)
router.get('/dashboard',
  authenticateAdmin,
  async (req, res) => {
    try {
      const adminId = req.user._id;

      // Get user statistics
      const userStats = await User.aggregate([
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            activeUsers: { $sum: { $cond: [{ $gte: ['$lastActivity', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] }, 1, 0] } },
            verifiedUsers: { $sum: { $cond: ['$isVerified', 1, 0] } },
            blockedUsers: { $sum: { $cond: ['$isBlocked', 1, 0] } },
            totalBalance: { $sum: '$balance' },
            totalPlayableBalance: { $sum: '$playableBalance' },
            totalBonusBalance: { $sum: '$bonusBalance' },
            totalEarned: { $sum: '$totalEarned' },
            totalDeposited: { $sum: '$totalDeposited' },
            totalWithdrawn: { $sum: '$totalWithdrawn' }
          }
        }
      ]);

      // Get transaction statistics
      const transactionStats = await Transaction.getTransactionStats('all');

      // Get tournament statistics
      const tournamentStats = await Tournament.getTournamentStats();

      // Get quiz statistics
      const quizStats = await Quiz.getStatistics();

      // Get recent activities
      const recentUsers = await User.find()
        .select('username email createdAt lastActivity')
        .sort({ createdAt: -1 })
        .limit(5);

      const recentTransactions = await Transaction.find()
        .populate('userId', 'username')
        .sort({ createdAt: -1 })
        .limit(5);

      const recentTournaments = await Tournament.find()
        .populate('createdBy', 'username')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get pending approvals
      const pendingDeposits = await Transaction.find({
        type: 'deposit',
        status: 'pending'
      })
      .populate('userId', 'username email')
      .sort({ createdAt: 1 })
      .limit(10);

      const pendingWithdrawals = await Transaction.find({
        type: 'withdrawal',
        status: 'pending'
      })
      .populate('userId', 'username email')
      .sort({ createdAt: 1 })
      .limit(10);

      const dashboardData = {
        overview: {
          users: userStats[0] || {
            totalUsers: 0,
            activeUsers: 0,
            verifiedUsers: 0,
            blockedUsers: 0,
            totalBalance: 0,
            totalPlayableBalance: 0,
            totalBonusBalance: 0,
            totalEarned: 0,
            totalDeposited: 0,
            totalWithdrawn: 0
          },
          transactions: transactionStats[0] || {
            totalTransactions: 0,
            totalAmount: 0,
            totalFees: 0,
            completedTransactions: 0,
            pendingTransactions: 0,
            failedTransactions: 0,
            flaggedTransactions: 0,
            averageAmount: 0,
            deposits: 0,
            withdrawals: 0,
            quizEarnings: 0,
            tournamentEarnings: 0
          },
          tournaments: tournamentStats[0] || {
            totalTournaments: 0,
            activeTournaments: 0,
            upcomingTournaments: 0,
            completedTournaments: 0,
            totalParticipants: 0,
            totalRevenue: 0,
            totalPrizes: 0
          },
          quizzes: quizStats[0] || {
            totalQuestions: 0,
            activeQuestions: 0,
            verifiedQuestions: 0,
            totalUsage: 0,
            averageQuality: 0,
            categories: [],
            difficulties: []
          }
        },
        recent: {
          users: recentUsers,
          transactions: recentTransactions,
          tournaments: recentTournaments
        },
        pending: {
          deposits: pendingDeposits,
          withdrawals: pendingWithdrawals
        }
      };

      logger.business('admin_dashboard_accessed', {
        adminId,
        timestamp: new Date()
      });

      res.json({
        success: true,
        data: dashboardData,
        message: 'Dashboard data retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_admin_dashboard',
        adminId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve dashboard data'
        }
      });
    }
  }
);

// @route   GET /api/admin/users
// @desc    Get all users with admin controls
// @access  Private (Admin only)
router.get('/users',
  authenticateAdmin,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().isString().trim(),
    query('role').optional().isIn(['user', 'admin', 'moderator']),
    query('isBlocked').optional().isBoolean(),
    query('isVerified').optional().isBoolean(),
    query('sortBy').optional().isIn(['createdAt', 'lastActivity', 'level', 'totalEarned', 'balance']),
    query('sortOrder').optional().isIn(['asc', 'desc'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        role,
        isBlocked,
        isVerified,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      const skip = (page - 1) * limit;
      const query = {};

      // Build query
      if (search) {
        query.$or = [
          { username: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { telegramId: { $regex: search, $options: 'i' } }
        ];
      }

      if (role) query.role = role;
      if (isBlocked !== undefined) query.isBlocked = isBlocked;
      if (isVerified !== undefined) query.isVerified = isVerified;

      // Build sort object
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const users = await User.find(query)
        .select('-password')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('invitedBy', 'username');

      const total = await User.countDocuments(query);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalUsers: total,
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1
          }
        },
        message: 'Users retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_admin_users',
        adminId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve users'
        }
      });
    }
  }
);

// @route   PUT /api/admin/users/:id/block
// @desc    Block or unblock user
// @access  Private (Admin only)
router.put('/users/:id/block',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid user ID'),
    body('blocked').isBoolean().withMessage('Blocked status is required'),
    body('reason').optional().isString().trim().isLength({ max: 500 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const { blocked, reason } = req.body;

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Prevent admin from blocking themselves
      if (id === adminId.toString()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_BLOCK_SELF',
            message: 'You cannot block yourself'
          }
        });
      }

      user.isBlocked = blocked;
      if (blocked) {
        user.blockedReason = reason;
        user.blockedAt = new Date();
        user.blockedBy = adminId;
      } else {
        user.blockedReason = undefined;
        user.blockedAt = undefined;
        user.blockedBy = undefined;
      }

      await user.save();

      logger.business('user_block_status_changed', {
        userId: id,
        adminId,
        blocked,
        reason,
        username: user.username
      });

      res.json({
        success: true,
        data: user,
        message: `User ${blocked ? 'blocked' : 'unblocked'} successfully`
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'block_user',
        adminId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update user block status'
        }
      });
    }
  }
);

// @route   PUT /api/admin/users/:id/verify
// @desc    Verify or unverify user
// @access  Private (Admin only)
router.put('/users/:id/verify',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid user ID'),
    body('verified').isBoolean().withMessage('Verified status is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const { verified } = req.body;

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      user.isVerified = verified;
      await user.save();

      logger.business('user_verification_changed', {
        userId: id,
        adminId,
        verified,
        username: user.username
      });

      res.json({
        success: true,
        data: user,
        message: `User ${verified ? 'verified' : 'unverified'} successfully`
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'verify_user',
        adminId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update user verification status'
        }
      });
    }
  }
);

// @route   PUT /api/admin/users/:id/balance
// @desc    Adjust user balance
// @access  Private (Admin only)
router.put('/users/:id/balance',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid user ID'),
    body('amount').isNumeric().withMessage('Amount is required'),
    body('type').isIn(['playable', 'bonus']).withMessage('Balance type must be playable or bonus'),
    body('operation').isIn(['add', 'subtract', 'set']).withMessage('Operation must be add, subtract, or set'),
    body('reason').isString().trim().isLength({ min: 1, max: 500 }).withMessage('Reason is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const { amount, type, operation, reason } = req.body;

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      let newAmount = 0;
      const currentBalance = type === 'playable' ? user.playableBalance : user.bonusBalance;

      switch (operation) {
        case 'add':
          newAmount = currentBalance + amount;
          break;
        case 'subtract':
          newAmount = Math.max(0, currentBalance - amount);
          break;
        case 'set':
          newAmount = Math.max(0, amount);
          break;
      }

      // Update balance
      if (type === 'playable') {
        user.playableBalance = newAmount;
      } else {
        user.bonusBalance = newAmount;
      }
      user.balance = user.playableBalance + user.bonusBalance;

      await user.save();

      // Create transaction record
      const transaction = new Transaction({
        userId: id,
        type: 'admin_adjustment',
        category: operation === 'subtract' ? 'expense' : 'income',
        amount: Math.abs(newAmount - currentBalance),
        balanceBefore: currentBalance,
        balanceAfter: newAmount,
        paymentMethod: 'internal',
        description: `Admin ${operation}: ${reason}`,
        status: 'completed',
        processedBy: adminId,
        adminNotes: reason
      });

      await transaction.save();

      logger.business('user_balance_adjusted', {
        userId: id,
        adminId,
        operation,
        amount,
        type,
        reason,
        oldBalance: currentBalance,
        newBalance: newAmount,
        username: user.username
      });

      res.json({
        success: true,
        data: {
          user,
          transaction,
          balanceChange: newAmount - currentBalance
        },
        message: 'User balance adjusted successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'adjust_user_balance',
        adminId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to adjust user balance'
        }
      });
    }
  }
);

// @route   GET /api/admin/transactions
// @desc    Get all transactions with admin controls
// @access  Private (Admin only)
router.get('/transactions',
  authenticateAdmin,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('type').optional().isIn(['deposit', 'withdrawal', 'quiz', 'tournament', 'referral', 'bonus', 'daily_bonus', 'task', 'refund']),
    query('status').optional().isIn(['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded']),
    query('flagged').optional().isBoolean(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        type,
        status,
        flagged,
        startDate,
        endDate
      } = req.query;

      const skip = (page - 1) * limit;
      const query = {};

      if (type) query.type = type;
      if (status) query.status = status;
      if (flagged !== undefined) query.flagged = flagged;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const transactions = await Transaction.find(query)
        .populate('userId', 'username email')
        .populate('processedBy', 'username')
        .populate('tournamentId', 'title')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Transaction.countDocuments(query);

      res.json({
        success: true,
        data: {
          transactions,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalTransactions: total,
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1
          }
        },
        message: 'Transactions retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_admin_transactions',
        adminId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve transactions'
        }
      });
    }
  }
);

// @route   GET /api/admin/tournaments
// @desc    Get all tournaments with admin controls
// @access  Private (Admin only)
router.get('/tournaments',
  authenticateAdmin,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('status').optional().isIn(['upcoming', 'active', 'completed', 'cancelled']),
    query('category').optional().isString().trim(),
    query('difficulty').optional().isIn(['easy', 'medium', 'hard'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        category,
        difficulty
      } = req.query;

      const skip = (page - 1) * limit;
      const query = {};

      if (status) query.status = status;
      if (category) query.category = category;
      if (difficulty) query.difficulty = difficulty;

      const tournaments = await Tournament.find(query)
        .populate('participants.user', 'username avatar level')
        .populate('createdBy', 'username')
        .populate('winner', 'username avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Tournament.countDocuments(query);

      res.json({
        success: true,
        data: {
          tournaments,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalTournaments: total,
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1
          }
        },
        message: 'Tournaments retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_admin_tournaments',
        adminId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve tournaments'
        }
      });
    }
  }
);

// @route   GET /api/admin/settings
// @desc    Get app settings
// @access  Private (Admin only)
router.get('/settings',
  authenticateAdmin,
  async (req, res) => {
    try {
      // In a real app, you'd fetch these from a settings collection
      const settings = {
        app: {
          name: process.env.APP_NAME || 'CryptoQuiz',
          version: process.env.APP_VERSION || '1.0.0',
          maintenanceMode: process.env.ENABLE_MAINTENANCE_MODE === 'true',
          maintenanceMessage: process.env.MAINTENANCE_MESSAGE || 'App is under maintenance'
        },
        features: {
          aiQuestions: process.env.ENABLE_AI_QUESTIONS === 'true',
          telegramIntegration: process.env.ENABLE_TELEGRAM_INTEGRATION === 'true',
          analytics: process.env.ENABLE_ANALYTICS === 'true',
          emailNotifications: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
          pushNotifications: process.env.ENABLE_PUSH_NOTIFICATIONS === 'true'
        },
        limits: {
          minDeposit: 10,
          maxDeposit: 10000,
          minWithdrawal: 10,
          maxWithdrawal: 5000,
          withdrawalFee: 0.02,
          maxDailyQuizzes: 10,
          maxHourlyQuizzes: 3
        },
        security: {
          enableFraudDetection: true,
          enableRateLimiting: true,
          suspiciousScoreThreshold: 95,
          maxConsecutiveCorrect: 5
        }
      };

      res.json({
        success: true,
        data: settings,
        message: 'Settings retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_admin_settings',
        adminId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve settings'
        }
      });
    }
  }
);

// @route   PUT /api/admin/settings
// @desc    Update app settings
// @access  Private (Admin only)
router.put('/settings',
  authenticateAdmin,
  [
    body('app').optional().isObject(),
    body('features').optional().isObject(),
    body('limits').optional().isObject(),
    body('security').optional().isObject()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const adminId = req.user._id;
      const settings = req.body;

      // In a real app, you'd save these to a settings collection
      // For now, we'll just log the changes
      
      logger.business('admin_settings_updated', {
        adminId,
        settings,
        timestamp: new Date()
      });

      res.json({
        success: true,
        data: settings,
        message: 'Settings updated successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'update_admin_settings',
        adminId: req.user._id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update settings'
        }
      });
    }
  }
);

// @route   GET /api/admin/analytics
// @desc    Get analytics data
// @access  Private (Admin only)
router.get('/analytics',
  authenticateAdmin,
  [
    query('period').optional().isIn(['today', 'week', 'month', 'year', 'all']),
    query('type').optional().isIn(['users', 'transactions', 'tournaments', 'quizzes'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { period = 'all', type = 'users' } = req.query;
      const adminId = req.user._id;

      let analytics = {};

      switch (type) {
        case 'users':
          analytics = await getUserAnalytics(period);
          break;
        case 'transactions':
          analytics = await Transaction.getTransactionStats(period);
          break;
        case 'tournaments':
          analytics = await Tournament.getTournamentStats();
          break;
        case 'quizzes':
          analytics = await Quiz.getStatistics();
          break;
        default:
          analytics = await getAllAnalytics(period);
      }

      logger.business('admin_analytics_accessed', {
        adminId,
        type,
        period,
        timestamp: new Date()
      });

      res.json({
        success: true,
        data: analytics,
        message: 'Analytics retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_admin_analytics',
        adminId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve analytics'
        }
      });
    }
  }
);

// Helper functions for analytics
async function getUserAnalytics(period) {
  const dateFilter = getDateFilter(period);
  const matchCondition = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

  return User.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
        },
        count: { $sum: 1 },
        verified: { $sum: { $cond: ['$isVerified', 1, 0] } },
        blocked: { $sum: { $cond: ['$isBlocked', 1, 0] } },
        totalBalance: { $sum: '$balance' },
        totalEarned: { $sum: '$totalEarned' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
}

async function getAllAnalytics(period) {
  const dateFilter = getDateFilter(period);
  
  const [users, transactions, tournaments, quizzes] = await Promise.all([
    getUserAnalytics(period),
    Transaction.getTransactionStats(period),
    Tournament.getTournamentStats(),
    Quiz.getStatistics()
  ]);

  return {
    users,
    transactions,
    tournaments,
    quizzes,
    period,
    generatedAt: new Date()
  };
}

function getDateFilter(period) {
  const now = new Date();
  const filter = {};
  
  switch (period) {
    case 'today':
      filter.$gte = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'week':
      filter.$gte = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      filter.$gte = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      filter.$gte = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
  }
  
  return filter;
}

module.exports = router;
