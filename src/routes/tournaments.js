const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
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

// @route   GET /api/tournaments
// @desc    Get all tournaments
// @access  Private
router.get('/',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('status').optional().isIn(['upcoming', 'active', 'completed', 'cancelled']),
    query('category').optional().isString().trim(),
    query('difficulty').optional().isIn(['easy', 'medium', 'hard']),
    query('sortBy').optional().isIn(['startTime', 'entryFee', 'prizePool', 'participants']),
    query('sortOrder').optional().isIn(['asc', 'desc'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        category,
        difficulty,
        sortBy = 'startTime',
        sortOrder = 'asc'
      } = req.query;

      const skip = (page - 1) * limit;
      const query = {};

      // Build query
      if (status) query.status = status;
      if (category) query.category = category;
      if (difficulty) query.difficulty = difficulty;

      // Build sort object
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const tournaments = await Tournament.find(query)
        .populate('participants.user', 'username avatar level')
        .populate('createdBy', 'username')
        .populate('winner', 'username avatar')
        .sort(sort)
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
        operation: 'get_tournaments',
        userId: req.user._id,
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

// @route   POST /api/tournaments
// @desc    Create a new tournament
// @access  Private
router.post('/',
  authenticate,
  [
    body('title').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Title is required'),
    body('description').optional().isString().trim().isLength({ max: 500 }),
    body('category').isString().trim().isLength({ min: 1, max: 50 }).withMessage('Category is required'),
    body('difficulty').isIn(['easy', 'medium', 'hard']).withMessage('Invalid difficulty'),
    body('entryFee').isNumeric().isFloat({ min: 0 }).withMessage('Entry fee must be non-negative'),
    body('prizePool').isNumeric().isFloat({ min: 0 }).withMessage('Prize pool must be non-negative'),
    body('maxParticipants').isInt({ min: 2, max: 100 }).withMessage('Max participants must be between 2 and 100'),
    body('minParticipants').optional().isInt({ min: 2 }).withMessage('Min participants must be at least 2'),
    body('startTime').isISO8601().withMessage('Start time must be a valid date'),
    body('endTime').isISO8601().withMessage('End time must be a valid date'),
    body('registrationStart').isISO8601().withMessage('Registration start must be a valid date'),
    body('registrationEnd').isISO8601().withMessage('Registration end must be a valid date'),
    body('questionCount').optional().isInt({ min: 5, max: 50 }).withMessage('Question count must be between 5 and 50'),
    body('timePerQuestion').optional().isInt({ min: 10, max: 120 }).withMessage('Time per question must be between 10 and 120 seconds'),
    body('isPrivate').optional().isBoolean(),
    body('settings').optional().isObject()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const tournamentData = req.body;

      // Validate dates
      const now = new Date();
      const registrationStart = new Date(tournamentData.registrationStart);
      const registrationEnd = new Date(tournamentData.registrationEnd);
      const startTime = new Date(tournamentData.startTime);
      const endTime = new Date(tournamentData.endTime);

      if (registrationStart >= registrationEnd) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATES',
            message: 'Registration start must be before registration end'
          }
        });
      }

      if (registrationEnd >= startTime) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATES',
            message: 'Registration end must be before tournament start'
          }
        });
      }

      if (startTime >= endTime) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATES',
            message: 'Start time must be before end time'
          }
        });
      }

      if (startTime <= now) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATES',
            message: 'Start time must be in the future'
          }
        });
      }

      // Check user balance for entry fee
      const user = await User.findById(userId);
      if (user.playableBalance < tournamentData.entryFee) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient balance to create tournament'
          }
        });
      }

      // Create tournament
      const tournament = new Tournament({
        ...tournamentData,
        createdBy: userId,
        appFee: tournamentData.entryFee * 0.2, // 20% app fee
        prizeDistribution: [
          { rank: 1, prize: tournamentData.prizePool * 0.5, percentage: 50 },
          { rank: 2, prize: tournamentData.prizePool * 0.3, percentage: 30 },
          { rank: 3, prize: tournamentData.prizePool * 0.2, percentage: 20 }
        ]
      });

      await tournament.save();

      // Deduct entry fee from user balance
      user.deductBalance(tournamentData.entryFee, 'playable');
      await user.save();

      // Create transaction record
      const transaction = new Transaction({
        userId,
        type: 'tournament',
        category: 'expense',
        amount: tournamentData.entryFee,
        balanceBefore: user.playableBalance + tournamentData.entryFee,
        balanceAfter: user.playableBalance,
        paymentMethod: 'internal',
        description: `Tournament entry fee: ${tournament.title}`,
        tournamentId: tournament._id,
        status: 'completed'
      });

      await transaction.save();

      logger.business('tournament_created', {
        tournamentId: tournament._id,
        createdBy: userId,
        title: tournament.title,
        entryFee: tournament.entryFee,
        prizePool: tournament.prizePool
      });

      res.status(201).json({
        success: true,
        data: tournament,
        message: 'Tournament created successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'create_tournament',
        userId: req.user._id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create tournament'
        }
      });
    }
  }
);

