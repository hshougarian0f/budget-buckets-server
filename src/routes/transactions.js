const express = require('express');
const { query, param, body } = require('express-validator');
const db = require('../config/database');
const authenticate = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/transactions
 * Returns user's transactions with optional filters.
 * Query params: ?startDate=2026-04-01&endDate=2026-04-30&assigned=false&limit=100&offset=0
 */
router.get(
  '/',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('assigned').optional().isBoolean(),
    query('categoryId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 500 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const userResult = await db.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [req.user.uid]
      );
      const userId = userResult.rows[0].id;

      const { startDate, endDate, assigned, categoryId, limit = 100, offset = 0 } = req.query;

      let whereClause = 'WHERE t.user_id = $1';
      const params = [userId];
      let paramIdx = 2;

      if (startDate) {
        whereClause += ` AND t.date >= $${paramIdx}`;
        params.push(startDate);
        paramIdx++;
      }
      if (endDate) {
        whereClause += ` AND t.date <= $${paramIdx}`;
        params.push(endDate);
        paramIdx++;
      }
      if (assigned === 'true') {
        whereClause += ' AND t.category_id IS NOT NULL';
      } else if (assigned === 'false') {
        whereClause += ' AND t.category_id IS NULL';
      }
      if (categoryId) {
        whereClause += ` AND t.category_id = $${paramIdx}`;
        params.push(categoryId);
        paramIdx++;
      }

      // Get total count
      const countResult = await db.query(
        `SELECT COUNT(*) FROM transactions t ${whereClause}`,
        params
      );

      // Get transactions
      params.push(parseInt(limit), parseInt(offset));
      const result = await db.query(
        `SELECT t.id, t.amount, t.name, t.merchant_name, t.date, t.pending,
                t.category_id, t.plaid_category, t.logo_url, t.created_at,
                bc.name as category_name, bc.color as category_color, bc.icon as category_icon
         FROM transactions t
         LEFT JOIN budget_categories bc ON t.category_id = bc.id
         ${whereClause}
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        params
      );

      res.json({
        transactions: result.rows.map((t) => ({
          ...t,
          amount: t.amount / 100, // Convert cents to dollars for the client
        })),
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/transactions/:id/assign
 * Assigns a transaction to a budget category (the core feature!).
 */
router.patch(
  '/:id/assign',
  [
    param('id').isUUID(),
    body('categoryId').optional({ nullable: true }).isUUID(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const userResult = await db.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [req.user.uid]
      );
      const userId = userResult.rows[0].id;

      const { categoryId } = req.body;

      // Verify transaction belongs to user
      const txn = await db.query(
        'SELECT id FROM transactions WHERE id = $1 AND user_id = $2',
        [req.params.id, userId]
      );

      if (txn.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // If assigning, verify category belongs to user
      if (categoryId) {
        const cat = await db.query(
          'SELECT id FROM budget_categories WHERE id = $1 AND user_id = $2',
          [categoryId, userId]
        );
        if (cat.rows.length === 0) {
          return res.status(404).json({ error: 'Category not found' });
        }
      }

      await db.query(
        'UPDATE transactions SET category_id = $1 WHERE id = $2',
        [categoryId || null, req.params.id]
      );

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/transactions/:id/unassign
 * Removes a transaction from its budget category.
 */
router.post(
  '/:id/unassign',
  [param('id').isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const userResult = await db.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [req.user.uid]
      );
      const userId = userResult.rows[0].id;

      const result = await db.query(
        'UPDATE transactions SET category_id = NULL WHERE id = $1 AND user_id = $2 RETURNING id',
        [req.params.id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
