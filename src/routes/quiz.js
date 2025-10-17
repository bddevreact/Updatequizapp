const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Quiz = require('../models/Quiz');
const User = require('../models/User');
const { authenticate, authenticateAdmin } = require('../utils/auth');
const logger = require('../utils/logger');
const quizSecurityService = require('../services/quizSecurityService');
const aiQuestionService = require('../services/aiQuestionService');

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

// @route   GET /api/quiz/questions
// @desc    Get random questions for quiz
// @access  Private
router.get('/questions', 
  authenticate,
  [
    query('category').optional().isString().trim().isLength({ min: 1, max: 50 }),
    query('difficulty').optional().isIn(['easy', 'medium', 'hard']),
    query('limit').optional().isInt({ min: 1, max: 20 }).toInt()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { category, difficulty, limit = 10 } = req.query;
      const userId = req.user._id;

      // Security check before allowing quiz
      const securityCheck = await quizSecurityService.validateQuizStart(userId, difficulty);
      if (!securityCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: {
            code: securityCheck.code,
            message: securityCheck.message
          }
        });
      }

      // Get random questions
      const questions = await Quiz.getRandomQuestions(category, difficulty, limit);
      
      if (questions.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NO_QUESTIONS_FOUND',
            message: 'No questions available for the specified criteria'
          }
        });
      }

      // Shuffle questions and options
      const shuffledQuestions = questions.map(question => {
        const shuffledOptions = [...question.options];
        const correctAnswer = shuffledOptions[question.correctAnswer];
        
        // Shuffle options
        for (let i = shuffledOptions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
        }
        
        // Find new correct answer index
        const newCorrectAnswer = shuffledOptions.indexOf(correctAnswer);
        
        return {
          ...question.toSafeObject(),
          options: shuffledOptions,
          correctAnswer: newCorrectAnswer
        };
      });

      logger.business('quiz_questions_requested', {
        userId,
        category,
        difficulty,
        questionCount: shuffledQuestions.length
      });

      res.json({
        success: true,
        data: {
          questions: shuffledQuestions,
          totalQuestions: shuffledQuestions.length,
          timeLimit: shuffledQuestions.reduce((total, q) => total + q.timeLimit, 0)
        },
        message: 'Questions retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_quiz_questions',
        userId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve questions'
        }
      });
    }
  }
);

// @route   POST /api/quiz/submit
// @desc    Submit quiz answers and get results
// @access  Private
router.post('/submit',
  authenticate,
  [
    body('answers').isArray({ min: 1 }).withMessage('Answers array is required'),
    body('answers.*.questionId').isMongoId().withMessage('Invalid question ID'),
    body('answers.*.selectedAnswer').isInt({ min: 0, max: 3 }).withMessage('Invalid answer selection'),
    body('answers.*.timeSpent').isInt({ min: 1 }).withMessage('Time spent must be positive'),
    body('difficulty').optional().isIn(['easy', 'medium', 'hard']),
    body('category').optional().isString().trim()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { answers, difficulty, category } = req.body;
      const userId = req.user._id;

      // Security check
      const securityCheck = await quizSecurityService.validateQuizSubmission(userId, answers);
      if (!securityCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: {
            code: securityCheck.code,
            message: securityCheck.message
          }
        });
      }

      // Get questions with correct answers
      const questionIds = answers.map(answer => answer.questionId);
      const questions = await Quiz.find({
        _id: { $in: questionIds },
        isActive: true
      });

      if (questions.length !== answers.length) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUESTIONS',
            message: 'Some questions are invalid or inactive'
          }
        });
      }

      // Calculate results
      let correctCount = 0;
      let totalPoints = 0;
      let totalTimeSpent = 0;
      const results = [];

      for (const answer of answers) {
        const question = questions.find(q => q._id.toString() === answer.questionId);
        if (!question) continue;

        const isCorrect = answer.selectedAnswer === question.correctAnswer;
        const points = isCorrect ? question.points : 0;
        
        if (isCorrect) correctCount++;
        totalPoints += points;
        totalTimeSpent += answer.timeSpent;

        results.push({
          questionId: question._id,
          question: question.question,
          correctAnswer: question.correctAnswer,
          selectedAnswer: answer.selectedAnswer,
          isCorrect,
          points,
          timeSpent: answer.timeSpent,
          explanation: question.explanation
        });

        // Update question statistics
        question.recordAnswer(isCorrect, answer.timeSpent);
        await question.save();
      }

      const score = (correctCount / answers.length) * 100;
      const accuracy = score;

      // Update user statistics
      const user = await User.findById(userId);
      const levelUp = user.addXP(totalPoints);
      user.questionsAnswered += answers.length;
      user.correctAnswers += correctCount;
      user.averageScore = ((user.averageScore * (user.questionsAnswered - answers.length)) + score) / user.questionsAnswered;
      user.dailyQuizzesCompleted += 1;
      user.lastActivity = new Date();

      // Add balance if user won
      if (totalPoints > 0) {
        user.addBalance(totalPoints, 'playable');
      }

      await user.save();

      // Record quiz session
      await quizSecurityService.recordQuizSession(userId, {
        answers,
        score,
        totalPoints,
        totalTimeSpent,
        difficulty,
        category
      });

      logger.business('quiz_completed', {
        userId,
        score,
        totalPoints,
        correctAnswers: correctCount,
        totalQuestions: answers.length,
        difficulty,
        category,
        levelUp
      });

      res.json({
        success: true,
        data: {
          score,
          accuracy,
          totalPoints,
          correctAnswers: correctCount,
          totalQuestions: answers.length,
          totalTimeSpent,
          results,
          levelUp,
          newLevel: user.level,
          newXP: user.totalXP,
          newBalance: user.balance
        },
        message: 'Quiz submitted successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'submit_quiz',
        userId: req.user._id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to submit quiz'
        }
      });
    }
  }
);

