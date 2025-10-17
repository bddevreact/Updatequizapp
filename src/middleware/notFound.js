const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      availableRoutes: [
        'GET /api/health',
        'GET /api/status',
        'GET /api/info',
        'POST /api/auth/register',
        'POST /api/auth/login',
        'POST /api/auth/telegram',
        'GET /api/auth/me',
        'GET /api/users',
        'GET /api/users/:id',
        'GET /api/quiz/questions',
        'POST /api/quiz/submit',
        'GET /api/tournaments',
        'POST /api/tournaments',
        'GET /api/transactions',
        'POST /api/transactions/deposit',
        'POST /api/transactions/withdrawals',
        'GET /api/admin/dashboard',
        'POST /api/upload/deposit-proof',
        'POST /api/upload/task-proof',
        'POST /api/upload/profile-picture',
        'POST /api/telegram/webhook'
      ]
    },
    timestamp: new Date().toISOString()
  });
};

module.exports = notFound;
