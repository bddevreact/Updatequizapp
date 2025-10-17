const express = require('express');
const { body, validationResult } = require('express-validator');
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

// @route   POST /api/telegram/webhook
// @desc    Handle Telegram webhook
// @access  Public
router.post('/webhook',
  [
    body('update_id').isNumeric().withMessage('Update ID is required'),
    body('message').optional().isObject(),
    body('callback_query').optional().isObject(),
    body('inline_query').optional().isObject()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const update = req.body;

      // Verify webhook secret if configured
      const webhookSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (process.env.TELEGRAM_WEBHOOK_SECRET && webhookSecret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid webhook secret'
          }
        });
      }

      // Handle different types of updates
      if (update.message) {
        await handleMessage(update.message);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      } else if (update.inline_query) {
        await handleInlineQuery(update.inline_query);
      }

      logger.business('telegram_webhook_received', {
        updateId: update.update_id,
        type: update.message ? 'message' : update.callback_query ? 'callback_query' : 'inline_query',
        timestamp: new Date()
      });

      res.json({
        success: true,
        message: 'Webhook processed successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'telegram_webhook',
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process webhook'
        }
      });
    }
  }
);

// Handle incoming messages
async function handleMessage(message) {
  try {
    const { from, chat, text, photo, document } = message;

    // Log message
    logger.business('telegram_message_received', {
      userId: from.id,
      username: from.username,
      chatId: chat.id,
      messageType: text ? 'text' : photo ? 'photo' : document ? 'document' : 'other',
      text: text?.substring(0, 100) // Log first 100 chars
    });

    // Handle different message types
    if (text) {
      await handleTextMessage(from, chat, text);
    } else if (photo) {
      await handlePhotoMessage(from, chat, photo);
    } else if (document) {
      await handleDocumentMessage(from, chat, document);
    }

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'handle_telegram_message',
      message
    });
  }
}

// Handle text messages
async function handleTextMessage(from, chat, text) {
  const userId = from.id;
  const username = from.username;
  const firstName = from.first_name;
  const lastName = from.last_name;

  // Handle commands
  if (text.startsWith('/')) {
    await handleCommand(userId, chat, text);
    return;
  }

  // Handle regular messages
  switch (text.toLowerCase()) {
    case 'start':
      await sendWelcomeMessage(chat.id, from);
      break;
    case 'help':
      await sendHelpMessage(chat.id);
      break;
    case 'balance':
      await sendBalanceMessage(chat.id, userId);
      break;
    case 'profile':
      await sendProfileMessage(chat.id, userId);
      break;
    case 'tournaments':
      await sendTournamentsMessage(chat.id, userId);
      break;
    default:
      await sendDefaultMessage(chat.id);
  }
}

// Handle commands
async function handleCommand(userId, chat, command) {
  const commandParts = command.split(' ');
  const commandName = commandParts[0].toLowerCase();

  switch (commandName) {
    case '/start':
      await handleStartCommand(chat.id, userId, commandParts);
      break;
    case '/help':
      await sendHelpMessage(chat.id);
      break;
    case '/balance':
      await sendBalanceMessage(chat.id, userId);
      break;
    case '/profile':
      await sendProfileMessage(chat.id, userId);
      break;
    case '/tournaments':
      await sendTournamentsMessage(chat.id, userId);
      break;
    case '/referral':
      await sendReferralMessage(chat.id, userId);
      break;
    case '/support':
      await sendSupportMessage(chat.id);
      break;
    default:
      await sendUnknownCommandMessage(chat.id);
  }
}

// Handle start command with referral code
async function handleStartCommand(chatId, userId, commandParts) {
  let referralCode = null;
  
  if (commandParts.length > 1) {
    referralCode = commandParts[1];
  }

  await sendWelcomeMessage(chatId, { id: userId }, referralCode);
}

// Handle callback queries
async function handleCallbackQuery(callbackQuery) {
  try {
    const { from, data, message } = callbackQuery;
    const userId = from.id;

    // Parse callback data
    const [action, ...params] = data.split('_');

    switch (action) {
      case 'join':
        await handleJoinTournamentCallback(userId, params[0]);
        break;
      case 'leave':
        await handleLeaveTournamentCallback(userId, params[0]);
        break;
      case 'quiz':
        await handleQuizCallback(userId, params[0]);
        break;
      case 'profile':
        await handleProfileCallback(userId, params[0]);
        break;
      default:
        await sendCallbackAnswer(callbackQuery.id, 'Unknown action');
    }

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'handle_telegram_callback',
      callbackQuery
    });
  }
}

