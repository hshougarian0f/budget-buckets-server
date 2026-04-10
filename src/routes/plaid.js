const express = require('express');
const { Products, CountryCode } = require('plaid');
const plaidClient = require('../config/plaid');
const db = require('../config/database');
const authenticate = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

// All Plaid routes require authentication
router.use(authenticate);

/**
 * POST /api/plaid/create-link-token
 * Creates a Plaid Link token for the client to initialize Plaid Link.
 * SECURITY: Only requests TRANSACTIONS product — read-only, no money movement.
 */
router.post('/create-link-token', async (req, res, next) => {
  try {
    // Get our internal user ID
    const userResult = await db.query(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    const request = {
      user: { client_user_id: userId },
      client_name: 'Budget Buckets',
      // CRITICAL SECURITY: Only request transactions — NO transfers, NO auth
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      // Webhook for transaction updates
      webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    };

    const response = await plaidClient.linkTokenCreate(request);

    logger.info('Link token created', { userId });
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/plaid/exchange-token
 * Exchanges the public token from Plaid Link for a permanent access token.
 * The access token is stored server-side ONLY and never sent to the client.
 */
router.post('/exchange-token', async (req, res, next) => {
  try {
    const { public_token, institution } = req.body;

    if (!public_token || typeof public_token !== 'string' || public_token.length > 500) {
      return res.status(400).json({ error: 'Valid public_token is required' });
    }

    const userResult = await db.query(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );
    const userId = userResult.rows[0].id;

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const { access_token, item_id } = exchangeResponse.data;

    // Store access token server-side (NEVER return to client)
    await db.query(
      `INSERT INTO plaid_items (user_id, access_token, item_id, institution_id, institution_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (item_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         updated_at = NOW()`,
      [
        userId,
        access_token,  // Stored securely in database
        item_id,
        institution?.institution_id || null,
        institution?.name || null,
      ]
    );

    // Fetch and store accounts
    const accountsResponse = await plaidClient.accountsGet({ access_token });
    const plaidItemResult = await db.query(
      'SELECT id FROM plaid_items WHERE item_id = $1',
      [item_id]
    );
    const plaidItemId = plaidItemResult.rows[0].id;

    for (const account of accountsResponse.data.accounts) {
      await db.query(
        `INSERT INTO accounts (plaid_item_id, user_id, plaid_account_id, name, official_name, type, subtype, mask, current_balance, available_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING`,
        [
          plaidItemId,
          userId,
          account.account_id,
          account.name,
          account.official_name,
          account.type,
          account.subtype,
          account.mask,
          account.balances.current ? Math.round(account.balances.current * 100) : null,
          account.balances.available ? Math.round(account.balances.available * 100) : null,
        ]
      );
    }

    logger.info('Bank linked successfully', {
      userId,
      institution: institution?.name,
    });

    // Return safe info only — NO access_token
    res.json({
      success: true,
      institution: {
        name: institution?.name || 'Bank',
        id: institution?.institution_id,
      },
      accounts: accountsResponse.data.accounts.map((a) => ({
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/plaid/sync-transactions
 * Uses Plaid's transaction sync API for incremental updates.
 * Only pulls new/modified transactions since last sync.
 */
router.post('/sync-transactions', async (req, res, next) => {
  try {
    const userResult = await db.query(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );
    const userId = userResult.rows[0].id;

    // Get all linked bank items for this user
    const items = await db.query(
      'SELECT id, access_token, cursor FROM plaid_items WHERE user_id = $1 AND status = $2',
      [userId, 'active']
    );

    if (items.rows.length === 0) {
      return res.json({ transactions: [], message: 'No bank accounts linked' });
    }

    let allAdded = [];
    let allModified = [];
    let allRemoved = [];

    for (const item of items.rows) {
      let hasMore = true;
      let cursor = item.cursor;

      while (hasMore) {
        const syncResponse = await plaidClient.transactionsSync({
          access_token: item.access_token,
          cursor: cursor || undefined,
          count: 500,
        });

        const { added, modified, removed, next_cursor, has_more } = syncResponse.data;

        // Get account mapping
        const accountMap = {};
        const accounts = await db.query(
          'SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = $1',
          [item.id]
        );
        accounts.rows.forEach((a) => { accountMap[a.plaid_account_id] = a.id; });

        // Insert new transactions
        for (const txn of added) {
          await db.query(
            `INSERT INTO transactions (user_id, account_id, plaid_transaction_id, amount, name, merchant_name, date, pending, plaid_category, logo_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (plaid_transaction_id) DO UPDATE SET
               amount = EXCLUDED.amount,
               name = EXCLUDED.name,
               merchant_name = EXCLUDED.merchant_name,
               pending = EXCLUDED.pending,
               updated_at = NOW()`,
            [
              userId,
              accountMap[txn.account_id] || null,
              txn.transaction_id,
              Math.round(txn.amount * 100), // Store in cents
              txn.name,
              txn.merchant_name,
              txn.date,
              txn.pending,
              txn.personal_finance_category ? [txn.personal_finance_category.primary, txn.personal_finance_category.detailed] : null,
              txn.logo_url,
            ]
          );
          allAdded.push(txn.transaction_id);
        }

        // Update modified transactions
        for (const txn of modified) {
          await db.query(
            `UPDATE transactions SET
               amount = $1, name = $2, merchant_name = $3, date = $4, pending = $5
             WHERE plaid_transaction_id = $6 AND user_id = $7`,
            [
              Math.round(txn.amount * 100),
              txn.name,
              txn.merchant_name,
              txn.date,
              txn.pending,
              txn.transaction_id,
              userId,
            ]
          );
          allModified.push(txn.transaction_id);
        }

        // Remove deleted transactions
        for (const txn of removed) {
          await db.query(
            'DELETE FROM transactions WHERE plaid_transaction_id = $1 AND user_id = $2',
            [txn.transaction_id, userId]
          );
          allRemoved.push(txn.transaction_id);
        }

        cursor = next_cursor;
        hasMore = has_more;
      }

      // Save cursor for next incremental sync
      await db.query(
        'UPDATE plaid_items SET cursor = $1 WHERE id = $2',
        [cursor, item.id]
      );
    }

    logger.info('Transaction sync completed', {
      userId,
      added: allAdded.length,
      modified: allModified.length,
      removed: allRemoved.length,
    });

    res.json({
      added: allAdded.length,
      modified: allModified.length,
      removed: allRemoved.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/plaid/accounts
 * Returns linked bank accounts (safe info only — no tokens).
 */
router.get('/accounts', async (req, res, next) => {
  try {
    const userResult = await db.query(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );
    const userId = userResult.rows[0].id;

    const result = await db.query(
      `SELECT a.id, a.name, a.official_name, a.type, a.subtype, a.mask,
              a.current_balance, a.available_balance, a.currency_code,
              pi.institution_name, pi.status
       FROM accounts a
       JOIN plaid_items pi ON a.plaid_item_id = pi.id
       WHERE a.user_id = $1
       ORDER BY pi.institution_name, a.name`,
      [userId]
    );

    res.json({
      accounts: result.rows.map((a) => ({
        ...a,
        current_balance: a.current_balance ? a.current_balance / 100 : null,
        available_balance: a.available_balance ? a.available_balance / 100 : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/plaid/items/:itemId
 * Disconnects a bank. Revokes Plaid access token.
 */
router.delete('/items/:itemId', async (req, res, next) => {
  try {
    const userResult = await db.query(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );
    const userId = userResult.rows[0].id;

    const item = await db.query(
      'SELECT access_token FROM plaid_items WHERE id = $1 AND user_id = $2',
      [req.params.itemId, userId]
    );

    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'Bank connection not found' });
    }

    // Revoke access with Plaid
    try {
      await plaidClient.itemRemove({ access_token: item.rows[0].access_token });
    } catch (e) {
      logger.warn('Failed to revoke Plaid item', { error: e.message });
    }

    // Delete from our database (cascades to accounts, but not transactions)
    await db.query('DELETE FROM plaid_items WHERE id = $1', [req.params.itemId]);

    logger.info('Bank disconnected', { userId, itemId: req.params.itemId });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
