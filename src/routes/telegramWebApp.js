const express = require('express');
const { body, param, validationResult } = require('express-validator');
const User = require('../models/User');
const { generateTokenPair } = require('../utils/auth');
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

// @route   POST /api/telegram/webapp-init
// @desc    Initialize Telegram WebApp and get user data
// @access  Public
router.post('/webapp-init',
  [
    body('initData').isString().withMessage('Init data is required'),
    body('user').isObject().withMessage('User data is required'),
    body('user.id').isNumeric().withMessage('User ID is required'),
    body('user.first_name').isString().withMessage('First name is required'),
    body('user.last_name').optional().isString(),
    body('user.username').optional().isString(),
    body('user.photo_url').optional().isString(),
    body('user.language_code').optional().isString(),
    body('user.is_premium').optional().isBoolean(),
    body('referralCode').optional().isString().trim().isLength({ min: 8, max: 8 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { initData, user: telegramUser, referralCode } = req.body;

      // Verify Telegram WebApp data (in production, you should verify the signature)
      // For now, we'll trust the data from Telegram
      
      logger.business('telegram_webapp_init', {
        telegramUserId: telegramUser.id,
        username: telegramUser.username,
        firstName: telegramUser.first_name,
        referralCode
      });

      // Check if user already exists
      let user = await User.findByTelegramId(telegramUser.id.toString());

      if (user) {
        // Update user's Telegram data
        user.telegramUsername = telegramUser.username;
        user.telegramFullName = `${telegramUser.first_name} ${telegramUser.last_name || ''}`.trim();
        user.telegramPhotoUrl = telegramUser.photo_url;
        user.telegramLanguageCode = telegramUser.language_code || 'en';
        user.telegramIsPremium = telegramUser.is_premium || false;
        user.lastLogin = new Date();
        user.lastActivity = new Date();
        user.isOnline = true;

        await user.save();

        // Generate tokens
        const tokens = generateTokenPair(user);

        // Get user's complete data for frontend
        const userData = await getUserCompleteData(user._id);

        logger.business('telegram_user_login', {
          userId: user._id,
          telegramId: telegramUser.id,
          username: user.username
        });

        return res.json({
          success: true,
          data: {
            user: userData,
            tokens,
            isNewUser: false,
            message: 'Welcome back!'
          },
          message: 'User data retrieved successfully'
        });
      }

      // Check referral code if provided
      let referrer = null;
      if (referralCode) {
        referrer = await User.findByReferralCode(referralCode);
        if (!referrer) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_REFERRAL',
              message: 'Invalid referral code'
            }
          });
        }
      }

      // Create new Telegram user
      user = new User({
        telegramId: telegramUser.id.toString(),
        telegramUsername: telegramUser.username,
        telegramFullName: `${telegramUser.first_name} ${telegramUser.last_name || ''}`.trim(),
        telegramPhotoUrl: telegramUser.photo_url,
        telegramLanguageCode: telegramUser.language_code || 'en',
        telegramIsPremium: telegramUser.is_premium || false,
        username: telegramUser.username || `user_${telegramUser.id}`,
        fullName: `${telegramUser.first_name} ${telegramUser.last_name || ''}`.trim(),
        invitedBy: referrer?._id,
        userType: 'telegram',
        lastLogin: new Date(),
        lastActivity: new Date(),
        isOnline: true
      });

      await user.save();

      // Update referrer's stats if applicable
      if (referrer) {
        referrer.invitedFriends += 1;
        await referrer.save();
      }

      // Generate tokens
      const tokens = generateTokenPair(user);

      // Get user's complete data for frontend
      const userData = await getUserCompleteData(user._id);

      logger.business('telegram_user_registered', {
        userId: user._id,
        telegramId: telegramUser.id,
        username: user.username,
        referralCode,
        referrerId: referrer?._id
      });

      res.status(201).json({
        success: true,
        data: {
          user: userData,
          tokens,
          isNewUser: true,
          message: 'Welcome to CryptoQuiz!'
        },
        message: 'User registered successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'telegram_webapp_init',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to initialize Telegram WebApp'
        }
      });
    }
  }
);

