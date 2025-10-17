const express = require('express');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { generateTokenPair, authenticate } = require('../utils/auth');
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

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register',
  [
    body('username').isString().trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters'),
    body('fullName').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Full name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('referralCode').optional().isString().trim().isLength({ min: 8, max: 8 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username, fullName, email, password, referralCode } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [
          { username },
          { email }
        ]
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'USER_EXISTS',
            message: 'User with this username or email already exists'
          }
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

      // Create new user
      const user = new User({
        username,
        fullName,
        email,
        password,
        invitedBy: referrer?._id
      });

      await user.save();

      // Update referrer's stats if applicable
      if (referrer) {
        referrer.invitedFriends += 1;
        await referrer.save();
      }

      // Generate tokens
      const tokens = generateTokenPair(user);

      logger.business('user_registered', {
        userId: user._id,
        username: user.username,
        email: user.email,
        referralCode,
        referrerId: referrer?._id
      });

      res.status(201).json({
        success: true,
        data: {
          user: user.toSafeObject(),
          tokens
        },
        message: 'User registered successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'user_registration',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to register user'
        }
      });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login',
  [
    body('username').isString().trim().withMessage('Username is required'),
    body('password').isString().withMessage('Password is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username, password } = req.body;

      // Find user by username or email
      const user = await User.findOne({
        $or: [
          { username },
          { email: username }
        ]
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password'
          }
        });
      }

      // Check if user is blocked
      if (user.isBlocked) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'USER_BLOCKED',
            message: 'User account is blocked',
            details: {
              reason: user.blockedReason,
              blockedAt: user.blockedAt
            }
          }
        });
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password'
          }
        });
      }

      // Update last login
      user.lastLogin = new Date();
      user.lastActivity = new Date();
      await user.save();

      // Generate tokens
      const tokens = generateTokenPair(user);

      logger.business('user_login', {
        userId: user._id,
        username: user.username,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.json({
        success: true,
        data: {
          user: user.toSafeObject(),
          tokens
        },
        message: 'Login successful'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'user_login',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to login'
        }
      });
    }
  }
);

// @route   POST /api/auth/telegram
// @desc    Authenticate Telegram user
// @access  Public
router.post('/telegram',
  [
    body('telegramData').isObject().withMessage('Telegram data is required'),
    body('telegramData.id').isNumeric().withMessage('Telegram ID is required'),
    body('telegramData.username').optional().isString(),
    body('telegramData.first_name').isString().withMessage('First name is required'),
    body('telegramData.last_name').optional().isString(),
    body('telegramData.photo_url').optional().isString(),
    body('telegramData.language_code').optional().isString(),
    body('telegramData.is_premium').optional().isBoolean(),
    body('referralCode').optional().isString().trim().isLength({ min: 8, max: 8 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { telegramData, referralCode } = req.body;

      // Check if Telegram user already exists
      let user = await User.findByTelegramId(telegramData.id.toString());

      if (user) {
        // Update last login
        user.lastLogin = new Date();
        user.lastActivity = new Date();
        await user.save();

        const tokens = generateTokenPair(user);

        logger.business('telegram_user_login', {
          userId: user._id,
          telegramId: telegramData.id,
          username: user.username
        });

        return res.json({
          success: true,
          data: {
            user: user.toSafeObject(),
            tokens
          },
          message: 'Login successful'
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
        telegramId: telegramData.id.toString(),
        telegramUsername: telegramData.username,
        telegramFullName: `${telegramData.first_name} ${telegramData.last_name || ''}`.trim(),
        telegramPhotoUrl: telegramData.photo_url,
        telegramLanguageCode: telegramData.language_code || 'en',
        telegramIsPremium: telegramData.is_premium || false,
        username: telegramData.username || `user_${telegramData.id}`,
        fullName: `${telegramData.first_name} ${telegramData.last_name || ''}`.trim(),
        invitedBy: referrer?._id,
        userType: 'telegram'
      });

      await user.save();

      // Update referrer's stats if applicable
      if (referrer) {
        referrer.invitedFriends += 1;
        await referrer.save();
      }

      const tokens = generateTokenPair(user);

      logger.business('telegram_user_registered', {
        userId: user._id,
        telegramId: telegramData.id,
        username: user.username,
        referralCode,
        referrerId: referrer?._id
      });

      res.status(201).json({
        success: true,
        data: {
          user: user.toSafeObject(),
          tokens
        },
        message: 'Telegram user registered successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'telegram_auth',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to authenticate Telegram user'
        }
      });
    }
  }
);

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout',
  authenticate,
  async (req, res) => {
    try {
      // In a more sophisticated setup, you might want to blacklist the token
      // For now, we'll just log the logout event
      
      logger.business('user_logout', {
        userId: req.user._id,
        username: req.user.username
      });

      res.json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'user_logout',
        userId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to logout'
        }
      });
    }
  }
);

// @route   POST /api/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post('/refresh',
  [
    body('refreshToken').isString().withMessage('Refresh token is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { refreshToken } = req.body;
      const { verifyRefreshToken, generateToken } = require('../utils/auth');

      // Verify refresh token
      const decoded = verifyRefreshToken(refreshToken);

      // Check if user still exists
      const user = await User.findById(decoded.id);
      if (!user || user.isBlocked) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Invalid refresh token'
          }
        });
      }

      // Generate new access token
      const newAccessToken = generateToken({
        id: user._id,
        telegramId: user.telegramId,
        username: user.username,
        role: user.role
      });

      res.json({
        success: true,
        data: {
          accessToken: newAccessToken
        },
        message: 'Token refreshed successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'refresh_token',
        body: req.body
      });

      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid refresh token'
        }
      });
    }
  }
);

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        // Don't reveal if email exists or not
        return res.json({
          success: true,
          message: 'If the email exists, a password reset link has been sent'
        });
      }

      // Generate reset token (in a real app, you'd send this via email)
      const resetToken = require('crypto').randomBytes(32).toString('hex');
      
      // Store reset token and expiry (you might want to create a separate collection for this)
      user.passwordResetToken = resetToken;
      user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
      await user.save();

      // In a real app, send email here
      logger.business('password_reset_requested', {
        userId: user._id,
        email: user.email
      });

      res.json({
        success: true,
        message: 'If the email exists, a password reset link has been sent'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'forgot_password',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process password reset request'
        }
      });
    }
  }
);

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password',
  [
    body('token').isString().withMessage('Reset token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token, password } = req.body;

      const user = await User.findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: Date.now() }
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_RESET_TOKEN',
            message: 'Invalid or expired reset token'
          }
        });
      }

      // Update password
      user.password = password;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      logger.business('password_reset_completed', {
        userId: user._id,
        email: user.email
      });

      res.json({
        success: true,
        message: 'Password reset successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'reset_password',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reset password'
        }
      });
    }
  }
);

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me',
  authenticate,
  async (req, res) => {
    try {
      const user = await User.findById(req.user._id).select('-password');
      
      res.json({
        success: true,
        data: user,
        message: 'User profile retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_current_user',
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

module.exports = router;