// @route   GET /api/tournaments/:id
// @desc    Get tournament by ID
// @access  Private
router.get('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const tournament = await Tournament.findById(id)
        .populate('participants.user', 'username avatar level rank totalXP')
        .populate('createdBy', 'username avatar')
        .populate('winner', 'username avatar')
        .populate('questions', 'question options difficulty points');

      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      res.json({
        success: true,
        data: tournament,
        message: 'Tournament retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_tournament',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve tournament'
        }
      });
    }
  }
);

// @route   PUT /api/tournaments/:id
// @desc    Update tournament
// @access  Private
router.put('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID'),
    body('title').optional().isString().trim().isLength({ min: 1, max: 100 }),
    body('description').optional().isString().trim().isLength({ max: 500 }),
    body('settings').optional().isObject()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;
      const updateData = req.body;

      const tournament = await Tournament.findById(id);
      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      // Only creator or admin can update
      if (tournament.createdBy.toString() !== userId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'Only tournament creator can update'
          }
        });
      }

      // Can't update if tournament has started
      if (tournament.status !== 'upcoming') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TOURNAMENT_STARTED',
            message: 'Cannot update tournament after it has started'
          }
        });
      }

      const updatedTournament = await Tournament.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      )
      .populate('participants.user', 'username avatar')
      .populate('createdBy', 'username');

      logger.business('tournament_updated', {
        tournamentId: id,
        updatedBy: userId,
        updatedFields: Object.keys(updateData)
      });

      res.json({
        success: true,
        data: updatedTournament,
        message: 'Tournament updated successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'update_tournament',
        userId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update tournament'
        }
      });
    }
  }
);

// @route   DELETE /api/tournaments/:id
// @desc    Delete tournament
// @access  Private
router.delete('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const tournament = await Tournament.findById(id);
      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      // Only creator or admin can delete
      if (tournament.createdBy.toString() !== userId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'Only tournament creator can delete'
          }
        });
      }

      // Can't delete if tournament has participants
      if (tournament.participants.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TOURNAMENT_HAS_PARTICIPANTS',
            message: 'Cannot delete tournament with participants'
          }
        });
      }

      await Tournament.findByIdAndDelete(id);

      logger.business('tournament_deleted', {
        tournamentId: id,
        deletedBy: userId,
        title: tournament.title
      });

      res.json({
        success: true,
        message: 'Tournament deleted successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'delete_tournament',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete tournament'
        }
      });
    }
  }
);

// @route   POST /api/tournaments/:id/join
// @desc    Join tournament
// @access  Private
router.post('/:id/join',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const tournament = await Tournament.findById(id);
      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      // Check if user can join
      const canJoin = tournament.canJoin(userId);
      if (!canJoin.canJoin) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_JOIN',
            message: canJoin.reason
          }
        });
      }

      // Check user balance
      const user = await User.findById(userId);
      if (user.playableBalance < tournament.entryFee) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient balance to join tournament'
          }
        });
      }

      // Add participant
      tournament.addParticipant(userId);
      await tournament.save();

      // Deduct entry fee
      user.deductBalance(tournament.entryFee, 'playable');
      await user.save();

      // Create transaction
      const transaction = new Transaction({
        userId,
        type: 'tournament',
        category: 'expense',
        amount: tournament.entryFee,
        balanceBefore: user.playableBalance + tournament.entryFee,
        balanceAfter: user.playableBalance,
        paymentMethod: 'internal',
        description: `Tournament entry fee: ${tournament.title}`,
        tournamentId: tournament._id,
        status: 'completed'
      });

      await transaction.save();

      logger.business('tournament_joined', {
        tournamentId: id,
        userId,
        entryFee: tournament.entryFee
      });

      res.json({
        success: true,
        data: {
          tournament: tournament,
          newBalance: user.playableBalance
        },
        message: 'Successfully joined tournament'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'join_tournament',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to join tournament'
        }
      });
    }
  }
);

