const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Referral = require('../models/Referral');
const User = require('../models/User');
const { authenticate, authenticateAdmin } = require('../utils/auth');
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

// Generate referral link for user
router.get('/generate-link', authenticate, async (req, res) => {
  try {
    const userId = req.user.telegramId || req.user._id.toString();
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'quizly_bot';
    
    // Format: @bot_username userid
    const referralLink = `@${botUsername} ${userId}`;
    
    // Update user's referral link
    await User.findByIdAndUpdate(req.user._id, {
      referralLink: referralLink
    });

    logger.info(`Generated referral link for user ${userId}: ${referralLink}`);

    res.json({
      success: true,
      data: {
        referralLink: referralLink,
        botUsername: botUsername,
        userId: userId
      },
      message: 'Referral link generated successfully'
    });
  } catch (error) {
    logger.error('Error generating referral link:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Error generating referral link'
      }
    });
  }
});

// Process referral when new user joins
router.post('/process', 
  [
    body('referralLink').notEmpty().withMessage('Referral link is required'),
    body('newUserId').notEmpty().withMessage('New user ID is required'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { referralLink, newUserId } = req.body;
      const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'quizly_bot';
      
      // Parse referral link: @bot_username userid
      const pattern = new RegExp(`@${botUsername}\\s+(\\d+)`);
      const match = referralLink.match(pattern);
      
      if (!match || !match[1]) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REFERRAL_LINK',
            message: 'Invalid referral link format'
          }
        });
      }

      const referrerId = match[1];

      // Check if referrer exists
      const referrer = await User.findOne({ 
        $or: [
          { telegramId: referrerId },
          { _id: referrerId }
        ]
      });
      
      if (!referrer) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'REFERRER_NOT_FOUND',
            message: 'Referrer not found'
          }
        });
      }

      // Check if user is referring themselves
      if (newUserId === referrerId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'SELF_REFERRAL',
            message: 'Cannot refer yourself'
          }
        });
      }

      // Check if new user already has a referrer
      const newUser = await User.findOne({ 
        $or: [
          { telegramId: newUserId },
          { _id: newUserId }
        ]
      });
      
      if (newUser && newUser.referrerId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'ALREADY_REFERRED',
            message: 'User already has a referrer'
          }
        });
      }

      // Check referrer's referral limit
      if (referrer.invitedFriends >= referrer.maxInvites) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'REFERRAL_LIMIT_EXCEEDED',
            message: 'Referrer has reached maximum referral limit'
          }
        });
      }

      // Create referral record
      const referral = new Referral({
        referrerId: referrer.telegramId || referrer._id.toString(),
        referredId: newUserId,
        referralLink: referralLink,
        rewardAmount: parseFloat(process.env.REFERRAL_REWARD || 10),
        referredRewardAmount: parseFloat(process.env.REFERRED_REWARD || 5),
        status: 'pending'
      });

      await referral.save();

      // Update referrer's stats
      await User.findByIdAndUpdate(referrer._id, {
        $inc: {
          invitedFriends: 1,
          pendingReferrals: 1
        },
        lastReferralAt: new Date()
      });

      // Update new user's referrer info
      if (newUser) {
        await User.findByIdAndUpdate(newUser._id, {
          referrerId: referrer.telegramId || referrer._id.toString(),
          referrerTelegramId: referrer.telegramId
        });
      }

      logger.info(`Referral processed: ${referrerId} -> ${newUserId}`);

      res.json({
        success: true,
        data: {
          referralId: referral._id,
          referrerId: referrer.telegramId || referrer._id.toString(),
          referredId: newUserId,
          rewardAmount: referral.rewardAmount,
          referredRewardAmount: referral.referredRewardAmount,
          status: referral.status
        },
        message: 'Referral processed successfully'
      });
    } catch (error) {
      logger.error('Error processing referral:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error processing referral'
        }
      });
    }
  }
);

// Get user's referral statistics
router.get('/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.telegramId || req.user._id.toString();
    
    const stats = await Referral.getUserReferralStats(userId);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'quizly_bot';
    const referralLink = `@${botUsername} ${userId}`;

    res.json({
      success: true,
      data: {
        ...stats,
        referralLink: referralLink,
        botUsername: botUsername,
        referralReward: parseFloat(process.env.REFERRAL_REWARD || 10),
        referredReward: parseFloat(process.env.REFERRED_REWARD || 5)
      }
    });
  } catch (error) {
    logger.error('Error getting referral stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Error getting referral stats'
      }
    });
  }
});

