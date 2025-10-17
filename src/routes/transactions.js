const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
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

// @route   POST /api/transactions/deposit
// @desc    Create deposit request
// @access  Private
router.post('/deposit',
  authenticate,
  [
    body('amount').isNumeric().isFloat({ min: 1 }).withMessage('Amount must be at least 1 USDT'),
    body('network').isIn(['TRC20', 'ERC20', 'BEP20', 'Polygon', 'Arbitrum', 'Optimism']).withMessage('Invalid network'),
    body('txHash').optional().isString().trim().withMessage('Transaction hash must be a string'),
    body('fromAddress').optional().isString().trim().withMessage('From address must be a string'),
    body('depositProof').optional().isString().trim().withMessage('Deposit proof must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { amount, network, txHash, fromAddress, depositProof } = req.body;

      // Get user current balance
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Check minimum deposit amount
      const minDeposit = 10; // Minimum 10 USDT
      if (amount < minDeposit) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MIN_DEPOSIT_ERROR',
            message: `Minimum deposit amount is ${minDeposit} USDT`
          }
        });
      }

      // Check maximum deposit amount
      const maxDeposit = 10000; // Maximum 10,000 USDT
      if (amount > maxDeposit) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MAX_DEPOSIT_ERROR',
            message: `Maximum deposit amount is ${maxDeposit} USDT`
          }
        });
      }

      // Create deposit transaction
      const transaction = new Transaction({
        userId,
        type: 'deposit',
        category: 'income',
        amount,
        balanceBefore: user.playableBalance,
        balanceAfter: user.playableBalance, // Will be updated after approval
        paymentMethod: 'crypto',
        network,
        txHash,
        fromAddress,
        depositProof,
        description: `Deposit via ${network}`,
        status: 'pending',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      await transaction.save();

      logger.business('deposit_requested', {
        transactionId: transaction.transactionId,
        userId,
        amount,
        network,
        txHash
      });

      res.status(201).json({
        success: true,
        data: transaction,
        message: 'Deposit request submitted successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'create_deposit',
        userId: req.user._id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create deposit request'
        }
      });
    }
  }
);

// @route   GET /api/transactions/deposits
// @desc    Get user deposits
// @access  Private
router.get('/deposits',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('status').optional().isIn(['pending', 'processing', 'completed', 'failed', 'cancelled'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { page = 1, limit = 20, status } = req.query;

      const deposits = await Transaction.getUserTransactions(userId, {
        page,
        limit,
        type: 'deposit',
        status,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      res.json({
        success: true,
        data: deposits,
        message: 'Deposits retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_deposits',
        userId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve deposits'
        }
      });
    }
  }
);

// @route   GET /api/transactions/deposits/:id
// @desc    Get deposit by ID
// @access  Private
router.get('/deposits/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid deposit ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const deposit = await Transaction.findOne({
        _id: id,
        userId,
        type: 'deposit'
      }).populate('processedBy', 'username');

      if (!deposit) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'DEPOSIT_NOT_FOUND',
            message: 'Deposit not found'
          }
        });
      }

      res.json({
        success: true,
        data: deposit,
        message: 'Deposit retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_deposit',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve deposit'
        }
      });
    }
  }
);

// @route   PUT /api/transactions/deposits/:id/approve
// @desc    Approve deposit (Admin only)
// @access  Private
router.put('/deposits/:id/approve',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid deposit ID'),
    body('adminNotes').optional().isString().trim().isLength({ max: 1000 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const { adminNotes } = req.body;

      const deposit = await Transaction.findById(id);
      if (!deposit) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'DEPOSIT_NOT_FOUND',
            message: 'Deposit not found'
          }
        });
      }

      if (deposit.type !== 'deposit') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TRANSACTION_TYPE',
            message: 'Transaction is not a deposit'
          }
        });
      }

      if (deposit.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'DEPOSIT_ALREADY_PROCESSED',
            message: 'Deposit has already been processed'
          }
        });
      }

      // Approve deposit
      deposit.approve(adminId, adminNotes);
      await deposit.save();

      // Update user balance
      const user = await User.findById(deposit.userId);
      if (user) {
        user.addBalance(deposit.amount, 'playable');
        user.hasDeposited = true;
        await user.save();

        // Update transaction balance
        deposit.balanceAfter = user.playableBalance;
        await deposit.save();
      }

      logger.business('deposit_approved', {
        transactionId: deposit.transactionId,
        depositId: id,
        approvedBy: adminId,
        amount: deposit.amount,
        userId: deposit.userId
      });

      res.json({
        success: true,
        data: deposit,
        message: 'Deposit approved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'approve_deposit',
        adminId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to approve deposit'
        }
      });
    }
  }
);

