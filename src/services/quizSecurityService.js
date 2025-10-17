// Quiz Security Service
// Backend service for quiz security and fraud detection

const logger = require('../utils/logger');

class QuizSecurityService {
  constructor() {
    this.securityRules = {
      maxDailyQuizzes: 10,
      maxHourlyQuizzes: 3,
      minTimeBetweenQuizzes: 30000, // 30 seconds
      suspiciousScoreThreshold: 95,
      maxConsecutiveHighScores: 5,
      timePerQuestionMin: 5000, // 5 seconds minimum
      timePerQuestionMax: 300000, // 5 minutes maximum
      enableFraudDetection: true,
      enableRateLimiting: true
    };
    
    this.userAttempts = new Map(); // In-memory cache for user attempts
    this.suspiciousUsers = new Set(); // Track suspicious users
  }

  // Check if user can take quiz
  async canTakeQuiz(userId, difficulty = 'easy') {
    try {
      const now = Date.now();
      const userKey = `${userId}_${difficulty}`;
      
      if (!this.userAttempts.has(userKey)) {
        this.userAttempts.set(userKey, {
          daily: [],
          hourly: [],
          lastAttempt: 0,
          consecutiveHighScores: 0
        });
      }

      const userData = this.userAttempts.get(userKey);
      
      // Check daily limit
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const todayAttempts = userData.daily.filter(time => time >= todayStart);
      if (todayAttempts.length >= this.securityRules.maxDailyQuizzes) {
        return {
          allowed: false,
          reason: 'DAILY_LIMIT_EXCEEDED',
          message: `You can only take ${this.securityRules.maxDailyQuizzes} quizzes per day`,
          resetTime: new Date(todayStart + 24 * 60 * 60 * 1000)
        };
      }

      // Check hourly limit
      const hourStart = now - (60 * 60 * 1000);
      const hourAttempts = userData.hourly.filter(time => time >= hourStart);
      if (hourAttempts.length >= this.securityRules.maxHourlyQuizzes) {
        return {
          allowed: false,
          reason: 'HOURLY_LIMIT_EXCEEDED',
          message: `You can only take ${this.securityRules.maxHourlyQuizzes} quizzes per hour`,
          resetTime: new Date(hourStart + 60 * 60 * 1000)
        };
      }

      // Check minimum time between quizzes
      if (userData.lastAttempt && (now - userData.lastAttempt) < this.securityRules.minTimeBetweenQuizzes) {
        const remainingTime = this.securityRules.minTimeBetweenQuizzes - (now - userData.lastAttempt);
        return {
          allowed: false,
          reason: 'COOLDOWN_ACTIVE',
          message: `Please wait ${Math.ceil(remainingTime / 1000)} seconds before taking another quiz`,
          resetTime: new Date(now + remainingTime)
        };
      }

      // Check if user is flagged as suspicious
      if (this.suspiciousUsers.has(userId)) {
        return {
          allowed: false,
          reason: 'SUSPICIOUS_ACTIVITY',
          message: 'Your account is under review for suspicious activity',
          resetTime: null
        };
      }

      return {
        allowed: true,
        reason: null,
        message: 'Quiz allowed',
        resetTime: null
      };

    } catch (error) {
      logger.error('Error checking quiz eligibility:', error);
      return {
        allowed: false,
        reason: 'SYSTEM_ERROR',
        message: 'System error occurred',
        resetTime: null
      };
    }
  }

