const { authenticate, authenticateAdmin } = require('../utils/auth');

// Export the auth middleware functions
module.exports = authenticate;
module.exports.admin = authenticateAdmin;