// @route   POST /api/tournaments/:id/leave
// @desc    Leave tournament
// @access  Private
router.post('/:id/leave',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const tournament = await Tournament.findById(id);
      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      // Check if user is a participant
      const participant = tournament.participants.find(p => p.user.toString() === userId.toString());
      if (!participant) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NOT_PARTICIPANT',
            message: 'You are not a participant in this tournament'
          }
        });
      }

      // Can't leave if tournament has started
      if (tournament.status === 'active' || tournament.status === 'completed') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TOURNAMENT_STARTED',
            message: 'Cannot leave tournament after it has started'
          }
        });
      }

      // Remove participant
      tournament.removeParticipant(userId);
      await tournament.save();

      // Refund entry fee
      const user = await User.findById(userId);
      user.addBalance(tournament.entryFee, 'playable');
      await user.save();

      // Create refund transaction
      const transaction = new Transaction({
        userId,
        type: 'refund',
        category: 'income',
        amount: tournament.entryFee,
        balanceBefore: user.playableBalance - tournament.entryFee,
        balanceAfter: user.playableBalance,
        paymentMethod: 'internal',
        description: `Tournament refund: ${tournament.title}`,
        tournamentId: tournament._id,
        status: 'completed'
      });

      await transaction.save();

      logger.business('tournament_left', {
        tournamentId: id,
        userId,
        refundAmount: tournament.entryFee
      });

      res.json({
        success: true,
        data: {
          tournament: tournament,
          newBalance: user.playableBalance
        },
        message: 'Successfully left tournament'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'leave_tournament',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to leave tournament'
        }
      });
    }
  }
);

// @route   GET /api/tournaments/:id/participants
// @desc    Get tournament participants
// @access  Private
router.get('/:id/participants',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const tournament = await Tournament.findById(id)
        .populate('participants.user', 'username avatar level rank totalXP')
        .select('participants title status');

      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      res.json({
        success: true,
        data: {
          participants: tournament.participants,
          totalParticipants: tournament.participants.length,
          maxParticipants: tournament.maxParticipants
        },
        message: 'Participants retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_tournament_participants',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve participants'
        }
      });
    }
  }
);

// @route   POST /api/tournaments/:id/start
// @desc    Start tournament (Admin only)
// @access  Private
router.post('/:id/start',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;

      const tournament = await Tournament.findById(id);
      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      // Start tournament
      tournament.startTournament();
      await tournament.save();

      logger.business('tournament_started', {
        tournamentId: id,
        startedBy: adminId,
        participants: tournament.participants.length
      });

      res.json({
        success: true,
        data: tournament,
        message: 'Tournament started successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'start_tournament',
        adminId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to start tournament'
        }
      });
    }
  }
);

// @route   POST /api/tournaments/:id/complete
// @desc    Complete tournament (Admin only)
// @access  Private
router.post('/:id/complete',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid tournament ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;

      const tournament = await Tournament.findById(id);
      if (!tournament) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TOURNAMENT_NOT_FOUND',
            message: 'Tournament not found'
          }
        });
      }

      // Complete tournament
      tournament.completeTournament();
      await tournament.save();

      // Distribute prizes to winners
      for (const participant of tournament.participants) {
        if (participant.prize > 0) {
          const user = await User.findById(participant.user);
          if (user) {
            user.addBalance(participant.prize, 'playable');
            await user.save();

            // Create prize transaction
            const transaction = new Transaction({
              userId: participant.user,
              type: 'tournament',
              category: 'income',
              amount: participant.prize,
              balanceBefore: user.playableBalance - participant.prize,
              balanceAfter: user.playableBalance,
              paymentMethod: 'internal',
              description: `Tournament prize: ${tournament.title} (Rank ${participant.rank})`,
              tournamentId: tournament._id,
              status: 'completed'
            });

            await transaction.save();
          }
        }
      }

      logger.business('tournament_completed', {
        tournamentId: id,
        completedBy: adminId,
        winner: tournament.winner,
        totalPrizes: tournament.stats.totalPrizes
      });

      res.json({
        success: true,
        data: tournament,
        message: 'Tournament completed successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'complete_tournament',
        adminId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to complete tournament'
        }
      });
    }
  }
);

module.exports = router;
