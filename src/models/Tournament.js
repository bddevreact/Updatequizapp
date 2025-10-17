const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
  // Basic tournament info
  title: {
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
  category: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    required: true,
    default: 'medium'
  },

  // Tournament configuration
  entryFee: {
    type: Number,
    required: true,
    min: 0
  },
  prizePool: {
    type: Number,
    required: true,
    min: 0
  },
  appFee: {
    type: Number,
    default: 0,
    min: 0
  },
  maxParticipants: {
    type: Number,
    required: true,
    min: 2,
    max: 100
  },
  minParticipants: {
    type: Number,
    default: 2,
    min: 2
  },

  // Participants
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    score: {
      type: Number,
      default: 0
    },
    timeSpent: {
      type: Number,
      default: 0
    },
    answers: [{
      questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quiz'
      },
      selectedAnswer: Number,
      isCorrect: Boolean,
      timeSpent: Number
    }],
    rank: {
      type: Number,
      default: 0
    },
    prize: {
      type: Number,
      default: 0
    }
  }],

  // Tournament status
  status: {
    type: String,
    enum: ['upcoming', 'active', 'completed', 'cancelled'],
    default: 'upcoming'
  },
  phase: {
    type: String,
    enum: ['registration', 'quiz', 'results'],
    default: 'registration'
  },

  // Timing
  registrationStart: {
    type: Date,
    required: true
  },
  registrationEnd: {
    type: Date,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  actualStartTime: {
    type: Date
  },
  actualEndTime: {
    type: Date
  },

  // Questions
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz'
  }],
  questionCount: {
    type: Number,
    default: 10,
    min: 5,
    max: 50
  },
  timePerQuestion: {
    type: Number,
    default: 30,
    min: 10,
    max: 120
  },

  // Results
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  topParticipants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rank: Number,
    score: Number,
    prize: Number
  }],
  prizeDistribution: [{
    rank: Number,
    prize: Number,
    percentage: Number
  }],

  // Tournament settings
  settings: {
    allowLateJoin: {
      type: Boolean,
      default: false
    },
    autoStart: {
      type: Boolean,
      default: true
    },
    showLeaderboard: {
      type: Boolean,
      default: true
    },
    showAnswers: {
      type: Boolean,
      default: true
    },
    allowRetry: {
      type: Boolean,
      default: false
    },
    maxRetries: {
      type: Number,
      default: 0,
      min: 0,
      max: 3
    }
  },

  // Statistics
  stats: {
    totalRegistrations: {
      type: Number,
      default: 0
    },
    totalParticipants: {
      type: Number,
      default: 0
    },
    averageScore: {
      type: Number,
      default: 0
    },
    completionRate: {
      type: Number,
      default: 0
    },
    totalRevenue: {
      type: Number,
      default: 0
    },
    totalPrizes: {
      type: Number,
      default: 0
    }
  },

  // Creator info
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  inviteCode: {
    type: String,
    unique: true,
    sparse: true
  },

  // Notifications
  notifications: [{
    type: {
      type: String,
      enum: ['registration', 'start', 'end', 'winner', 'cancelled']
    },
    message: String,
    sentAt: Date,
    recipients: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
tournamentSchema.index({ status: 1, startTime: 1 });
tournamentSchema.index({ category: 1, difficulty: 1 });
tournamentSchema.index({ createdBy: 1 });
tournamentSchema.index({ 'participants.user': 1 });
tournamentSchema.index({ inviteCode: 1 });
tournamentSchema.index({ createdAt: -1 });

// Virtual fields
tournamentSchema.virtual('currentParticipants').get(function() {
  return this.participants.length;
});

tournamentSchema.virtual('isRegistrationOpen').get(function() {
  const now = new Date();
  return this.status === 'upcoming' && 
         now >= this.registrationStart && 
         now <= this.registrationEnd &&
         this.participants.length < this.maxParticipants;
});

tournamentSchema.virtual('isActive').get(function() {
  const now = new Date();
  return this.status === 'active' && 
         now >= this.startTime && 
         now <= this.endTime;
});

tournamentSchema.virtual('isCompleted').get(function() {
  return this.status === 'completed';
});

tournamentSchema.virtual('timeUntilStart').get(function() {
  const now = new Date();
  return Math.max(0, this.startTime.getTime() - now.getTime());
});

tournamentSchema.virtual('timeUntilEnd').get(function() {
  const now = new Date();
  return Math.max(0, this.endTime.getTime() - now.getTime());
});

tournamentSchema.virtual('netProfit').get(function() {
  return this.stats.totalRevenue - this.stats.totalPrizes - this.appFee;
});

// Pre-save middleware
tournamentSchema.pre('save', function(next) {
  // Generate invite code for private tournaments
  if (this.isPrivate && !this.inviteCode) {
    this.inviteCode = this.generateInviteCode();
  }

  // Update stats
  this.stats.totalRegistrations = this.participants.length;
  this.stats.totalParticipants = this.participants.filter(p => p.score > 0).length;
  
  if (this.participants.length > 0) {
    const totalScore = this.participants.reduce((sum, p) => sum + p.score, 0);
    this.stats.averageScore = totalScore / this.participants.length;
  }

  // Calculate completion rate
  if (this.participants.length > 0) {
    const completedCount = this.participants.filter(p => p.answers.length === this.questionCount).length;
    this.stats.completionRate = (completedCount / this.participants.length) * 100;
  }

  next();
});

// Instance methods
tournamentSchema.methods.generateInviteCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

tournamentSchema.methods.addParticipant = function(userId) {
  // Check if user is already a participant
  const existingParticipant = this.participants.find(p => p.user.toString() === userId.toString());
  if (existingParticipant) {
    throw new Error('User is already a participant');
  }

  // Check if tournament is full
  if (this.participants.length >= this.maxParticipants) {
    throw new Error('Tournament is full');
  }

  // Check if registration is open
  if (!this.isRegistrationOpen) {
    throw new Error('Registration is closed');
  }

  this.participants.push({
    user: userId,
    joinedAt: new Date()
  });

  return this;
};

tournamentSchema.methods.removeParticipant = function(userId) {
  const participantIndex = this.participants.findIndex(p => p.user.toString() === userId.toString());
  if (participantIndex === -1) {
    throw new Error('User is not a participant');
  }

  // Can't remove participants after tournament starts
  if (this.status === 'active' || this.status === 'completed') {
    throw new Error('Cannot remove participants after tournament starts');
  }

  this.participants.splice(participantIndex, 1);
  return this;
};

tournamentSchema.methods.startTournament = function() {
  if (this.status !== 'upcoming') {
    throw new Error('Tournament cannot be started');
  }

  if (this.participants.length < this.minParticipants) {
    throw new Error('Not enough participants to start tournament');
  }

  this.status = 'active';
  this.phase = 'quiz';
  this.actualStartTime = new Date();
  
  return this;
};

tournamentSchema.methods.completeTournament = function() {
  if (this.status !== 'active') {
    throw new Error('Tournament is not active');
  }

  this.status = 'completed';
  this.phase = 'results';
  this.actualEndTime = new Date();

  // Calculate rankings and prizes
  this.calculateRankings();
  this.distributePrizes();

  return this;
};

tournamentSchema.methods.calculateRankings = function() {
  // Sort participants by score (descending) and time (ascending)
  this.participants.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.timeSpent - b.timeSpent;
  });

  // Assign ranks
  this.participants.forEach((participant, index) => {
    participant.rank = index + 1;
  });

  // Set winner
  if (this.participants.length > 0) {
    this.winner = this.participants[0].user;
  }

  // Create top participants list
  this.topParticipants = this.participants.slice(0, 10).map(p => ({
    user: p.user,
    rank: p.rank,
    score: p.score,
    prize: p.prize
  }));
};

