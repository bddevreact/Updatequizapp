const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Telegram specific fields
  telegramId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  telegramUsername: {
    type: String,
    sparse: true
  },
  telegramFullName: {
    type: String
  },
  telegramPhotoUrl: {
    type: String
  },
  telegramLanguageCode: {
    type: String,
    default: 'en'
  },
  telegramIsPremium: {
    type: Boolean,
    default: false
  },

  // User profile fields
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  avatar: {
    type: String
  },

  // Authentication fields
  password: {
    type: String,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'moderator'],
    default: 'user'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  blockedReason: {
    type: String
  },
  blockedAt: {
    type: Date
  },
  blockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Financial fields
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  playableBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  bonusBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalEarned: {
    type: Number,
    default: 0,
    min: 0
  },
  totalDeposited: {
    type: Number,
    default: 0,
    min: 0
  },
  totalWithdrawn: {
    type: Number,
    default: 0,
    min: 0
  },

  // Game progression fields
  level: {
    type: Number,
    default: 1,
    min: 1
  },
  xp: {
    type: Number,
    default: 0,
    min: 0
  },
  totalXP: {
    type: Number,
    default: 0,
    min: 0
  },
  rank: {
    type: String,
    enum: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'],
    default: 'Bronze'
  },
  streak: {
    type: Number,
    default: 0,
    min: 0
  },

  // Quiz statistics
  dailyQuizzesCompleted: {
    type: Number,
    default: 0,
    min: 0
  },
  maxDailyQuizzes: {
    type: Number,
    default: 10,
    min: 1
  },
  weeklyEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  monthlyEarnings: {
    type: Number,
    default: 0,
    min: 0
  },

  // Tournament statistics
  tournamentsWon: {
    type: Number,
    default: 0,
    min: 0
  },
  totalTournaments: {
    type: Number,
    default: 0,
    min: 0
  },
  winRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  // Quiz performance
  questionsAnswered: {
    type: Number,
    default: 0,
    min: 0
  },
  correctAnswers: {
    type: Number,
    default: 0,
    min: 0
  },
  averageScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  // Referral system
  referralCode: {
    type: String,
    unique: true,
    required: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  referrerId: {
    type: String,
    index: true
  },
  referrerTelegramId: {
    type: String,
    index: true
  },
  referralEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  invitedFriends: {
    type: Number,
    default: 0,
    min: 0
  },
  successfulReferrals: {
    type: Number,
    default: 0
  },
  pendingReferrals: {
    type: Number,
    default: 0
  },
  referralRewardTotal: {
    type: Number,
    default: 0
  },
  lastReferralAt: {
    type: Date
  },
  referralLink: {
    type: String
  },
  maxInvites: {
    type: Number,
    default: 50,
    min: 1
  },

  // Account status
  hasDeposited: {
    type: Boolean,
    default: false
  },
  withdrawalEnabled: {
    type: Boolean,
    default: false
  },
  kycStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },

  // Online status
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },

  // Timestamps
  lastLogin: {
    type: Date
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  joinDate: {
    type: Date,
    default: Date.now
  },

  // Settings
  settings: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    },
    privacy: {
      showProfile: { type: Boolean, default: true },
      showStats: { type: Boolean, default: true },
      showAchievements: { type: Boolean, default: true }
    },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
      language: { type: String, default: 'en' },
      timezone: { type: String, default: 'UTC' }
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
userSchema.index({ telegramId: 1 });
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ referralCode: 1 });
userSchema.index({ level: -1, totalXP: -1 });
userSchema.index({ totalEarned: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ lastActivity: -1 });

// Virtual fields
userSchema.virtual('winPercentage').get(function() {
  return this.totalTournaments > 0 ? (this.tournamentsWon / this.totalTournaments) * 100 : 0;
});

userSchema.virtual('accuracy').get(function() {
  return this.questionsAnswered > 0 ? (this.correctAnswers / this.questionsAnswered) * 100 : 0;
});

userSchema.virtual('accountAge').get(function() {
  return Math.floor((Date.now() - this.joinDate) / (1000 * 60 * 60 * 24));
});

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Hash password if it's modified
  if (this.isModified('password') && this.password) {
    const bcrypt = require('bcryptjs');
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    this.password = await bcrypt.hash(this.password, saltRounds);
  }

  // Generate referral code if not exists
  if (!this.referralCode) {
    this.referralCode = this.generateReferralCode();
  }

  // Update rank based on level
  if (this.isModified('level')) {
    this.updateRank();
  }

  // Update last activity
  this.lastActivity = new Date();

  next();
});

// Instance methods
userSchema.methods.generateReferralCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

userSchema.methods.updateRank = function() {
  if (this.level >= 50) this.rank = 'Diamond';
  else if (this.level >= 30) this.rank = 'Platinum';
  else if (this.level >= 20) this.rank = 'Gold';
  else if (this.level >= 10) this.rank = 'Silver';
  else this.rank = 'Bronze';
};

userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  const bcrypt = require('bcryptjs');
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.addXP = function(amount) {
  this.xp += amount;
  this.totalXP += amount;
  
  // Check for level up
  const xpNeededForNextLevel = this.level * 100;
  if (this.xp >= xpNeededForNextLevel) {
    this.level += 1;
    this.xp -= xpNeededForNextLevel;
    this.updateRank();
    return true; // Level up occurred
  }
  return false;
};

userSchema.methods.addBalance = function(amount, type = 'playable') {
  if (type === 'playable') {
    this.playableBalance += amount;
  } else if (type === 'bonus') {
    this.bonusBalance += amount;
  }
  this.balance = this.playableBalance + this.bonusBalance;
  this.totalEarned += amount;
};

userSchema.methods.deductBalance = function(amount, type = 'playable') {
  if (type === 'playable' && this.playableBalance >= amount) {
    this.playableBalance -= amount;
    this.balance = this.playableBalance + this.bonusBalance;
    return true;
  } else if (type === 'bonus' && this.bonusBalance >= amount) {
    this.bonusBalance -= amount;
    this.balance = this.playableBalance + this.bonusBalance;
    return true;
  }
  return false;
};

userSchema.methods.canWithdraw = function() {
  return this.withdrawalEnabled && this.isVerified && this.hasDeposited;
};

userSchema.methods.toSafeObject = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.__v;
  return userObject;
};

// Static methods
userSchema.statics.findByTelegramId = function(telegramId) {
  return this.findOne({ telegramId });
};

userSchema.statics.findByReferralCode = function(referralCode) {
  return this.findOne({ referralCode });
};

userSchema.statics.getLeaderboard = function(limit = 10) {
  return this.find({ isBlocked: false })
    .select('username level totalXP totalEarned rank avatar')
    .sort({ totalXP: -1, level: -1 })
    .limit(limit);
};

userSchema.statics.getTopEarners = function(limit = 10) {
  return this.find({ isBlocked: false })
    .select('username totalEarned level rank avatar')
    .sort({ totalEarned: -1 })
    .limit(limit);
};

module.exports = mongoose.model('User', userSchema);