# 🚀 CryptoQuiz Backend API

A comprehensive Node.js backend for the CryptoQuiz Telegram WebApp with Express.js, MongoDB, JWT authentication, and real-time features.

## 📁 Project Structure

```
backend/
├── src/
│   ├── controllers/          # Route controllers
│   ├── middleware/           # Custom middleware
│   ├── models/              # Database models
│   ├── routes/              # API routes
│   ├── services/            # Business logic
│   ├── utils/               # Utility functions
│   ├── config/              # Configuration files
│   └── app.js               # Main application file
├── uploads/                 # File uploads directory
├── logs/                    # Application logs
├── tests/                   # Test files
├── package.json
├── .env.example
└── README.md
```

## 🛠️ Technology Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - Database
- **Mongoose** - ODM
- **JWT** - Authentication
- **Socket.io** - Real-time communication
- **Multer** - File uploads
- **Bcrypt** - Password hashing
- **Joi** - Data validation
- **Winston** - Logging
- **Helmet** - Security
- **CORS** - Cross-origin requests

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 6+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
```

### Environment Variables

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/cryptoquiz

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d

# Firebase (for integration)
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY=your-firebase-private-key
FIREBASE_CLIENT_EMAIL=your-firebase-client-email

# OpenAI
OPENAI_API_KEY=your-openai-api-key

# Payment Gateway
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret

# File Upload
MAX_FILE_SIZE=5242880
UPLOAD_PATH=./uploads

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100

# Telegram Bot
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_WEBHOOK_URL=your-webhook-url
```

## 📚 API Documentation

### Authentication Endpoints

```javascript
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
POST /api/auth/forgot-password
POST /api/auth/reset-password
GET  /api/auth/me
```

### User Management

```javascript
GET    /api/users
GET    /api/users/:id
PUT    /api/users/:id
DELETE /api/users/:id
GET    /api/users/:id/profile
PUT    /api/users/:id/profile
GET    /api/users/:id/transactions
GET    /api/users/:id/achievements
```

### Quiz System

```javascript
GET    /api/quiz/questions
POST   /api/quiz/submit
GET    /api/quiz/history
GET    /api/quiz/leaderboard
GET    /api/quiz/stats/:userId
POST   /api/quiz/generate-ai
```

### Tournament System

```javascript
GET    /api/tournaments
POST   /api/tournaments
GET    /api/tournaments/:id
PUT    /api/tournaments/:id
DELETE /api/tournaments/:id
POST   /api/tournaments/:id/join
POST   /api/tournaments/:id/leave
GET    /api/tournaments/:id/participants
POST   /api/tournaments/:id/start
POST   /api/tournaments/:id/complete
```

### Financial Operations

```javascript
POST   /api/deposits
GET    /api/deposits
GET    /api/deposits/:id
PUT    /api/deposits/:id/approve
PUT    /api/deposits/:id/reject
POST   /api/withdrawals
GET    /api/withdrawals
GET    /api/withdrawals/:id
PUT    /api/withdrawals/:id/approve
PUT    /api/withdrawals/:id/reject
GET    /api/transactions
GET    /api/transactions/:id
```

### Task Management

```javascript
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PUT    /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/complete
GET    /api/tasks/:id/verifications
POST   /api/tasks/:id/verify
PUT    /api/tasks/:id/approve
PUT    /api/tasks/:id/reject
```

### Admin Operations

```javascript
GET    /api/admin/dashboard
GET    /api/admin/users
GET    /api/admin/transactions
GET    /api/admin/tournaments
GET    /api/admin/tasks
GET    /api/admin/settings
PUT    /api/admin/settings
GET    /api/admin/analytics
GET    /api/admin/logs
```

### File Upload

```javascript
POST   /api/upload/deposit-proof
POST   /api/upload/task-proof
POST   /api/upload/profile-picture
GET    /api/files/:filename
```

### WebSocket Events

```javascript
// Client to Server
'join-tournament'
'leave-tournament'
'quiz-answer'
'chat-message'

// Server to Client
'tournament-update'
'quiz-question'
'notification'
'balance-update'
'user-online'
'user-offline'
```

## 🔐 Security Features

- JWT Authentication
- Password Hashing with Bcrypt
- Rate Limiting
- CORS Protection
- Helmet Security Headers
- Input Validation with Joi
- SQL Injection Prevention
- XSS Protection
- File Upload Security

## 📊 Database Models

### User Model
```javascript
{
  _id: ObjectId,
  telegramId: String,
  username: String,
  fullName: String,
  email: String,
  phone: String,
  balance: Number,
  playableBalance: Number,
  bonusBalance: Number,
  level: Number,
  xp: Number,
  streak: Number,
  referralCode: String,
  invitedBy: String,
  isVerified: Boolean,
  isBlocked: Boolean,
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Quiz Model
```javascript
{
  _id: ObjectId,
  question: String,
  options: [String],
  correctAnswer: Number,
  difficulty: String,
  category: String,
  explanation: String,
  points: Number,
  isActive: Boolean,
  createdAt: Date
}
```

### Tournament Model
```javascript
{
  _id: ObjectId,
  title: String,
  description: String,
  entryFee: Number,
  prizePool: Number,
  maxParticipants: Number,
  participants: [ObjectId],
  status: String,
  startTime: Date,
  endTime: Date,
  winner: ObjectId,
  createdAt: Date
}
```

### Transaction Model
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  type: String,
  amount: Number,
  status: String,
  description: String,
  txHash: String,
  network: String,
  proof: String,
  approvedBy: ObjectId,
  createdAt: Date
}
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --grep "User API"
```

## 📈 Monitoring & Logging

- Winston logging with different levels
- Error tracking and reporting
- Performance monitoring
- API request/response logging
- Database query logging

## 🚀 Deployment

### Docker Deployment
```bash
# Build Docker image
docker build -t cryptoquiz-backend .

# Run container
docker run -p 5000:5000 cryptoquiz-backend
```

### PM2 Deployment
```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start ecosystem.config.js

# Monitor
pm2 monit
```

## 📝 API Response Format

### Success Response
```javascript
{
  success: true,
  data: {
    // Response data
  },
  message: "Operation successful",
  timestamp: "2024-01-01T00:00:00.000Z"
}
```

### Error Response
```javascript
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid input data",
    details: {
      field: "email",
      reason: "Invalid email format"
    }
  },
  timestamp: "2024-01-01T00:00:00.000Z"
}
```

## 🔄 Integration with Frontend

The backend is designed to work seamlessly with your existing React frontend:

1. **Authentication**: JWT tokens for session management
2. **Real-time**: WebSocket for live updates
3. **File Upload**: Multer for proof submissions
4. **CORS**: Configured for frontend domain
5. **API**: RESTful endpoints matching frontend needs

## 📞 Support

For support and questions:
- Email: moonbd01717@gmail.com
- Telegram: @mushfiqmoon
- Documentation: [API Docs](https://api.cryptoquiz.com/docs)

---

**Developed By [Mushfiqur Rahaman](https:facebook.com/mushfiq.moon)**

