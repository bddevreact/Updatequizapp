const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const { authenticate } = require('../utils/auth');
const logger = require('../utils/logger');

// @route   GET /api/activities
// @desc    Get user activities
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

    const { limit = 50, page = 1 } = req.query;
    const skip = (page - 1) * limit;

    const activities = await Activity.find({ userId: req.user._id })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Activity.countDocuments({ userId: req.user._id });

    res.json({
      success: true,
      data: activities,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching activities:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ACTIVITIES_ERROR',
        message: 'Error fetching activities'
      }
    });
  }
});

// @route   POST /api/activities
// @desc    Create new activity
// @access  Private
router.post('/', authenticate, [
  body('type').notEmpty().withMessage('Activity type is required'),
  body('title').notEmpty().withMessage('Activity title is required'),
  body('description').optional().isString(),
  body('icon').optional().isString(),
  body('reward').optional().isNumeric()
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

    const activityData = {
      ...req.body,
      userId: req.user._id,
      timestamp: new Date()
    };

    const activity = new Activity(activityData);
    await activity.save();

    res.status(201).json({
      success: true,
      data: activity
    });
  } catch (error) {
    logger.error('Error creating activity:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_ACTIVITY_ERROR',
        message: 'Error creating activity'
      }
    });
  }
});

// @route   DELETE /api/activities/:id
// @desc    Delete activity
// @access  Private
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const activity = await Activity.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!activity) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ACTIVITY_NOT_FOUND',
          message: 'Activity not found'
        }
      });
    }

    res.json({
      success: true,
      message: 'Activity deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting activity:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_ACTIVITY_ERROR',
        message: 'Error deleting activity'
      }
    });
  }
});

module.exports = router;
