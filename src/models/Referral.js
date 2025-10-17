const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId: {
    type: String,
    required: true,
    index: true
  },
  referredId: {
    type: String,
    required: true,
    index: true
  },
  referralLink: {
    type: String,
    required: true
  },
  rewardAmount: {
    type: Number,
    required: true,
    default: 10
  },
  referredRewardAmount: {
    type: Number,
    required: true,
    default: 5
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending',
    index: true
  },
  bonusSent: {
    type: Boolean,
    default: false
  },
  referrerRewardSent: {
    type: Boolean,
    default: false
  },
  referredRewardSent: {
    type: Boolean,
    default: false
  },
  referrerRewardTransactionId: {
    type: String,
    default: null
  },
  referredRewardTransactionId: {
    type: String,
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better performance
referralSchema.index({ referrerId: 1, createdAt: -1 });
referralSchema.index({ referredId: 1 });
referralSchema.index({ status: 1, createdAt: -1 });
referralSchema.index({ referrerId: 1, status: 1 });

// Virtual for referral duration
referralSchema.virtual('duration').get(function() {
  if (this.processedAt) {
    return this.processedAt - this.createdAt;
  }
  return Date.now() - this.createdAt;
});

// Method to mark referral as completed
referralSchema.methods.markAsCompleted = function() {
  this.status = 'completed';
  this.processedAt = new Date();
  this.updatedAt = new Date();
  return this.save();
};

// Method to mark referral as cancelled
referralSchema.methods.markAsCancelled = function() {
  this.status = 'cancelled';
  this.updatedAt = new Date();
  return this.save();
};

// Method to mark bonus as sent
referralSchema.methods.markBonusSent = function(type, transactionId) {
  if (type === 'referrer') {
    this.referrerRewardSent = true;
    this.referrerRewardTransactionId = transactionId;
  } else if (type === 'referred') {
    this.referredRewardSent = true;
    this.referredRewardTransactionId = transactionId;
  }
  this.updatedAt = new Date();
  return this.save();
};

// Static method to get referral stats for a user
referralSchema.statics.getUserReferralStats = async function(userId) {
  try {
    const stats = await this.aggregate([
      {
        $match: {
          referrerId: userId
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalReward: { $sum: '$rewardAmount' }
        }
      }
    ]);

    const totalReferrals = await this.countDocuments({ referrerId: userId });
    const successfulReferrals = await this.countDocuments({ 
      referrerId: userId, 
      status: 'completed' 
    });
    const pendingReferrals = await this.countDocuments({ 
      referrerId: userId, 
      status: 'pending' 
    });
    const totalEarnings = await this.aggregate([
      {
        $match: {
          referrerId: userId,
          status: 'completed',
          referrerRewardSent: true
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$rewardAmount' }
        }
      }
    ]);

    return {
      totalReferrals,
      successfulReferrals,
      pendingReferrals,
      totalEarnings: totalEarnings.length > 0 ? totalEarnings[0].total : 0,
      statusBreakdown: stats
    };
  } catch (error) {
    console.error('Error getting referral stats:', error);
    throw error;
  }
};

// Static method to get referral leaderboard
referralSchema.statics.getReferralLeaderboard = async function(limit = 10) {
  try {
    const leaderboard = await this.aggregate([
      {
        $match: {
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$referrerId',
          totalReferrals: { $sum: 1 },
          totalEarnings: { $sum: '$rewardAmount' }
        }
      },
      {
        $sort: {
          totalReferrals: -1,
          totalEarnings: -1
        }
      },
      {
        $limit: limit
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'telegramId',
          as: 'user'
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          userId: '$_id',
          username: '$user.name',
          telegramUsername: '$user.telegramUsername',
          totalReferrals: 1,
          totalEarnings: 1
        }
      }
    ]);

    return leaderboard;
  } catch (error) {
    console.error('Error getting referral leaderboard:', error);
    throw error;
  }
};

// Static method to get pending referrals
referralSchema.statics.getPendingReferrals = async function() {
  try {
    return await this.find({
      status: 'pending',
      bonusSent: false
    }).sort({ createdAt: -1 });
  } catch (error) {
    console.error('Error getting pending referrals:', error);
    throw error;
  }
};

// Static method to process pending referrals
referralSchema.statics.processPendingReferrals = async function() {
  try {
    const pendingReferrals = await this.getPendingReferrals();
    const results = [];

    for (const referral of pendingReferrals) {
      try {
        // Check if referred user is active (has completed at least one quiz)
        const User = mongoose.model('User');
        const referredUser = await User.findOne({ telegramId: referral.referredId });
        
        if (referredUser && referredUser.quizStats && referredUser.quizStats.totalQuizzes > 0) {
          // Mark referral as completed and send rewards
          await referral.markAsCompleted();
          
          // TODO: Send actual rewards via balance service
          console.log(`Processing referral: ${referral.referrerId} -> ${referral.referredId}`);
          
          results.push({
            referralId: referral._id,
            status: 'processed',
            message: 'Referral processed successfully'
          });
        }
      } catch (error) {
        console.error(`Error processing referral ${referral._id}:`, error);
        results.push({
          referralId: referral._id,
          status: 'error',
          message: error.message
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error processing pending referrals:', error);
    throw error;
  }
};

// Pre-save middleware
referralSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Pre-validate middleware to ensure referrer and referred are different
referralSchema.pre('validate', function(next) {
  if (this.referrerId === this.referredId) {
    const error = new Error('Referrer and referred user cannot be the same');
    error.name = 'ValidationError';
    next(error);
  } else {
    next();
  }
});

const Referral = mongoose.model('Referral', referralSchema);

module.exports = Referral;