  // Record quiz attempt
  async recordQuizAttempt(userId, difficulty, score, timeSpent, answers) {
    try {
      const now = Date.now();
      const userKey = `${userId}_${difficulty}`;
      
      if (!this.userAttempts.has(userKey)) {
        this.userAttempts.set(userKey, {
          daily: [],
          hourly: [],
          lastAttempt: 0,
          consecutiveHighScores: 0
        });
      }

      const userData = this.userAttempts.get(userKey);
      
      // Update attempt records
      userData.daily.push(now);
      userData.hourly.push(now);
      userData.lastAttempt = now;
      
      // Clean old records
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const hourStart = now - (60 * 60 * 1000);
      userData.daily = userData.daily.filter(time => time >= todayStart);
      userData.hourly = userData.hourly.filter(time => time >= hourStart);

      // Check for suspicious patterns
      const isSuspicious = await this.detectSuspiciousActivity(userId, difficulty, score, timeSpent, answers);
      
      if (isSuspicious) {
        this.suspiciousUsers.add(userId);
        logger.warn(`Suspicious activity detected for user ${userId}:`, {
          score,
          timeSpent,
          difficulty
        });
      }

      return {
        success: true,
        suspicious: isSuspicious,
        message: isSuspicious ? 'Quiz flagged for review' : 'Quiz attempt recorded'
      };

    } catch (error) {
      logger.error('Error recording quiz attempt:', error);
      return {
        success: false,
        suspicious: false,
        message: 'Failed to record quiz attempt'
      };
    }
  }

  // Detect suspicious activity
  async detectSuspiciousActivity(userId, difficulty, score, timeSpent, answers) {
    try {
      const userKey = `${userId}_${difficulty}`;
      const userData = this.userAttempts.get(userKey) || {
        consecutiveHighScores: 0
      };

      let suspiciousFlags = 0;
      let reasons = [];

      // Check for unrealistic scores
      if (score >= this.securityRules.suspiciousScoreThreshold) {
        userData.consecutiveHighScores++;
        if (userData.consecutiveHighScores >= this.securityRules.maxConsecutiveHighScores) {
          suspiciousFlags++;
          reasons.push('Too many consecutive high scores');
        }
      } else {
        userData.consecutiveHighScores = 0;
      }

      // Check for unrealistic timing
      const avgTimePerQuestion = timeSpent / (answers?.length || 1);
      if (avgTimePerQuestion < this.securityRules.timePerQuestionMin) {
        suspiciousFlags++;
        reasons.push('Unrealistically fast answers');
      }

      if (avgTimePerQuestion > this.securityRules.timePerQuestionMax) {
        suspiciousFlags++;
        reasons.push('Unrealistically slow answers');
      }

      // Check for pattern in answers (all correct too quickly)
      if (answers && answers.length > 0) {
        const correctAnswers = answers.filter(answer => answer.isCorrect).length;
        const correctPercentage = (correctAnswers / answers.length) * 100;
        
        if (correctPercentage === 100 && avgTimePerQuestion < 10000) { // 10 seconds per question
          suspiciousFlags++;
          reasons.push('Perfect score with unrealistic timing');
        }
      }

      // Check for bot-like behavior (consistent timing)
      if (answers && answers.length > 3) {
        const times = answers.map(answer => answer.timeSpent || 0);
        const variance = this.calculateVariance(times);
        if (variance < 1000) { // Very low variance indicates bot behavior
          suspiciousFlags++;
          reasons.push('Consistent timing suggests automation');
        }
      }

      // Update user data
      this.userAttempts.set(userKey, userData);

      const isSuspicious = suspiciousFlags >= 2; // Flag if 2 or more suspicious patterns

      if (isSuspicious) {
        logger.warn(`Suspicious activity detected for user ${userId}:`, {
          score,
          timeSpent,
          avgTimePerQuestion,
          reasons,
          suspiciousFlags
        });
      }

      return isSuspicious;

    } catch (error) {
      logger.error('Error detecting suspicious activity:', error);
      return false;
    }
  }

