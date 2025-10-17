const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
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

// @route   GET /api/users
// @desc    Get all users (Admin only)
// @access  Private
router.get('/',
  authenticateAdmin,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().isString().trim(),
    query('role').optional().isIn(['user', 'admin', 'moderator']),
    query('isBlocked').optional().isBoolean(),
    query('sortBy').optional().isIn(['createdAt', 'lastActivity', 'level', 'totalEarned']),
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
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      if (role) query.role = role;
      if (isBlocked !== undefined) query.isBlocked = isBlocked;

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
        operation: 'get_users',
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

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private
router.get('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid user ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const currentUserId = req.user._id;

      // Users can only view their own profile unless they're admin
      if (id !== currentUserId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only view your own profile'
          }
        });
      }

      const user = await User.findById(id)
        .select('-password')
        .populate('invitedBy', 'username');

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.json({
        success: true,
        data: user,
        message: 'User retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_user',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user'
        }
      });
    }
  }
);

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private
router.put('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid user ID'),
    body('username').optional().isString().trim().isLength({ min: 3, max: 30 }),
    body('fullName').optional().isString().trim().isLength({ max: 100 }),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().isString().trim(),
    body('settings').optional().isObject()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const currentUserId = req.user._id;
      const updateData = req.body;

      // Users can only update their own profile unless they're admin
      if (id !== currentUserId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only update your own profile'
          }
        });
      }

      // Remove sensitive fields that shouldn't be updated via this endpoint
      delete updateData.password;
      delete updateData.role;
      delete updateData.isBlocked;
      delete updateData.balance;
      delete updateData.playableBalance;
      delete updateData.bonusBalance;

      const user = await User.findByIdAndUpdate(
        id,
        { ...updateData, lastActivity: new Date() },
        { new: true, runValidators: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      logger.business('user_updated', {
        userId: id,
        updatedBy: currentUserId,
        updatedFields: Object.keys(updateData)
      });

      res.json({
        success: true,
        data: user,
        message: 'User updated successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'update_user',
        userId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update user'
        }
      });
    }
  }
);

// @route   DELETE /api/users/:id
// @desc    Delete user (Admin only)
// @access  Private
router.delete('/:id',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid user ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;

      // Prevent admin from deleting themselves
      if (id === adminId.toString()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_DELETE_SELF',
            message: 'You cannot delete your own account'
          }
        });
      }

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

      await User.findByIdAndDelete(id);

      logger.business('user_deleted', {
        deletedUserId: id,
        deletedBy: adminId,
        username: user.username
      });

      res.json({
        success: true,
        message: 'User deleted successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'delete_user',
        adminId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete user'
        }
      });
    }
  }
);

// @route   GET /api/users/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile',
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user._id;
      
      const user = await User.findById(userId)
        .select('-password')
        .populate('invitedBy', 'username');

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.json({
        success: true,
        data: user,
        message: 'User profile retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_current_user_profile',
        userId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user profile'
        }
      });
    }
  }
);

// @route   PUT /api/users/profile
// @desc    Update current user profile
// @access  Private
router.put('/profile',
  authenticate,
  [
    body('avatar').optional().isString().trim(),
    body('settings.privacy').optional().isObject(),
    body('settings.preferences').optional().isObject()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const updateData = req.body;

      // Remove sensitive fields that shouldn't be updated via this endpoint
      delete updateData.password;
      delete updateData.role;
      delete updateData.isBlocked;
      delete updateData.balance;
      delete updateData.playableBalance;
      delete updateData.bonusBalance;

      const user = await User.findByIdAndUpdate(
        userId,
        { ...updateData, lastActivity: new Date() },
        { new: true, runValidators: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.json({
        success: true,
        data: user,
        message: 'Profile updated successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'update_current_user_profile',
        userId: req.user._id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update profile'
        }
      });
    }
  }
);

// @route   GET /api/users/:id/profile
// @desc    Get user profile (public info)
// @access  Private
router.get('/:id/profile',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid user ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const user = await User.findById(id)
        .select('username fullName avatar level rank totalXP totalEarned tournamentsWon winRate streak createdAt settings.privacy');

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Check privacy settings
      const profile = {
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        level: user.level,
        rank: user.rank,
        totalXP: user.totalXP,
        createdAt: user.createdAt
      };

      if (user.settings?.privacy?.showStats) {
        profile.totalEarned = user.totalEarned;
        profile.tournamentsWon = user.tournamentsWon;
        profile.winRate = user.winRate;
        profile.streak = user.streak;
      }

      res.json({
        success: true,
        data: profile,
        message: 'User profile retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_user_profile',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user profile'
        }
      });
    }
  }
);

// @route   PUT /api/users/:id/profile
// @desc    Update user profile
// @access  Private
router.put('/:id/profile',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid user ID'),
    body('avatar').optional().isString().trim(),
    body('settings.privacy').optional().isObject(),
    body('settings.preferences').optional().isObject()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const currentUserId = req.user._id;
      const { avatar, settings } = req.body;

      // Users can only update their own profile
      if (id !== currentUserId.toString()) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only update your own profile'
          }
        });
      }

      const updateData = {};
      if (avatar) updateData.avatar = avatar;
      if (settings) updateData.settings = settings;

      const user = await User.findByIdAndUpdate(
        id,
        { ...updateData, lastActivity: new Date() },
        { new: true, runValidators: true }
      ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.json({
        success: true,
        data: user,
        message: 'Profile updated successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'update_user_profile',
        userId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update profile'
        }
      });
    }
  }
);

// @route   GET /api/users/:id/transactions
// @desc    Get user transactions
// @access  Private
router.get('/:id/transactions',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid user ID'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('type').optional().isIn(['deposit', 'withdrawal', 'quiz', 'tournament', 'referral', 'bonus']),
    query('status').optional().isIn(['pending', 'completed', 'failed', 'cancelled'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const currentUserId = req.user._id;
      const { page = 1, limit = 20, type, status } = req.query;

      // Users can only view their own transactions unless they're admin
      if (id !== currentUserId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only view your own transactions'
          }
        });
      }

      const Transaction = require('../models/Transaction');
      const skip = (page - 1) * limit;
      const query = { userId: id };

      if (type) query.type = type;
      if (status) query.status = status;

      const transactions = await Transaction.find(query)
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
        operation: 'get_user_transactions',
        userId: req.user._id,
        params: req.params,
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

// @route   GET /api/users/:id/achievements
// @desc    Get user achievements
// @access  Private
router.get('/:id/achievements',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid user ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const currentUserId = req.user._id;

      // Users can only view their own achievements unless they're admin
      if (id !== currentUserId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only view your own achievements'
          }
        });
      }

      const Achievement = require('../models/Achievement');
      const achievements = await Achievement.find({ userId: id })
        .sort({ unlockedAt: -1 });

      res.json({
        success: true,
        data: achievements,
        message: 'Achievements retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_user_achievements',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve achievements'
        }
      });
    }
  }
);

module.exports = router;
