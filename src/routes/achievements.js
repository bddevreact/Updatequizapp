const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Achievement = require('../models/Achievement');
const { authenticate } = require('../utils/auth');
const logger = require('../utils/logger');

// @route   GET /api/achievements
// @desc    Get user achievements
// @access  Private
router.get('/', authenticate, async (req, res) => {
  try {
    // Check if database is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_NOT_CONNECTED',
          message: 'Database connection not ready'
        }
      });
    }

    const achievements = await Achievement.find({ userId: req.user._id })
      .sort({ unlockedAt: -1 });

    res.json({
      success: true,
      data: achievements
    });
  } catch (error) {
    logger.error('Error fetching achievements:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ACHIEVEMENTS_ERROR',
        message: 'Error fetching achievements'
      }
    });
  }
});

// @route   POST /api/achievements
// @desc    Create new achievement
// @access  Private
router.post('/', authenticate, [
  body('title').notEmpty().withMessage('Achievement title is required'),
  body('description').notEmpty().withMessage('Achievement description is required'),
  body('icon').optional().isString(),
  body('category').optional().isString(),
  body('points').optional().isNumeric(),
  body('unlocked').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const achievementData = {
      ...req.body,
      userId: req.user._id,
      unlockedAt: req.body.unlocked ? new Date() : null
    };

    const achievement = new Achievement(achievementData);
    await achievement.save();

    res.status(201).json({
      success: true,
      data: achievement
    });
  } catch (error) {
    logger.error('Error creating achievement:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_ACHIEVEMENT_ERROR',
        message: 'Error creating achievement'
      }
    });
  }
});

// @route   PUT /api/achievements/:id/unlock
// @desc    Unlock achievement
// @access  Private
router.put('/:id/unlock', authenticate, async (req, res) => {
  try {
    const achievement = await Achievement.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { 
        unlocked: true,
        unlockedAt: new Date()
      },
      { new: true }
    );

    if (!achievement) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ACHIEVEMENT_NOT_FOUND',
          message: 'Achievement not found'
        }
      });
    }

    res.json({
      success: true,
      data: achievement
    });
  } catch (error) {
    logger.error('Error unlocking achievement:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UNLOCK_ACHIEVEMENT_ERROR',
        message: 'Error unlocking achievement'
      }
    });
  }
});

module.exports = router;
