const logger = require('../config/logger');

/**
 * Global error handler. Catches all unhandled errors in routes.
 * In production, never expose internal error details to clients.
 */
function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.uid,
  });

  // Plaid-specific errors
  if (err.response?.data) {
    const plaidError = err.response.data;
    return res.status(400).json({
      error: 'plaid_error',
      message: process.env.NODE_ENV === 'production'
        ? 'A bank connection error occurred. Please try again.'
        : plaidError.error_message,
      code: plaidError.error_code,
    });
  }

  // Database errors
  if (err.code && err.code.startsWith('2')) { // PostgreSQL error codes
    return res.status(500).json({
      error: 'database_error',
      message: 'An internal error occurred. Please try again.',
    });
  }

  // Generic server error - never expose stack traces in production
  res.status(err.status || 500).json({
    error: 'server_error',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred.'
      : err.message,
  });
}

module.exports = errorHandler;