// @route   GET /api/quiz/history
// @desc    Get user's quiz history
// @access  Private
router.get('/history',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('difficulty').optional().isIn(['easy', 'medium', 'hard']),
    query('category').optional().isString().trim()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { page = 1, limit = 20, difficulty, category } = req.query;
      const skip = (page - 1) * limit;

      // Get quiz history from security service
      const history = await quizSecurityService.getUserQuizHistory(userId, {
        skip,
        limit,
        difficulty,
        category
      });

      res.json({
        success: true,
        data: {
          history: history.quizzes,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(history.total / limit),
            totalQuizzes: history.total,
            hasNextPage: page < Math.ceil(history.total / limit),
            hasPrevPage: page > 1
          }
        },
        message: 'Quiz history retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_quiz_history',
        userId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve quiz history'
        }
      });
    }
  }
);

// @route   GET /api/quiz/leaderboard
// @desc    Get quiz leaderboard
// @access  Private
router.get('/leaderboard',
  authenticate,
  [
    query('type').optional().isIn(['xp', 'accuracy', 'streak', 'earnings']),
    query('period').optional().isIn(['daily', 'weekly', 'monthly', 'all']),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { type = 'xp', period = 'all', limit = 10 } = req.query;

      let leaderboard = [];

      switch (type) {
        case 'xp':
          leaderboard = await User.getLeaderboard(limit);
          break;
        case 'accuracy':
          leaderboard = await User.find({ isBlocked: false })
            .select('username level rank avatar questionsAnswered correctAnswers')
            .sort({ correctAnswers: -1, questionsAnswered: -1 })
            .limit(limit);
          break;
        case 'streak':
          leaderboard = await User.find({ isBlocked: false })
            .select('username level rank avatar streak')
            .sort({ streak: -1 })
            .limit(limit);
          break;
        case 'earnings':
          leaderboard = await User.getTopEarners(limit);
          break;
      }

      res.json({
        success: true,
        data: {
          leaderboard,
          type,
          period,
          totalUsers: leaderboard.length
        },
        message: 'Leaderboard retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_leaderboard',
        userId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve leaderboard'
        }
      });
    }
  }
);

// @route   GET /api/quiz/stats/:userId
// @desc    Get user's quiz statistics
// @access  Private
router.get('/stats/:userId',
  authenticate,
  [
    param('userId').isMongoId().withMessage('Invalid user ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user._id;

      // Users can only view their own stats unless they're admin
      if (userId !== currentUserId.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only view your own statistics'
          }
        });
      }

      const user = await User.findById(userId)
        .select('username level totalXP questionsAnswered correctAnswers averageScore streak totalEarned');

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      const stats = {
        username: user.username,
        level: user.level,
        totalXP: user.totalXP,
        questionsAnswered: user.questionsAnswered,
        correctAnswers: user.correctAnswers,
        accuracy: user.questionsAnswered > 0 ? (user.correctAnswers / user.questionsAnswered) * 100 : 0,
        averageScore: user.averageScore,
        streak: user.streak,
        totalEarned: user.totalEarned,
        rank: user.rank
      };

      res.json({
        success: true,
        data: stats,
        message: 'User statistics retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_user_stats',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user statistics'
        }
      });
    }
  }
);

// @route   POST /api/quiz/generate-ai
// @desc    Generate AI questions
// @access  Private (Admin only)
router.post('/generate-ai',
  authenticateAdmin,
  [
    body('count').isInt({ min: 1, max: 10 }).withMessage('Count must be between 1 and 10'),
    body('difficulty').isIn(['easy', 'medium', 'hard']).withMessage('Invalid difficulty'),
    body('category').isString().trim().isLength({ min: 1, max: 50 }).withMessage('Category is required'),
    body('subcategory').optional().isString().trim().isLength({ max: 50 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { count, difficulty, category, subcategory } = req.body;
      const adminId = req.user._id;

      // Generate AI questions
      const aiQuestions = await aiQuestionService.generateQuestions({
        count,
        difficulty,
        category,
        subcategory
      });

      // Save questions to database
      const savedQuestions = [];
      for (const questionData of aiQuestions) {
        const question = new Quiz({
          ...questionData,
          source: 'ai',
          createdBy: adminId,
          aiGenerated: true,
          aiModel: 'gpt-3.5-turbo',
          isVerified: false // AI questions need manual verification
        });

        await question.save();
        savedQuestions.push(question);
      }

      logger.business('ai_questions_generated', {
        adminId,
        count,
        difficulty,
        category,
        subcategory,
        questionIds: savedQuestions.map(q => q._id)
      });

      res.json({
        success: true,
        data: {
          questions: savedQuestions,
          count: savedQuestions.length
        },
        message: 'AI questions generated successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'generate_ai_questions',
        adminId: req.user._id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate AI questions'
        }
      });
    }
  }
);

module.exports = router;