// @route   GET /api/telegram/user-data/:telegramId
// @desc    Get user data by Telegram ID
// @access  Public
router.get('/user-data/:telegramId',
  [
    param('telegramId').isNumeric().withMessage('Telegram ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { telegramId } = req.params;

      const user = await User.findByTelegramId(telegramId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Get user's complete data
      const userData = await getUserCompleteData(user._id);

      res.json({
        success: true,
        data: userData,
        message: 'User data retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_telegram_user_data',
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user data'
        }
      });
    }
  }
);

// @route   POST /api/telegram/sync-user
// @desc    Sync user data with Telegram
// @access  Public
router.post('/sync-user',
  [
    body('telegramId').isNumeric().withMessage('Telegram ID is required'),
    body('userData').isObject().withMessage('User data is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { telegramId, userData } = req.body;

      const user = await User.findByTelegramId(telegramId.toString());
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Update user data
      Object.keys(userData).forEach(key => {
        if (userData[key] !== undefined && userData[key] !== null) {
          user[key] = userData[key];
        }
      });

      user.lastActivity = new Date();
      await user.save();

      // Get updated user data
      const updatedUserData = await getUserCompleteData(user._id);

      logger.business('telegram_user_synced', {
        userId: user._id,
        telegramId,
        updatedFields: Object.keys(userData)
      });

      res.json({
        success: true,
        data: updatedUserData,
        message: 'User data synced successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'sync_telegram_user',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to sync user data'
        }
      });
    }
  }
);

// Helper function to get complete user data
async function getUserCompleteData(userId) {
  try {
    const User = require('../models/User');
    const Transaction = require('../models/Transaction');
    const Tournament = require('../models/Tournament');
    const Achievement = require('../models/Achievement');

    const user = await User.findById(userId)
      .populate('invitedBy', 'username')
      .select('-password');

    if (!user) {
      throw new Error('User not found');
    }

    // Get recent transactions
    const recentTransactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('type amount status createdAt description');

    // Get user's tournaments
    const userTournaments = await Tournament.find({
      'participants.user': userId
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('title status participants prizePool createdAt');

    // Get user's achievements
    const achievements = await Achievement.find({ userId })
      .sort({ unlockedAt: -1 })
      .limit(10)
      .select('title description category reward icon');

    // Get user's statistics
    const stats = {
      totalEarned: user.totalEarned,
      totalDeposited: user.totalDeposited,
      totalWithdrawn: user.totalWithdrawn,
      questionsAnswered: user.questionsAnswered,
      correctAnswers: user.correctAnswers,
      accuracy: user.questionsAnswered > 0 ? (user.correctAnswers / user.questionsAnswered) * 100 : 0,
      tournamentsWon: user.tournamentsWon,
      totalTournaments: user.totalTournaments,
      winRate: user.totalTournaments > 0 ? (user.tournamentsWon / user.totalTournaments) * 100 : 0,
      streak: user.streak,
      level: user.level,
      totalXP: user.totalXP,
      rank: user.rank
    };

    // Get pending transactions
    const pendingDeposits = await Transaction.find({
      userId,
      type: 'deposit',
      status: 'pending'
    }).countDocuments();

    const pendingWithdrawals = await Transaction.find({
      userId,
      type: 'withdrawal',
      status: 'pending'
    }).countDocuments();

    // Get active tournaments
    const activeTournaments = await Tournament.find({
      'participants.user': userId,
      status: { $in: ['upcoming', 'active'] }
    }).countDocuments();

    return {
      ...user.toObject(),
      stats,
      recentTransactions,
      userTournaments,
      achievements,
      pendingDeposits,
      pendingWithdrawals,
      activeTournaments,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    };

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'get_user_complete_data',
      userId
    });
    throw error;
  }
}

module.exports = router;
