const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema({
  // Achievement info
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  category: {
    type: String,
    enum: ['quiz', 'tournament', 'referral', 'streak', 'level', 'special'],
    required: true
  },
  type: {
    type: String,
    enum: ['milestone', 'streak', 'score', 'participation', 'special'],
    required: true
  },

  // Requirements
  requirements: {
    target: {
      type: Number,
      required: true,
      min: 0
    },
    condition: {
      type: String,
      enum: ['equals', 'greater_than', 'less_than', 'multiple_of'],
      default: 'greater_than'
    },
    field: {
      type: String,
      required: true
    }
  },

  // Rewards
  reward: {
    xp: {
      type: Number,
      default: 0,
      min: 0
    },
    balance: {
      type: Number,
      default: 0,
      min: 0
    },
    badge: {
      type: String,
      trim: true
    },
    title: {
      type: String,
      trim: true
    }
  },

  // Achievement settings
  isActive: {
    type: Boolean,
    default: true
  },
  isHidden: {
    type: Boolean,
    default: false
  },
  isRepeatable: {
    type: Boolean,
    default: false
  },
  maxCompletions: {
    type: Number,
    default: 1,
    min: 1
  },

  // Statistics
  stats: {
    totalUnlocked: {
      type: Number,
      default: 0,
      min: 0
    },
    unlockRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },

  // Priority for display
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },

  // Icon and visual
  icon: {
    type: String,
    default: '🏆'
  },
  color: {
    type: String,
    default: '#FFD700'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
achievementSchema.index({ category: 1, type: 1 });
achievementSchema.index({ isActive: 1, priority: -1 });
achievementSchema.index({ 'requirements.field': 1 });

// Static methods
achievementSchema.statics.getActiveAchievements = function() {
  return this.find({ isActive: true })
    .sort({ priority: -1, createdAt: -1 });
};

achievementSchema.statics.getAchievementsByCategory = function(category) {
  return this.find({ 
    category, 
    isActive: true 
  })
  .sort({ priority: -1, createdAt: -1 });
};

achievementSchema.statics.checkUserAchievements = async function(userId) {
  const User = require('./User');
  const user = await User.findById(userId);
  
  if (!user) return [];

  const achievements = await this.getActiveAchievements();
  const unlockedAchievements = [];

  for (const achievement of achievements) {
    const isUnlocked = await this.checkAchievementUnlocked(user, achievement);
    if (isUnlocked) {
      unlockedAchievements.push(achievement);
    }
  }

  return unlockedAchievements;
};

achievementSchema.statics.checkAchievementUnlocked = async function(user, achievement) {
  const { requirements } = achievement;
  const fieldValue = user[requirements.field];

  if (fieldValue === undefined) return false;

  let isUnlocked = false;

  switch (requirements.condition) {
    case 'equals':
      isUnlocked = fieldValue === requirements.target;
      break;
    case 'greater_than':
      isUnlocked = fieldValue > requirements.target;
      break;
    case 'less_than':
      isUnlocked = fieldValue < requirements.target;
      break;
    case 'multiple_of':
      isUnlocked = fieldValue % requirements.target === 0;
      break;
  }

  return isUnlocked;
};

module.exports = mongoose.model('Achievement', achievementSchema);
