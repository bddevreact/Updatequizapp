const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Transaction identification
  transactionId: {
    type: String,
    unique: true,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Transaction details
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'quiz', 'tournament', 'referral', 'bonus', 'daily_bonus', 'task', 'refund'],
    required: true
  },
  category: {
    type: String,
    enum: ['income', 'expense', 'transfer'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USDT',
    maxlength: 10
  },

  // Transaction status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },

  // Financial details
  balanceBefore: {
    type: Number,
    required: true,
    min: 0
  },
  balanceAfter: {
    type: Number,
    required: true,
    min: 0
  },
  fee: {
    type: Number,
    default: 0,
    min: 0
  },
  netAmount: {
    type: Number,
    required: true
  },

  // Payment method
  paymentMethod: {
    type: String,
    enum: ['crypto', 'bank_transfer', 'card', 'internal', 'referral', 'bonus'],
    required: true
  },
  network: {
    type: String,
    enum: ['TRC20', 'ERC20', 'BEP20', 'Polygon', 'Arbitrum', 'Optimism'],
    required: function() {
      return this.paymentMethod === 'crypto';
    }
  },

  // Blockchain details
  txHash: {
    type: String,
    trim: true,
    sparse: true
  },
  blockNumber: {
    type: Number
  },
  confirmations: {
    type: Number,
    default: 0
  },
  gasUsed: {
    type: Number
  },
  gasPrice: {
    type: Number
  },

  // Wallet addresses
  fromAddress: {
    type: String,
    trim: true
  },
  toAddress: {
    type: String,
    trim: true
  },
  walletAddress: {
    type: String,
    trim: true
  },

  // Deposit/Withdrawal specific
  depositProof: {
    type: String // File path or URL
  },
  withdrawalRequest: {
    requestedAt: Date,
    processedAt: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectionReason: String
  },

  // Related entities
  relatedTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament'
  },
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz'
  },
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
  referralId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Admin processing
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  processedAt: Date,
  adminNotes: {
    type: String,
    trim: true,
    maxlength: 1000
  },

  // Risk assessment
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'low'
  },
  riskFactors: [{
    factor: String,
    score: Number,
    description: String
  }],
  flagged: {
    type: Boolean,
    default: false
  },
  flaggedReason: String,
  flaggedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Compliance
  kycRequired: {
    type: Boolean,
    default: false
  },
  kycVerified: {
    type: Boolean,
    default: false
  },
  complianceNotes: String,

  // Timestamps
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  expiresAt: Date,

  // Metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceInfo: String,
    location: {
      country: String,
      city: String,
      coordinates: {
        lat: Number,
        lng: Number
      }
    }
  },

  // Recurring transactions
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringPattern: {
    type: String,
    enum: ['daily', 'weekly', 'monthly']
  },
  parentTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },

  // Exchange rates (for multi-currency support)
  exchangeRate: {
    type: Number,
    default: 1
  },
  originalAmount: {
    type: Number
  },
  originalCurrency: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ txHash: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ paymentMethod: 1 });
transactionSchema.index({ network: 1 });
transactionSchema.index({ tournamentId: 1 });
transactionSchema.index({ flagged: 1 });
transactionSchema.index({ createdAt: -1 });

// Virtual fields
transactionSchema.virtual('isCompleted').get(function() {
  return this.status === 'completed';
});

transactionSchema.virtual('isPending').get(function() {
  return this.status === 'pending' || this.status === 'processing';
});

transactionSchema.virtual('isFailed').get(function() {
  return this.status === 'failed' || this.status === 'cancelled';
});

transactionSchema.virtual('processingTime').get(function() {
  if (this.completedAt && this.initiatedAt) {
    return this.completedAt.getTime() - this.initiatedAt.getTime();
  }
  return null;
});

transactionSchema.virtual('isExpired').get(function() {
  if (this.expiresAt) {
    return new Date() > this.expiresAt;
  }
  return false;
});

// Pre-save middleware
transactionSchema.pre('save', function(next) {
  // Generate transaction ID if not exists
  if (!this.transactionId) {
    this.transactionId = this.generateTransactionId();
  }

  // Calculate net amount
  this.netAmount = this.amount - this.fee;

  // Set expiration for pending transactions
  if (this.status === 'pending' && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  }

  // Update completion timestamp
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }

  next();
});

// Instance methods
transactionSchema.methods.generateTransactionId = function() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `TXN_${timestamp}_${random}`.toUpperCase();
};

