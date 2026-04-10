const express = require('express');
const { body } = require('express-validator');
const db = require('../config/database');
const authenticate = require('../middleware/auth');
const validate = require('../middleware/validate');
const logger = require('../config/logger');

const router = express.Router();

/**
 * POST /api/auth/register
 * Called after Firebase Auth signup completes on the client.
 * Creates the user record in our database linked to their Firebase UID.
 */
router.post(
  '/register',
  authenticate,
  [
    body('displayName').optional().trim().isLength({ max: 100 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { uid, email } = req.user;
      const { displayName } = req.body;

      // Check if user already exists (idempotent)
      const existing = await db.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [uid]
      );

      if (existing.rows.length > 0) {
        return res.json({ user: { id: existing.rows[0].id, email } });
      }

      // Create new user
      const result = await db.query(
        `INSERT INTO users (firebase_uid, email, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name, created_at`,
        [uid, email, displayName || null]
      );

      logger.info('New user registered', { userId: result.rows[0].id });
      res.status(201).json({ user: result.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/auth/me
 * Returns the current user's profile.
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, email, display_name, created_at
       FROM users WHERE firebase_uid = $1`,
      [req.user.uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
