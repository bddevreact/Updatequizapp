const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tournament = require('../models/Tournament');
const logger = require('../utils/logger');

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socketId
    this.userSockets = new Map(); // socketId -> userId
    this.tournamentRooms = new Map(); // tournamentId -> Set of socketIds
    
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user || user.isBlocked) {
          return next(new Error('Authentication error: Invalid user'));
        }

        socket.userId = user._id.toString();
        socket.user = user;
        next();
      } catch (error) {
        logger.errorWithContext(error, { 
          operation: 'socket_authentication',
          socketId: socket.id
        });
        next(new Error('Authentication error: Invalid token'));
      }
    });
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      
      // User events
      socket.on('join-user-room', () => this.handleJoinUserRoom(socket));
      socket.on('leave-user-room', () => this.handleLeaveUserRoom(socket));
      
      // Tournament events
      socket.on('join-tournament', (data) => this.handleJoinTournament(socket, data));
      socket.on('leave-tournament', (data) => this.handleLeaveTournament(socket, data));
      socket.on('tournament-message', (data) => this.handleTournamentMessage(socket, data));
      
      // Quiz events
      socket.on('quiz-answer', (data) => this.handleQuizAnswer(socket, data));
      socket.on('quiz-complete', (data) => this.handleQuizComplete(socket, data));
      
      // Chat events
      socket.on('send-message', (data) => this.handleSendMessage(socket, data));
      
      // Admin events
      socket.on('join-admin-room', () => this.handleJoinAdminRoom(socket));
      socket.on('leave-admin-room', () => this.handleLeaveAdminRoom(socket));
      
      // Disconnect
      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  handleConnection(socket) {
    const userId = socket.userId;
    const username = socket.user.username;

    // Store user connection
    this.connectedUsers.set(userId, socket.id);
    this.userSockets.set(socket.id, userId);

    // Join user to their personal room
    socket.join(`user-${userId}`);

    // Update user's online status
    this.updateUserOnlineStatus(userId, true);

    // Notify user's friends about online status
    this.notifyFriendsOnlineStatus(userId, true);

    logger.business('user_connected_websocket', {
      userId,
      username,
      socketId: socket.id,
      connectedUsers: this.connectedUsers.size
    });

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to CryptoQuiz',
      userId,
      username,
      connectedUsers: this.connectedUsers.size
    });
  }

  handleDisconnect(socket) {
    const userId = socket.userId;
    const username = socket.user?.username;

    // Remove user connection
    this.connectedUsers.delete(userId);
    this.userSockets.delete(socket.id);

    // Leave all tournament rooms
    for (const [tournamentId, socketIds] of this.tournamentRooms.entries()) {
      if (socketIds.has(socket.id)) {
        socketIds.delete(socket.id);
        socket.leave(`tournament-${tournamentId}`);
        
        // Notify tournament participants
        this.io.to(`tournament-${tournamentId}`).emit('participant-left', {
          userId,
          username,
          timestamp: new Date()
        });
      }
    }

    // Update user's online status
    this.updateUserOnlineStatus(userId, false);

    // Notify user's friends about offline status
    this.notifyFriendsOnlineStatus(userId, false);

    logger.business('user_disconnected_websocket', {
      userId,
      username,
      socketId: socket.id,
      connectedUsers: this.connectedUsers.size
    });
  }

  handleJoinUserRoom(socket) {
    const userId = socket.userId;
    socket.join(`user-${userId}`);
    
    socket.emit('joined-user-room', {
      message: 'Joined personal room',
      userId
    });
  }

  handleLeaveUserRoom(socket) {
    const userId = socket.userId;
    socket.leave(`user-${userId}`);
    
    socket.emit('left-user-room', {
      message: 'Left personal room',
      userId
    });
  }

  async handleJoinTournament(socket, data) {
    try {
      const { tournamentId } = data;
      const userId = socket.userId;

      // Verify user is participant in tournament
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) {
        socket.emit('error', { message: 'Tournament not found' });
        return;
      }

      const isParticipant = tournament.participants.some(p => p.user.toString() === userId);
      if (!isParticipant) {
        socket.emit('error', { message: 'You are not a participant in this tournament' });
        return;
      }

      // Join tournament room
      socket.join(`tournament-${tournamentId}`);
      
      // Track tournament room membership
      if (!this.tournamentRooms.has(tournamentId)) {
        this.tournamentRooms.set(tournamentId, new Set());
      }
      this.tournamentRooms.get(tournamentId).add(socket.id);

      // Notify other participants
      socket.to(`tournament-${tournamentId}`).emit('participant-joined', {
        userId,
        username: socket.user.username,
        timestamp: new Date()
      });

      socket.emit('joined-tournament', {
        tournamentId,
        message: 'Joined tournament room',
        participants: tournament.participants.length
      });

      logger.business('user_joined_tournament_room', {
        userId,
        tournamentId,
        socketId: socket.id
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'join_tournament_room',
        userId: socket.userId,
        data
      });
      socket.emit('error', { message: 'Failed to join tournament' });
    }
  }

  handleLeaveTournament(socket, data) {
    const { tournamentId } = data;
    const userId = socket.userId;

    socket.leave(`tournament-${tournamentId}`);
    
    // Remove from tournament room tracking
    if (this.tournamentRooms.has(tournamentId)) {
      this.tournamentRooms.get(tournamentId).delete(socket.id);
    }

    // Notify other participants
    socket.to(`tournament-${tournamentId}`).emit('participant-left', {
      userId,
      username: socket.user.username,
      timestamp: new Date()
    });

    socket.emit('left-tournament', {
      tournamentId,
      message: 'Left tournament room'
    });
  }

  handleTournamentMessage(socket, data) {
    const { tournamentId, message } = data;
    const userId = socket.userId;
    const username = socket.user.username;

    // Broadcast message to tournament room
    this.io.to(`tournament-${tournamentId}`).emit('tournament-message', {
      userId,
      username,
      message,
      timestamp: new Date()
    });

    logger.business('tournament_message_sent', {
      userId,
      tournamentId,
      message: message.substring(0, 100) // Log first 100 chars
    });
  }

  handleQuizAnswer(socket, data) {
    const { tournamentId, questionId, answer, timeSpent } = data;
    const userId = socket.userId;

    // Broadcast answer to tournament room (for live tournaments)
    if (tournamentId) {
      this.io.to(`tournament-${tournamentId}`).emit('participant-answer', {
        userId,
        username: socket.user.username,
        questionId,
        answer,
        timeSpent,
        timestamp: new Date()
      });
    }

    socket.emit('answer-received', {
      questionId,
      answer,
      timestamp: new Date()
    });
  }

  handleQuizComplete(socket, data) {
    const { tournamentId, score, totalQuestions, timeSpent } = data;
    const userId = socket.userId;

    // Broadcast completion to tournament room
    if (tournamentId) {
      this.io.to(`tournament-${tournamentId}`).emit('participant-completed', {
        userId,
        username: socket.user.username,
        score,
        totalQuestions,
        timeSpent,
        timestamp: new Date()
      });
    }

    socket.emit('quiz-completed', {
      score,
      totalQuestions,
      timeSpent,
      timestamp: new Date()
    });
  }

  handleSendMessage(socket, data) {
    const { recipientId, message } = data;
    const userId = socket.userId;
    const username = socket.user.username;

    // Check if recipient is online
    const recipientSocketId = this.connectedUsers.get(recipientId);
    
    if (recipientSocketId) {
      // Send message to recipient
      this.io.to(recipientSocketId).emit('new-message', {
        senderId: userId,
        senderUsername: username,
        message,
        timestamp: new Date()
      });

      // Send confirmation to sender
      socket.emit('message-sent', {
        recipientId,
        message,
        timestamp: new Date()
      });
    } else {
      // Recipient is offline
      socket.emit('message-failed', {
        recipientId,
        reason: 'Recipient is offline'
      });
    }
  }

  handleJoinAdminRoom(socket) {
    if (socket.user.role !== 'admin') {
      socket.emit('error', { message: 'Admin access required' });
      return;
    }

    socket.join('admin-room');
    socket.emit('joined-admin-room', {
      message: 'Joined admin room',
      userId: socket.userId
    });
  }

  handleLeaveAdminRoom(socket) {
    socket.leave('admin-room');
    socket.emit('left-admin-room', {
      message: 'Left admin room',
      userId: socket.userId
    });
  }

  // Utility methods for sending notifications
  sendNotificationToUser(userId, notification) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(socketId).emit('notification', notification);
    }
  }

  sendNotificationToAllUsers(notification) {
    this.io.emit('notification', notification);
  }

  sendNotificationToAdmins(notification) {
    this.io.to('admin-room').emit('admin-notification', notification);
  }

  sendTournamentUpdate(tournamentId, update) {
    this.io.to(`tournament-${tournamentId}`).emit('tournament-update', update);
  }

  sendBalanceUpdate(userId, balanceData) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(socketId).emit('balance-update', balanceData);
    }
  }

  sendTransactionUpdate(userId, transactionData) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(socketId).emit('transaction-update', transactionData);
    }
  }

  // Update user online status in database
  async updateUserOnlineStatus(userId, isOnline) {
    try {
      await User.findByIdAndUpdate(userId, {
        isOnline,
        lastSeen: new Date()
      });
    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'update_user_online_status',
        userId
      });
    }
  }

  // Notify friends about online status
  async notifyFriendsOnlineStatus(userId, isOnline) {
    try {
      // In a real app, you'd get user's friends list
      // For now, we'll just log the event
      logger.business('user_status_changed', {
        userId,
        isOnline,
        timestamp: new Date()
      });
    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'notify_friends_status',
        userId
      });
    }
  }

  // Get online users count
  getOnlineUsersCount() {
    return this.connectedUsers.size;
  }

  // Get connected users list
  getConnectedUsers() {
    return Array.from(this.connectedUsers.keys());
  }

  // Check if user is online
  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }

  // Get user's socket ID
  getUserSocketId(userId) {
    return this.connectedUsers.get(userId);
  }
}

module.exports = (io) => {
  return new SocketHandler(io);
};