transactionSchema.methods.approve = function(adminId, notes) {
  if (this.status !== 'pending') {
    throw new Error('Only pending transactions can be approved');
  }

  this.status = 'completed';
  this.processedBy = adminId;
  this.processedAt = new Date();
  this.adminNotes = notes;

  return this;
};

transactionSchema.methods.reject = function(adminId, reason, notes) {
  if (this.status !== 'pending') {
    throw new Error('Only pending transactions can be rejected');
  }

  this.status = 'failed';
  this.processedBy = adminId;
  this.processedAt = new Date();
  this.withdrawalRequest.rejectionReason = reason;
  this.adminNotes = notes;

  return this;
};

transactionSchema.methods.flag = function(adminId, reason) {
  this.flagged = true;
  this.flaggedReason = reason;
  this.flaggedBy = adminId;

  return this;
};

transactionSchema.methods.unflag = function(adminId) {
  this.flagged = false;
  this.flaggedReason = undefined;
  this.flaggedBy = adminId;

  return this;
};

transactionSchema.methods.refund = function(adminId, reason) {
  if (this.status !== 'completed') {
    throw new Error('Only completed transactions can be refunded');
  }

  this.status = 'refunded';
  this.processedBy = adminId;
  this.processedAt = new Date();
  this.adminNotes = `Refunded: ${reason}`;

  return this;
};

transactionSchema.methods.updateRiskLevel = function(factors) {
  this.riskFactors = factors;
  
  // Calculate risk score
  const totalScore = factors.reduce((sum, factor) => sum + factor.score, 0);
  const averageScore = totalScore / factors.length;

  if (averageScore >= 7) {
    this.riskLevel = 'high';
  } else if (averageScore >= 4) {
    this.riskLevel = 'medium';
  } else {
    this.riskLevel = 'low';
  }

  return this;
};

// Static methods
transactionSchema.statics.getUserTransactions = function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    type,
    status,
    startDate,
    endDate,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = options;

  const skip = (page - 1) * limit;
  const query = { userId };

  if (type) query.type = type;
  if (status) query.status = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  return this.find(query)
    .populate('tournamentId', 'title')
    .populate('processedBy', 'username')
    .sort(sort)
    .skip(skip)
    .limit(limit);
};

transactionSchema.statics.getPendingTransactions = function() {
  return this.find({
    status: { $in: ['pending', 'processing'] }
  })
  .populate('userId', 'username email')
  .populate('processedBy', 'username')
  .sort({ createdAt: 1 });
};

transactionSchema.statics.getFlaggedTransactions = function() {
  return this.find({
    flagged: true
  })
  .populate('userId', 'username email')
  .populate('flaggedBy', 'username')
  .sort({ createdAt: -1 });
};

transactionSchema.statics.getTransactionStats = function(period = 'all') {
  const dateFilter = {};
  
  if (period !== 'all') {
    const now = new Date();
    switch (period) {
      case 'today':
        dateFilter.$gte = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        dateFilter.$gte = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        dateFilter.$gte = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        dateFilter.$gte = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
    }
  }

  const matchCondition = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: null,
        totalTransactions: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        totalFees: { $sum: '$fee' },
        completedTransactions: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        pendingTransactions: { $sum: { $cond: [{ $in: ['$status', ['pending', 'processing']] }, 1, 0] } },
        failedTransactions: { $sum: { $cond: [{ $in: ['$status', ['failed', 'cancelled']] }, 1, 0] } },
        flaggedTransactions: { $sum: { $cond: ['$flagged', 1, 0] } },
        averageAmount: { $avg: '$amount' },
        deposits: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
        withdrawals: { $sum: { $cond: [{ $eq: ['$type', 'withdrawal'] }, '$amount', 0] } },
        quizEarnings: { $sum: { $cond: [{ $eq: ['$type', 'quiz'] }, '$amount', 0] } },
        tournamentEarnings: { $sum: { $cond: [{ $eq: ['$type', 'tournament'] }, '$amount', 0] } }
      }
    }
  ]);
};

transactionSchema.statics.getTransactionSummary = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        pendingCount: { $sum: { $cond: [{ $in: ['$status', ['pending', 'processing']] }, 1, 0] } }
      }
    },
    { $sort: { totalAmount: -1 } }
  ]);
};

module.exports = mongoose.model('Transaction', transactionSchema);
