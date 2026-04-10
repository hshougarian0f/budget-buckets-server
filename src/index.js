// CRITICAL: Write to stderr immediately (unbuffered) so we can see startup
process.stderr.write('[STARTUP] Initializing server...\n');

require('dotenv').config();

process.stderr.write('[STARTUP] dotenv loaded\n');
process.stderr.write('[STARTUP] NODE_ENV: ' + (process.env.NODE_ENV || 'development') + '\n');
process.stderr.write('[STARTUP] PORT: ' + (process.env.PORT || 3001) + '\n');

console.log('[STARTUP] Starting Budget Buckets server...');
console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT || 3001);

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');

console.log('[STARTUP] Loading core dependencies...');

// Route imports - wrap in try-catch to catch Firebase init errors
let authRoutes, plaidRoutes, transactionRoutes, categoryRoutes;
try {
  console.log('[STARTUP] Loading auth routes (Firebase init happens here)...');
  authRoutes = require('./routes/auth');
  console.log('[STARTUP] ✓ Auth routes loaded');

  console.log('[STARTUP] Loading plaid routes...');
  plaidRoutes = require('./routes/plaid');
  console.log('[STARTUP] ✓ Plaid routes loaded');

  console.log('[STARTUP] Loading transaction routes...');
  transactionRoutes = require('./routes/transactions');
  console.log('[STARTUP] ✓ Transaction routes loaded');

  console.log('[STARTUP] Loading category routes...');
  categoryRoutes = require('./routes/categories');
  console.log('[STARTUP] ✓ Category routes loaded');
} catch (error) {
  console.error('[STARTUP FAILED] Error loading routes:', error.message);
  console.error('[STARTUP FAILED] This is likely a Firebase initialization error.');
  console.error('[STARTUP FAILED] Full error:', error);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet - sets various HTTP security headers
app.use(helmet());

// CORS - only allow requests from our mobile app
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // In development, allow localhost
    if (process.env.NODE_ENV !== 'production' && origin?.includes('localhost')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Rate limiting - prevent abuse
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api/', limiter);

// Stricter rate limit for Plaid operations (bank connections)
const plaidLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Fewer allowed for sensitive bank operations
  message: { error: 'Too many bank operations. Please wait before trying again.' },
});
app.use('/api/plaid/', plaidLimiter);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(compression());

// ============================================
// ROUTES
// ============================================

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes - all require Firebase Auth
app.use('/api/auth', authRoutes);
app.use('/api/plaid', plaidRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use(errorHandler);

// ============================================
// START SERVER
// ============================================

console.log('[STARTUP] Creating Express app and starting server...');

const server = app.listen(PORT, () => {
  console.log('[STARTUP] ✓ Server listening on port', PORT);
  logger.info(`Budget Buckets server running on port ${PORT}`, {
    environment: process.env.NODE_ENV || 'development',
    plaidEnv: process.env.PLAID_ENV || 'sandbox',
  });
});

server.on('error', (error) => {
  console.error('[SERVER ERROR] Server failed to start:', error.message);
  logger.error('Server failed to start', { error: error.message });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received');
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

// Catch uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error.message);
  console.error('[UNCAUGHT EXCEPTION] Stack:', error.stack);
  logger.error('Uncaught exception', { error: error.message });
  process.exit(1);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] Promise:', promise);
  console.error('[UNHANDLED REJECTION] Reason:', reason);
  logger.error('Unhandled promise rejection', { reason: String(reason) });
  process.exit(1);
});

module.exports = app;