// @route   PUT /api/transactions/deposits/:id/reject
// @desc    Reject deposit (Admin only)
// @access  Private
router.put('/deposits/:id/reject',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid deposit ID'),
    body('reason').isString().trim().isLength({ min: 1, max: 500 }).withMessage('Rejection reason is required'),
    body('adminNotes').optional().isString().trim().isLength({ max: 1000 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const { reason, adminNotes } = req.body;

      const deposit = await Transaction.findById(id);
      if (!deposit) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'DEPOSIT_NOT_FOUND',
            message: 'Deposit not found'
          }
        });
      }

      if (deposit.type !== 'deposit') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TRANSACTION_TYPE',
            message: 'Transaction is not a deposit'
          }
        });
      }

      if (deposit.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'DEPOSIT_ALREADY_PROCESSED',
            message: 'Deposit has already been processed'
          }
        });
      }

      // Reject deposit
      deposit.reject(adminId, reason, adminNotes);
      await deposit.save();

      logger.business('deposit_rejected', {
        transactionId: deposit.transactionId,
        depositId: id,
        rejectedBy: adminId,
        reason,
        userId: deposit.userId
      });

      res.json({
        success: true,
        data: deposit,
        message: 'Deposit rejected successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'reject_deposit',
        adminId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reject deposit'
        }
      });
    }
  }
);

// @route   POST /api/transactions/withdrawals
// @desc    Create withdrawal request
// @access  Private
router.post('/withdrawals',
  authenticate,
  [
    body('amount').isNumeric().isFloat({ min: 10 }).withMessage('Amount must be at least 10 USDT'),
    body('network').isIn(['TRC20', 'ERC20', 'BEP20', 'Polygon', 'Arbitrum', 'Optimism']).withMessage('Invalid network'),
    body('toAddress').isString().trim().isLength({ min: 10 }).withMessage('Valid wallet address is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { amount, network, toAddress } = req.body;

      // Get user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Check if user can withdraw
      if (!user.canWithdraw()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WITHDRAWAL_NOT_ALLOWED',
            message: 'Withdrawal is not allowed. Please complete KYC verification and make a deposit first.'
          }
        });
      }

      // Check minimum withdrawal amount
      const minWithdrawal = 10; // Minimum 10 USDT
      if (amount < minWithdrawal) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MIN_WITHDRAWAL_ERROR',
            message: `Minimum withdrawal amount is ${minWithdrawal} USDT`
          }
        });
      }

      // Check maximum withdrawal amount
      const maxWithdrawal = 5000; // Maximum 5,000 USDT
      if (amount > maxWithdrawal) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MAX_WITHDRAWAL_ERROR',
            message: `Maximum withdrawal amount is ${maxWithdrawal} USDT`
          }
        });
      }

      // Check user balance
      if (user.playableBalance < amount) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient balance for withdrawal'
          }
        });
      }

      // Calculate withdrawal fee
      const withdrawalFee = Math.max(amount * 0.02, 1); // 2% fee, minimum 1 USDT
      const netAmount = amount - withdrawalFee;

      // Create withdrawal transaction
      const transaction = new Transaction({
        userId,
        type: 'withdrawal',
        category: 'expense',
        amount,
        fee: withdrawalFee,
        netAmount,
        balanceBefore: user.playableBalance,
        balanceAfter: user.playableBalance, // Will be updated after approval
        paymentMethod: 'crypto',
        network,
        toAddress,
        description: `Withdrawal to ${network} address`,
        status: 'pending',
        withdrawalRequest: {
          requestedAt: new Date()
        },
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      await transaction.save();

      logger.business('withdrawal_requested', {
        transactionId: transaction.transactionId,
        userId,
        amount,
        netAmount,
        fee: withdrawalFee,
        network,
        toAddress
      });

      res.status(201).json({
        success: true,
        data: transaction,
        message: 'Withdrawal request submitted successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'create_withdrawal',
        userId: req.user._id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create withdrawal request'
        }
      });
    }
  }
);

// @route   GET /api/transactions/withdrawals
// @desc    Get user withdrawals
// @access  Private
router.get('/withdrawals',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('status').optional().isIn(['pending', 'processing', 'completed', 'failed', 'cancelled'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { page = 1, limit = 20, status } = req.query;

      const withdrawals = await Transaction.getUserTransactions(userId, {
        page,
        limit,
        type: 'withdrawal',
        status,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      res.json({
        success: true,
        data: withdrawals,
        message: 'Withdrawals retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_withdrawals',
        userId: req.user._id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve withdrawals'
        }
      });
    }
  }
);

// @route   GET /api/transactions/withdrawals/:id
// @desc    Get withdrawal by ID
// @access  Private
router.get('/withdrawals/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid withdrawal ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const withdrawal = await Transaction.findOne({
        _id: id,
        userId,
        type: 'withdrawal'
      }).populate('processedBy', 'username');

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'WITHDRAWAL_NOT_FOUND',
            message: 'Withdrawal not found'
          }
        });
      }

      res.json({
        success: true,
        data: withdrawal,
        message: 'Withdrawal retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_withdrawal',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve withdrawal'
        }
      });
    }
  }
);

