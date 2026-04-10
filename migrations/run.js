require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate(direction = 'up') {
  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    if (direction === 'up') {
      const files = fs.readdirSync(__dirname)
        .filter(f => f.endsWith('.sql'))
        .sort();

      const applied = await client.query('SELECT name FROM _migrations ORDER BY id');
      const appliedNames = applied.rows.map(r => r.name);

      for (const file of files) {
        if (appliedNames.includes(file)) {
          console.log(`  ✓ ${file} (already applied)`);
          continue;
        }

        console.log(`  → Applying ${file}...`);
        const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`  ✓ ${file} applied successfully`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`  ✗ ${file} failed:`, err.message);
          throw err;
        }
      }
      console.log('\nAll migrations applied successfully.');
    } else {
      console.log('Rollback not implemented for safety. Manage manually.');
    }
  } finally {
    client.release();
  }
}

const direction = process.argv[2] || 'up';
migrate(direction)
  .then(() => {
    console.log('Exiting migration script...');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