tournamentSchema.methods.distributePrizes = function() {
  if (!this.prizeDistribution || this.prizeDistribution.length === 0) {
    return;
  }

  this.participants.forEach(participant => {
    const prizeInfo = this.prizeDistribution.find(p => p.rank === participant.rank);
    if (prizeInfo) {
      participant.prize = prizeInfo.prize;
    }
  });

  // Update stats
  this.stats.totalPrizes = this.participants.reduce((sum, p) => sum + p.prize, 0);
};

tournamentSchema.methods.updateParticipantScore = function(userId, score, timeSpent, answers) {
  const participant = this.participants.find(p => p.user.toString() === userId.toString());
  if (!participant) {
    throw new Error('User is not a participant');
  }

  participant.score = score;
  participant.timeSpent = timeSpent;
  participant.answers = answers;

  return participant;
};

tournamentSchema.methods.canJoin = function(userId) {
  // Check if user is already a participant
  const existingParticipant = this.participants.find(p => p.user.toString() === userId.toString());
  if (existingParticipant) {
    return { canJoin: false, reason: 'Already a participant' };
  }

  // Check if tournament is full
  if (this.participants.length >= this.maxParticipants) {
    return { canJoin: false, reason: 'Tournament is full' };
  }

  // Check if registration is open
  if (!this.isRegistrationOpen) {
    return { canJoin: false, reason: 'Registration is closed' };
  }

  // Check if tournament is private
  if (this.isPrivate) {
    return { canJoin: false, reason: 'Private tournament' };
  }

  return { canJoin: true };
};

// Static methods
tournamentSchema.statics.getActiveTournaments = function() {
  return this.find({
    status: { $in: ['upcoming', 'active'] },
    startTime: { $gte: new Date() }
  })
  .populate('participants.user', 'username avatar level')
  .populate('createdBy', 'username')
  .sort({ startTime: 1 });
};

tournamentSchema.statics.getUpcomingTournaments = function(limit = 10) {
  return this.find({
    status: 'upcoming',
    startTime: { $gte: new Date() }
  })
  .populate('participants.user', 'username avatar')
  .populate('createdBy', 'username')
  .sort({ startTime: 1 })
  .limit(limit);
};

tournamentSchema.statics.getUserTournaments = function(userId) {
  return this.find({
    'participants.user': userId
  })
  .populate('participants.user', 'username avatar')
  .populate('createdBy', 'username')
  .sort({ createdAt: -1 });
};

tournamentSchema.statics.getTournamentStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalTournaments: { $sum: 1 },
        activeTournaments: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        upcomingTournaments: { $sum: { $cond: [{ $eq: ['$status', 'upcoming'] }, 1, 0] } },
        completedTournaments: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        totalParticipants: { $sum: '$stats.totalParticipants' },
        totalRevenue: { $sum: '$stats.totalRevenue' },
        totalPrizes: { $sum: '$stats.totalPrizes' }
      }
    }
  ]);
};

module.exports = mongoose.model('Tournament', tournamentSchema);
