const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  // Question content
  question: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  options: [{
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  }],
  correctAnswer: {
    type: Number,
    required: true,
    min: 0,
    max: 3
  },
  explanation: {
    type: String,
    trim: true,
    maxlength: 1000
  },

  // Question metadata
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    required: true,
    default: 'medium'
  },
  category: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  subcategory: {
    type: String,
    trim: true,
    maxlength: 50
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],

  // Scoring
  points: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
    default: 10
  },
  timeLimit: {
    type: Number,
    min: 10,
    max: 300,
    default: 30 // seconds
  },

  // Question source
  source: {
    type: String,
    enum: ['manual', 'ai', 'imported', 'user_submitted'],
    default: 'manual'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  aiGenerated: {
    type: Boolean,
    default: false
  },
  aiModel: {
    type: String
  },

  // Question status
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

  // Usage statistics
  timesUsed: {
    type: Number,
    default: 0,
    min: 0
  },
  correctAnswers: {
    type: Number,
    default: 0,
    min: 0
  },
  incorrectAnswers: {
    type: Number,
    default: 0,
    min: 0
  },
  averageTime: {
    type: Number,
    default: 0,
    min: 0
  },
  difficultyRating: {
    type: Number,
    min: 1,
    max: 5,
    default: 3
  },

  // Question quality
  qualityScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  reports: [{
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: {
      type: String,
      enum: ['incorrect_answer', 'poor_quality', 'inappropriate', 'duplicate', 'other']
    },
    description: String,
    reportedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'resolved', 'dismissed'],
      default: 'pending'
    }
  }],

  // Version control
  version: {
    type: Number,
    default: 1
  },
  previousVersions: [{
    question: String,
    options: [String],
    correctAnswer: Number,
    explanation: String,
    modifiedAt: Date,
    modifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],

  // Localization
  language: {
    type: String,
    default: 'en',
    maxlength: 5
  },
  translations: [{
    language: String,
    question: String,
    options: [String],
    explanation: String,
    translatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    translatedAt: Date
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
quizSchema.index({ category: 1, difficulty: 1 });
quizSchema.index({ isActive: 1, isVerified: 1 });
quizSchema.index({ tags: 1 });
quizSchema.index({ timesUsed: -1 });
quizSchema.index({ qualityScore: -1 });
quizSchema.index({ createdAt: -1 });

// Virtual fields
quizSchema.virtual('accuracy').get(function() {
  const total = this.correctAnswers + this.incorrectAnswers;
  return total > 0 ? (this.correctAnswers / total) * 100 : 0;
});

quizSchema.virtual('usageRate').get(function() {
  const daysSinceCreation = Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
  return daysSinceCreation > 0 ? this.timesUsed / daysSinceCreation : 0;
});

quizSchema.virtual('isReported').get(function() {
  return this.reports.some(report => report.status === 'pending');
});

// Pre-save middleware
quizSchema.pre('save', function(next) {
  // Validate options array
  if (this.options.length < 2 || this.options.length > 4) {
    return next(new Error('Question must have between 2 and 4 options'));
  }

  // Validate correct answer index
  if (this.correctAnswer < 0 || this.correctAnswer >= this.options.length) {
    return next(new Error('Correct answer index is invalid'));
  }

  // Update quality score based on usage
  if (this.timesUsed > 0) {
    this.updateQualityScore();
  }

  next();
});

// Instance methods
quizSchema.methods.updateQualityScore = function() {
  const accuracy = this.accuracy;
  const usageRate = this.usageRate;
  const reportsCount = this.reports.filter(r => r.status === 'pending').length;
  
  let score = 50; // Base score
  
  // Accuracy factor (0-30 points)
  score += (accuracy / 100) * 30;
  
  // Usage rate factor (0-20 points)
  score += Math.min(usageRate * 2, 20);
  
  // Reports penalty (-10 points per report)
  score -= reportsCount * 10;
  
  this.qualityScore = Math.max(0, Math.min(100, score));
};

quizSchema.methods.recordAnswer = function(isCorrect, timeSpent) {
  this.timesUsed += 1;
  
  if (isCorrect) {
    this.correctAnswers += 1;
  } else {
    this.incorrectAnswers += 1;
  }
  
  // Update average time
  const totalTime = this.averageTime * (this.timesUsed - 1) + timeSpent;
  this.averageTime = totalTime / this.timesUsed;
  
  this.updateQualityScore();
};

quizSchema.methods.reportQuestion = function(userId, reason, description) {
  this.reports.push({
    reportedBy: userId,
    reason,
    description,
    reportedAt: new Date(),
    status: 'pending'
  });
  
  this.updateQualityScore();
};

quizSchema.methods.createVersion = function(modifiedBy) {
  this.previousVersions.push({
    question: this.question,
    options: [...this.options],
    correctAnswer: this.correctAnswer,
    explanation: this.explanation,
    modifiedAt: new Date(),
    modifiedBy
  });
  
  this.version += 1;
};

quizSchema.methods.toSafeObject = function() {
  const quizObject = this.toObject();
  delete quizObject.correctAnswer;
  delete quizObject.explanation;
  delete quizObject.reports;
  delete quizObject.previousVersions;
  return quizObject;
};

// Static methods
quizSchema.statics.getRandomQuestions = function(category, difficulty, limit = 10) {
  const query = {
    isActive: true,
    isVerified: true,
    qualityScore: { $gte: 60 }
  };
  
  if (category) query.category = category;
  if (difficulty) query.difficulty = difficulty;
  
  return this.find(query)
    .select('-correctAnswer -explanation -reports -previousVersions')
    .sort({ qualityScore: -1, timesUsed: 1 })
    .limit(limit);
};

quizSchema.statics.getQuestionsByCategory = function(category, limit = 50) {
  return this.find({
    category,
    isActive: true,
    isVerified: true
  })
  .select('-correctAnswer -explanation -reports -previousVersions')
  .sort({ qualityScore: -1 })
  .limit(limit);
};

quizSchema.statics.getUnverifiedQuestions = function(limit = 20) {
  return this.find({
    isActive: true,
    isVerified: false
  })
  .populate('createdBy', 'username')
  .sort({ createdAt: -1 })
  .limit(limit);
};

quizSchema.statics.getReportedQuestions = function(limit = 20) {
  return this.find({
    'reports.status': 'pending'
  })
  .populate('createdBy', 'username')
  .populate('reports.reportedBy', 'username')
  .sort({ 'reports.reportedAt': -1 })
  .limit(limit);
};

quizSchema.statics.getStatistics = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalQuestions: { $sum: 1 },
        activeQuestions: { $sum: { $cond: ['$isActive', 1, 0] } },
        verifiedQuestions: { $sum: { $cond: ['$isVerified', 1, 0] } },
        totalUsage: { $sum: '$timesUsed' },
        averageQuality: { $avg: '$qualityScore' },
        categories: { $addToSet: '$category' },
        difficulties: { $addToSet: '$difficulty' }
      }
    }
  ]);
};

quizSchema.statics.getCategoryStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        activeCount: { $sum: { $cond: ['$isActive', 1, 0] } },
        verifiedCount: { $sum: { $cond: ['$isVerified', 1, 0] } },
        totalUsage: { $sum: '$timesUsed' },
        averageQuality: { $avg: '$qualityScore' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

module.exports = mongoose.model('Quiz', quizSchema);
