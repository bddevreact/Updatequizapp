const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  // Task basic info
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  category: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  type: {
    type: String,
    enum: ['social', 'referral', 'verification', 'quiz', 'tournament', 'custom'],
    required: true,
    default: 'custom'
  },

  // Task requirements
  requirements: {
    description: String,
    minFollowers: Number,
    minPosts: Number,
    requiredActions: [String],
    verificationSteps: [String]
  },

  // Rewards
  reward: {
    type: Number,
    required: true,
    min: 0
  },
  rewardType: {
    type: String,
    enum: ['playable', 'bonus'],
    default: 'playable'
  },
  maxCompletions: {
    type: Number,
    default: 1,
    min: 1
  },

  // Task status
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  },

  // Task settings
  settings: {
    autoApprove: {
      type: Boolean,
      default: false
    },
    requireProof: {
      type: Boolean,
      default: true
    },
    allowMultiple: {
      type: Boolean,
      default: false
    },
    timeLimit: {
      type: Number,
      default: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    }
  },

  // Statistics
  stats: {
    totalCompletions: {
      type: Number,
      default: 0,
      min: 0
    },
    totalRewards: {
      type: Number,
      default: 0,
      min: 0
    },
    completionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    averageCompletionTime: {
      type: Number,
      default: 0,
      min: 0
    }
  },

  // Creator info
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Expiry
  expiresAt: {
    type: Date
  },

  // Priority
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
taskSchema.index({ isActive: 1, isVerified: 1 });
taskSchema.index({ category: 1, type: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ expiresAt: 1 });
taskSchema.index({ priority: -1, createdAt: -1 });

// Virtual fields
taskSchema.virtual('isExpired').get(function() {
  return this.expiresAt && new Date() > this.expiresAt;
});

taskSchema.virtual('canComplete').get(function() {
  return this.isActive && this.isVerified && !this.isExpired;
});

// Static methods
taskSchema.statics.getActiveTasks = function() {
  return this.find({
    isActive: true,
    isVerified: true,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ]
  })
  .populate('createdBy', 'username')
  .sort({ priority: -1, createdAt: -1 });
};

taskSchema.statics.getTasksByCategory = function(category) {
  return this.find({
    category,
    isActive: true,
    isVerified: true
  })
  .populate('createdBy', 'username')
  .sort({ priority: -1, createdAt: -1 });
};

module.exports = mongoose.model('Task', taskSchema);