  // Calculate variance for timing analysis
  calculateVariance(numbers) {
    if (numbers.length === 0) return 0;
    
    const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
    const squaredDiffs = numbers.map(num => Math.pow(num - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / numbers.length;
  }

  // Get user's quiz statistics
  async getUserQuizStats(userId, difficulty = 'easy') {
    try {
      const userKey = `${userId}_${difficulty}`;
      const userData = this.userAttempts.get(userKey);
      
      if (!userData) {
        return {
          dailyAttempts: 0,
          hourlyAttempts: 0,
          lastAttempt: null,
          consecutiveHighScores: 0,
          isSuspicious: this.suspiciousUsers.has(userId)
        };
      }

      const now = Date.now();
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const hourStart = now - (60 * 60 * 1000);
      
      return {
        dailyAttempts: userData.daily.filter(time => time >= todayStart).length,
        hourlyAttempts: userData.hourly.filter(time => time >= hourStart).length,
        lastAttempt: userData.lastAttempt ? new Date(userData.lastAttempt) : null,
        consecutiveHighScores: userData.consecutiveHighScores,
        isSuspicious: this.suspiciousUsers.has(userId),
        remainingDaily: Math.max(0, this.securityRules.maxDailyQuizzes - userData.daily.filter(time => time >= todayStart).length),
        remainingHourly: Math.max(0, this.securityRules.maxHourlyQuizzes - userData.hourly.filter(time => time >= hourStart).length)
      };

    } catch (error) {
      logger.error('Error getting user quiz stats:', error);
      return {
        dailyAttempts: 0,
        hourlyAttempts: 0,
        lastAttempt: null,
        consecutiveHighScores: 0,
        isSuspicious: false
      };
    }
  }

  // Clear suspicious flag for user
  async clearSuspiciousFlag(userId) {
    try {
      this.suspiciousUsers.delete(userId);
      logger.info(`Suspicious flag cleared for user ${userId}`);
      return { success: true, message: 'Suspicious flag cleared' };
    } catch (error) {
      logger.error('Error clearing suspicious flag:', error);
      return { success: false, message: 'Failed to clear suspicious flag' };
    }
  }

  // Update security rules
  updateSecurityRules(newRules) {
    try {
      this.securityRules = { ...this.securityRules, ...newRules };
      logger.info('Security rules updated:', this.securityRules);
      return { success: true, message: 'Security rules updated' };
    } catch (error) {
      logger.error('Error updating security rules:', error);
      return { success: false, message: 'Failed to update security rules' };
    }
  }

  // Get current security rules
  getSecurityRules() {
    return { ...this.securityRules };
  }

  // Reset user attempts (admin function)
  async resetUserAttempts(userId, difficulty = 'easy') {
    try {
      const userKey = `${userId}_${difficulty}`;
      this.userAttempts.delete(userKey);
      logger.info(`Quiz attempts reset for user ${userId}, difficulty ${difficulty}`);
      return { success: true, message: 'User attempts reset' };
    } catch (error) {
      logger.error('Error resetting user attempts:', error);
      return { success: false, message: 'Failed to reset user attempts' };
    }
  }

  // Get system statistics
  async getSystemStats() {
    try {
      const totalUsers = this.userAttempts.size;
      const suspiciousUsers = this.suspiciousUsers.size;
      
      return {
        totalActiveUsers: totalUsers,
        suspiciousUsers: suspiciousUsers,
        suspiciousPercentage: totalUsers > 0 ? (suspiciousUsers / totalUsers) * 100 : 0,
        securityRules: this.getSecurityRules()
      };
    } catch (error) {
      logger.error('Error getting system stats:', error);
      return {
        totalActiveUsers: 0,
        suspiciousUsers: 0,
        suspiciousPercentage: 0,
        securityRules: this.getSecurityRules()
      };
    }
  }

  // Cleanup old data (should be called periodically)
  cleanup() {
    try {
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
      
      // Clean up old attempt records
      for (const [userKey, userData] of this.userAttempts.entries()) {
        userData.daily = userData.daily.filter(time => time >= weekAgo);
        userData.hourly = userData.hourly.filter(time => time >= weekAgo);
        
        // Remove empty entries
        if (userData.daily.length === 0 && userData.hourly.length === 0) {
          this.userAttempts.delete(userKey);
        }
      }
      
      logger.info('Security service cleanup completed');
    } catch (error) {
      logger.error('Error during security service cleanup:', error);
    }
  }
}

// Create singleton instance
const quizSecurityService = new QuizSecurityService();

// Setup periodic cleanup (every hour)
setInterval(() => {
  quizSecurityService.cleanup();
}, 60 * 60 * 1000);

module.exports = quizSecurityService;
