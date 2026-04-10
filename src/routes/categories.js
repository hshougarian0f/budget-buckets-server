const express = require('express');
const { body, param } = require('express-validator');
const db = require('../config/database');
const authenticate = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/categories
 * Returns all budget categories for the current user with spent amounts.
 */
router.get('/', async (req, res, next) => {
  try {
    const userResult = await db.query(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );
    const userId = userResult.rows[0].id;

    // Get start/end of current month for spending calculation
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const result = await db.query(
      `SELECT bc.id, bc.name, bc.icon, bc.color, bc.budget_amount, bc.sort_order,
              COALESCE(SUM(CASE WHEN t.date >= $2 AND t.date <= $3 THEN t.amount ELSE 0 END), 0) as spent
       FROM budget_categories bc
       LEFT JOIN transactions t ON t.category_id = bc.id AND t.user_id = bc.user_id
       WHERE bc.user_id = $1 AND bc.is_active = true
       GROUP BY bc.id
       ORDER BY bc.sort_order, bc.name`,
      [userId, startOfMonth, endOfMonth]
    );

    res.json({
      categories: result.rows.map((c) => ({
        ...c,
        budget_amount: c.budget_amount / 100,
        spent: c.spent / 100,
        remaining: (c.budget_amount - c.spent) / 100,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/categories
 * Creates a new budget category.
 */
router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required (max 100 chars)'),
    body('budget').isFloat({ min: 0.01, max: 9999999.99 }).withMessage('Budget must be between $0.01 and $9,999,999.99'),
    body('icon').optional().trim().isLength({ max: 50 }),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Color must be a hex color'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const userResult = await db.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [req.user.uid]
      );
      const userId = userResult.rows[0].id;

      const { name, budget, icon, color } = req.body;

      // Limit categories per user to prevent abuse
      const countResult = await db.query(
        'SELECT COUNT(*) FROM budget_categories WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      if (parseInt(countResult.rows[0].count) >= 50) {
        return res.status(400).json({ error: 'Maximum 50 categories allowed' });
      }

      const result = await db.query(
        `INSERT INTO budget_categories (user_id, name, budget_amount, icon, color)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, icon, color, budget_amount, sort_order`,
        [userId, name, Math.round(budget * 100), icon || 'folder', color || '#6C5CE7']
      );

      const category = result.rows[0];
      res.status(201).json({
        category: {
          ...category,
          budget_amount: category.budget_amount / 100,
          spent: 0,
          remaining: category.budget_amount / 100,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/categories/:id
 * Updates a budget category.
 */
router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().isLength({ min: 1, max: 100 }),
    body('budget').optional().isFloat({ min: 0.01 }),
    body('icon').optional().trim().isLength({ max: 50 }),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  ],
  validate,
  async (req, res, next) => {
    try {
      const userResult = await db.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [req.user.uid]
      );
      const userId = userResult.rows[0].id;

      const { name, budget, icon, color } = req.body;

      // Build dynamic update
      const updates = [];
      const values = [];
      let idx = 1;

      if (name !== undefined) { updates.push(`name = $${idx}`); values.push(name); idx++; }
      if (budget !== undefined) { updates.push(`budget_amount = $${idx}`); values.push(Math.round(budget * 100)); idx++; }
      if (icon !== undefined) { updates.push(`icon = $${idx}`); values.push(icon); idx++; }
      if (color !== undefined) { updates.push(`color = $${idx}`); values.push(color); idx++; }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(req.params.id, userId);

      const result = await db.query(
        `UPDATE budget_categories SET ${updates.join(', ')}
         WHERE id = $${idx} AND user_id = $${idx + 1}
         RETURNING id, name, icon, color, budget_amount`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }

      const category = result.rows[0];
      res.json({
        category: {
          ...category,
          budget_amount: category.budget_amount / 100,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/categories/:id
 * Soft-deletes a category. Transactions get unassigned.
 */
router.delete(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const userResult = await db.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [req.user.uid]
      );
      const userId = userResult.rows[0].id;

      // Unassign all transactions from this category
      await db.query(
        'UPDATE transactions SET category_id = NULL WHERE category_id = $1 AND user_id = $2',
        [req.params.id, userId]
      );

      // Soft delete the category
      const result = await db.query(
        'UPDATE budget_categories SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING id',
        [req.params.id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
