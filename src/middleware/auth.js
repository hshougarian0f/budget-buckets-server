const admin = require('../config/firebase');
const logger = require('../config/logger');

/**
 * Firebase Auth middleware - verifies JWT on every protected request.
 * The token comes from the mobile app's Firebase Auth SDK.
 * We verify it server-side with Firebase Admin SDK.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid authorization header',
    });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Attach user info to request - available in all route handlers
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
    };

    next();
  } catch (error) {
    logger.warn('Auth token verification failed', {
      error: error.code || error.message,
      ip: req.ip,
    });

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        error: 'token_expired',
        message: 'Your session has expired. Please sign in again.',
      });
    }

    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid authentication token',
    });
  }
}

module.exports = authenticate;
