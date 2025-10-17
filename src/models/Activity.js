const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  // Activity info
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['login', 'logout', 'quiz_start', 'quiz_complete', 'tournament_join', 'tournament_leave', 'deposit', 'withdrawal', 'profile_update', 'achievement_unlock'],
    required: true
  },
  action: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },

  // Related entities
  relatedId: {
    type: mongoose.Schema.Types.ObjectId
  },
  relatedType: {
    type: String,
    enum: ['quiz', 'tournament', 'transaction', 'achievement', 'task']
  },

  // Activity data
  data: {
    type: mongoose.Schema.Types.Mixed
  },

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

  // Timestamps
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
activitySchema.index({ userId: 1, timestamp: -1 });
activitySchema.index({ type: 1, timestamp: -1 });
activitySchema.index({ relatedId: 1, relatedType: 1 });
activitySchema.index({ timestamp: -1 });

// Static methods
activitySchema.statics.getUserActivities = function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    type,
    startDate,
    endDate
  } = options;

  const skip = (page - 1) * limit;
  const query = { userId };

  if (type) query.type = type;
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = new Date(startDate);
    if (endDate) query.timestamp.$lte = new Date(endDate);
  }

  return this.find(query)
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit);
};

activitySchema.statics.getActivityStats = function(period = 'all') {
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

  const matchCondition = Object.keys(dateFilter).length > 0 ? { timestamp: dateFilter } : {};

  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' }
      }
    },
    {
      $project: {
        type: '$_id',
        count: 1,
        uniqueUsers: { $size: '$uniqueUsers' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

module.exports = mongoose.model('Activity', activitySchema);