// Get referral leaderboard
router.get('/leaderboard', 
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const leaderboard = await Referral.getReferralLeaderboard(limit);

      res.json({
        success: true,
        data: {
          leaderboard: leaderboard,
          limit: limit
        }
      });
    } catch (error) {
      logger.error('Error getting referral leaderboard:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error getting referral leaderboard'
        }
      });
    }
  }
);

// Get referral history for user
router.get('/history', authenticate, 
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const userId = req.user.telegramId || req.user._id.toString();
      const limit = parseInt(req.query.limit) || 20;

      const history = await Referral.find({
        referrerId: userId
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

      res.json({
        success: true,
        data: {
          history: history,
          limit: limit
        }
      });
    } catch (error) {
      logger.error('Error getting referral history:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error getting referral history'
        }
      });
    }
  }
);

// Validate referral link
router.post('/validate', 
  [
    body('referralLink').notEmpty().withMessage('Referral link is required'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { referralLink } = req.body;
      const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'quizly_bot';
      
      // Parse referral link
      const pattern = new RegExp(`@${botUsername}\\s+(\\d+)`);
      const match = referralLink.match(pattern);
      
      if (!match || !match[1]) {
        return res.json({
          success: false,
          error: {
            code: 'INVALID_REFERRAL_LINK',
            message: 'Invalid referral link format'
          }
        });
      }

      const referrerId = match[1];

      // Check if referrer exists
      const referrer = await User.findOne({ 
        $or: [
          { telegramId: referrerId },
          { _id: referrerId }
        ]
      });

      if (!referrer) {
        return res.json({
          success: false,
          error: {
            code: 'REFERRER_NOT_FOUND',
            message: 'Referrer not found'
          }
        });
      }

      res.json({
        success: true,
        data: {
          referrerId: referrerId,
          referrerUsername: referrer.username,
          referrerName: referrer.fullName,
          botUsername: botUsername
        }
      });
    } catch (error) {
      logger.error('Error validating referral link:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error validating referral link'
        }
      });
    }
  }
);

// Admin: Process pending referrals
router.post('/admin/process-pending', authenticateAdmin, async (req, res) => {
  try {
    const results = await Referral.processPendingReferrals();

    logger.info('Processed pending referrals:', results);

    res.json({
      success: true,
      data: {
        processed: results.length,
        results: results
      },
      message: 'Pending referrals processed successfully'
    });
  } catch (error) {
    logger.error('Error processing pending referrals:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Error processing pending referrals'
      }
    });
  }
});

// Admin: Get all referrals
router.get('/admin/all', authenticateAdmin,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('status').optional().isIn(['pending', 'completed', 'cancelled']).withMessage('Invalid status'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status;
      const skip = (page - 1) * limit;

      const filter = status ? { status } : {};
      
      const referrals = await Referral.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Referral.countDocuments(filter);

      res.json({
        success: true,
        data: {
          referrals: referrals,
          pagination: {
            page: page,
            limit: limit,
            total: total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Error getting all referrals:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error getting all referrals'
        }
      });
    }
  }
);

// Admin: Update referral settings
router.put('/admin/settings', authenticateAdmin,
  [
    body('referralReward').optional().isFloat({ min: 0 }).withMessage('Referral reward must be a positive number'),
    body('referredReward').optional().isFloat({ min: 0 }).withMessage('Referred reward must be a positive number'),
    body('botUsername').optional().isString().withMessage('Bot username must be a string'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { referralReward, referredReward, botUsername } = req.body;

      // Update environment variables or database settings
      if (referralReward !== undefined) {
        process.env.REFERRAL_REWARD = referralReward.toString();
      }
      if (referredReward !== undefined) {
        process.env.REFERRED_REWARD = referredReward.toString();
      }
      if (botUsername !== undefined) {
        process.env.TELEGRAM_BOT_USERNAME = botUsername;
      }

      logger.info('Referral settings updated:', { referralReward, referredReward, botUsername });

      res.json({
        success: true,
        data: {
          referralReward: parseFloat(process.env.REFERRAL_REWARD || 10),
          referredReward: parseFloat(process.env.REFERRED_REWARD || 5),
          botUsername: process.env.TELEGRAM_BOT_USERNAME || 'quizly_bot'
        },
        message: 'Referral settings updated successfully'
      });
    } catch (error) {
      logger.error('Error updating referral settings:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error updating referral settings'
        }
      });
    }
  }
);

module.exports = router;