// Handle inline queries
async function handleInlineQuery(inlineQuery) {
  try {
    const { from, query } = inlineQuery;
    const userId = from.id;

    // Handle inline query based on query text
    if (query.startsWith('tournament')) {
      await handleTournamentInlineQuery(inlineQuery);
    } else if (query.startsWith('quiz')) {
      await handleQuizInlineQuery(inlineQuery);
    } else {
      await handleGeneralInlineQuery(inlineQuery);
    }

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'handle_telegram_inline_query',
      inlineQuery
    });
  }
}

// Message sending functions
async function sendWelcomeMessage(chatId, user, referralCode = null) {
  const message = `
🎉 Welcome to CryptoQuiz!

Hello ${user.first_name}! 👋

🚀 Start earning crypto by answering quiz questions
🏆 Join tournaments and compete with others
💰 Earn USDT rewards for correct answers
🎁 Get daily bonuses and referral rewards

${referralCode ? `🎯 Referral code: ${referralCode}` : ''}

Use /help to see all available commands.
`;

  await sendTelegramMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎮 Start Quiz', callback_data: 'quiz_start' },
          { text: '🏆 Tournaments', callback_data: 'tournaments_list' }
        ],
        [
          { text: '👤 Profile', callback_data: 'profile_view' },
          { text: '💰 Balance', callback_data: 'balance_view' }
        ],
        [
          { text: '🎁 Referral', callback_data: 'referral_view' },
          { text: '❓ Help', callback_data: 'help_view' }
        ]
      ]
    }
  });
}

async function sendHelpMessage(chatId) {
  const message = `
📚 CryptoQuiz Help

🎮 Commands:
/start - Start the bot
/help - Show this help message
/balance - Check your balance
/profile - View your profile
/tournaments - List available tournaments
/referral - Get your referral code
/support - Contact support

🎯 How to earn:
• Answer quiz questions correctly
• Join tournaments and win prizes
• Complete daily tasks
• Invite friends with referral code
• Get daily bonuses

💰 Withdrawal:
• Minimum withdrawal: 10 USDT
• Withdrawal fee: 2%
• Processed within 24 hours

Need more help? Contact our support team!
`;

  await sendTelegramMessage(chatId, message);
}

async function sendBalanceMessage(chatId, userId) {
  try {
    const User = require('../models/User');
    const user = await User.findByTelegramId(userId.toString());

    if (!user) {
      await sendTelegramMessage(chatId, '❌ User not found. Please use /start to register.');
      return;
    }

    const message = `
💰 Your Balance

💵 Playable Balance: ${user.playableBalance} USDT
🎁 Bonus Balance: ${user.bonusBalance} USDT
💎 Total Balance: ${user.balance} USDT

📊 Statistics:
• Total Earned: ${user.totalEarned} USDT
• Total Deposited: ${user.totalDeposited} USDT
• Total Withdrawn: ${user.totalWithdrawn} USDT

💡 Tip: Complete quizzes and tournaments to earn more!
`;

    await sendTelegramMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💸 Withdraw', callback_data: 'withdraw_start' },
            { text: '💳 Deposit', callback_data: 'deposit_start' }
          ]
        ]
      }
    });

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'send_balance_message',
      userId
    });
    await sendTelegramMessage(chatId, '❌ Error retrieving balance. Please try again.');
  }
}

async function sendProfileMessage(chatId, userId) {
  try {
    const User = require('../models/User');
    const user = await User.findByTelegramId(userId.toString());

    if (!user) {
      await sendTelegramMessage(chatId, '❌ User not found. Please use /start to register.');
      return;
    }

    const message = `
👤 Your Profile

🏷️ Username: ${user.username}
📧 Email: ${user.email || 'Not set'}
📱 Phone: ${user.phone || 'Not set'}

🎮 Game Stats:
• Level: ${user.level}
• XP: ${user.totalXP}
• Rank: ${user.rank}
• Streak: ${user.streak} days

📊 Quiz Stats:
• Questions Answered: ${user.questionsAnswered}
• Correct Answers: ${user.correctAnswers}
• Accuracy: ${user.questionsAnswered > 0 ? ((user.correctAnswers / user.questionsAnswered) * 100).toFixed(1) : 0}%

🏆 Tournament Stats:
• Tournaments Won: ${user.tournamentsWon}
• Total Tournaments: ${user.totalTournaments}
• Win Rate: ${user.totalTournaments > 0 ? ((user.tournamentsWon / user.totalTournaments) * 100).toFixed(1) : 0}%

🎁 Referral Stats:
• Referral Code: ${user.referralCode}
• Friends Invited: ${user.invitedFriends}
• Referral Earnings: ${user.referralEarnings} USDT
`;

    await sendTelegramMessage(chatId, message);

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'send_profile_message',
      userId
    });
    await sendTelegramMessage(chatId, '❌ Error retrieving profile. Please try again.');
  }
}