// @route   PUT /api/transactions/withdrawals/:id/approve
// @desc    Approve withdrawal (Admin only)
// @access  Private
router.put('/withdrawals/:id/approve',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid withdrawal ID'),
    body('txHash').optional().isString().trim().withMessage('Transaction hash must be a string'),
    body('adminNotes').optional().isString().trim().isLength({ max: 1000 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const { txHash, adminNotes } = req.body;

      const withdrawal = await Transaction.findById(id);
      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'WITHDRAWAL_NOT_FOUND',
            message: 'Withdrawal not found'
          }
        });
      }

      if (withdrawal.type !== 'withdrawal') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TRANSACTION_TYPE',
            message: 'Transaction is not a withdrawal'
          }
        });
      }

      if (withdrawal.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WITHDRAWAL_ALREADY_PROCESSED',
            message: 'Withdrawal has already been processed'
          }
        });
      }

      // Approve withdrawal
      withdrawal.approve(adminId, adminNotes);
      if (txHash) {
        withdrawal.txHash = txHash;
      }
      await withdrawal.save();

      // Update user balance
      const user = await User.findById(withdrawal.userId);
      if (user) {
        user.deductBalance(withdrawal.amount, 'playable');
        await user.save();

        // Update transaction balance
        withdrawal.balanceAfter = user.playableBalance;
        await withdrawal.save();
      }

      logger.business('withdrawal_approved', {
        transactionId: withdrawal.transactionId,
        withdrawalId: id,
        approvedBy: adminId,
        amount: withdrawal.amount,
        netAmount: withdrawal.netAmount,
        userId: withdrawal.userId,
        txHash
      });

      res.json({
        success: true,
        data: withdrawal,
        message: 'Withdrawal approved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'approve_withdrawal',
        adminId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to approve withdrawal'
        }
      });
    }
  }
);

// @route   PUT /api/transactions/withdrawals/:id/reject
// @desc    Reject withdrawal (Admin only)
// @access  Private
router.put('/withdrawals/:id/reject',
  authenticateAdmin,
  [
    param('id').isMongoId().withMessage('Invalid withdrawal ID'),
    body('reason').isString().trim().isLength({ min: 1, max: 500 }).withMessage('Rejection reason is required'),
    body('adminNotes').optional().isString().trim().isLength({ max: 1000 })
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user._id;
      const { reason, adminNotes } = req.body;

      const withdrawal = await Transaction.findById(id);
      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'WITHDRAWAL_NOT_FOUND',
            message: 'Withdrawal not found'
          }
        });
      }

      if (withdrawal.type !== 'withdrawal') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TRANSACTION_TYPE',
            message: 'Transaction is not a withdrawal'
          }
        });
      }

      if (withdrawal.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WITHDRAWAL_ALREADY_PROCESSED',
            message: 'Withdrawal has already been processed'
          }
        });
      }

      // Reject withdrawal
      withdrawal.reject(adminId, reason, adminNotes);
      await withdrawal.save();

      logger.business('withdrawal_rejected', {
        transactionId: withdrawal.transactionId,
        withdrawalId: id,
        rejectedBy: adminId,
        reason,
        userId: withdrawal.userId
      });

      res.json({
        success: true,
        data: withdrawal,
        message: 'Withdrawal rejected successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'reject_withdrawal',
        adminId: req.user._id,
        params: req.params,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reject withdrawal'
        }
      });
    }
  }
);

// @route   GET /api/transactions
// @desc    Get all user transactions
// @access  Private
router.get('/',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('type').optional().isIn(['deposit', 'withdrawal', 'quiz', 'tournament', 'referral', 'bonus', 'daily_bonus', 'task', 'refund']),
    query('status').optional().isIn(['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { page = 1, limit = 20, type, status, startDate, endDate } = req.query;

      const transactions = await Transaction.getUserTransactions(userId, {
        page,
        limit,
        type,
        status,
        startDate,
        endDate,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      res.json({
        success: true,
        data: transactions,
        message: 'Transactions retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_transactions',
        userId: req.user._id,
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

// @route   GET /api/transactions/:id
// @desc    Get transaction by ID
// @access  Private
router.get('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid transaction ID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const transaction = await Transaction.findOne({
        _id: id,
        userId
      }).populate('processedBy', 'username')
        .populate('tournamentId', 'title')
        .populate('referralId', 'username');

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TRANSACTION_NOT_FOUND',
            message: 'Transaction not found'
          }
        });
      }

      res.json({
        success: true,
        data: transaction,
        message: 'Transaction retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_transaction',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve transaction'
        }
      });
    }
  }
);

module.exports = router;