async function sendTournamentsMessage(chatId, userId) {
  try {
    const Tournament = require('../models/Tournament');
    const tournaments = await Tournament.getUpcomingTournaments(5);

    if (tournaments.length === 0) {
      await sendTelegramMessage(chatId, '🏆 No upcoming tournaments available.');
      return;
    }

    let message = '🏆 Upcoming Tournaments\n\n';
    
    tournaments.forEach((tournament, index) => {
      message += `${index + 1}. ${tournament.title}\n`;
      message += `   💰 Entry: ${tournament.entryFee} USDT\n`;
      message += `   🏆 Prize: ${tournament.prizePool} USDT\n`;
      message += `   👥 Participants: ${tournament.participants.length}/${tournament.maxParticipants}\n`;
      message += `   ⏰ Starts: ${tournament.startTime.toLocaleString()}\n\n`;
    });

    await sendTelegramMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: tournaments.map(tournament => [
          { text: `Join ${tournament.title}`, callback_data: `join_${tournament._id}` }
        ])
      }
    });

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'send_tournaments_message',
      userId
    });
    await sendTelegramMessage(chatId, '❌ Error retrieving tournaments. Please try again.');
  }
}

async function sendReferralMessage(chatId, userId) {
  try {
    const User = require('../models/User');
    const user = await User.findByTelegramId(userId.toString());

    if (!user) {
      await sendTelegramMessage(chatId, '❌ User not found. Please use /start to register.');
      return;
    }

    const referralLink = `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${user.referralCode}`;
    
    const message = `
🎁 Referral Program

🔗 Your Referral Link:
${referralLink}

📊 Your Referral Stats:
• Referral Code: ${user.referralCode}
• Friends Invited: ${user.invitedFriends}
• Referral Earnings: ${user.referralEarnings} USDT
• Max Invites: ${user.maxInvites}

💰 How it works:
• Share your referral link with friends
• Earn 10% of their quiz earnings
• Earn 20% of their tournament winnings
• Get bonus rewards for each referral

💡 Tip: Share your link on social media to earn more!
`;

    await sendTelegramMessage(chatId, message);

  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'send_referral_message',
      userId
    });
    await sendTelegramMessage(chatId, '❌ Error retrieving referral info. Please try again.');
  }
}

async function sendSupportMessage(chatId) {
  const message = `
🆘 Support

Need help? We're here for you!

📧 Email: support@cryptoquiz.com
💬 Telegram: @cryptoquiz_support
🌐 Website: https://cryptoquiz.com

⏰ Support Hours:
• Monday - Friday: 9:00 AM - 6:00 PM UTC
• Saturday - Sunday: 10:00 AM - 4:00 PM UTC

📝 Common Issues:
• Withdrawal problems
• Account verification
• Technical issues
• Payment questions

We'll respond within 24 hours!
`;

  await sendTelegramMessage(chatId, message);
}

async function sendDefaultMessage(chatId) {
  const message = `
🤔 I didn't understand that message.

Use /help to see all available commands, or try one of these:

🎮 /start - Start the bot
💰 /balance - Check your balance
👤 /profile - View your profile
🏆 /tournaments - List tournaments
🎁 /referral - Get referral code
`;

  await sendTelegramMessage(chatId, message);
}

async function sendUnknownCommandMessage(chatId) {
  const message = `
❓ Unknown command.

Use /help to see all available commands.
`;

  await sendTelegramMessage(chatId, message);
}

// Callback handlers
async function handleJoinTournamentCallback(userId, tournamentId) {
  // Implementation for joining tournament
  logger.business('telegram_join_tournament_callback', {
    userId,
    tournamentId
  });
}

async function handleLeaveTournamentCallback(userId, tournamentId) {
  // Implementation for leaving tournament
  logger.business('telegram_leave_tournament_callback', {
    userId,
    tournamentId
  });
}

async function handleQuizCallback(userId, action) {
  // Implementation for quiz actions
  logger.business('telegram_quiz_callback', {
    userId,
    action
  });
}

async function handleProfileCallback(userId, action) {
  // Implementation for profile actions
  logger.business('telegram_profile_callback', {
    userId,
    action
  });
}

// Utility functions
async function sendTelegramMessage(chatId, text, options = {}) {
  try {
    const axios = require('axios');
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger.error('Telegram bot token not configured');
      return;
    }

    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    });

    return response.data;
  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'send_telegram_message',
      chatId,
      text: text.substring(0, 100)
    });
  }
}

async function sendCallbackAnswer(callbackQueryId, text) {
  try {
    const axios = require('axios');
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      logger.error('Telegram bot token not configured');
      return;
    }

    await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false
    });
  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'send_callback_answer',
      callbackQueryId
    });
  }
}

module.exports = router;
