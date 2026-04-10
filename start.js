// Single entry point: runs migrations then starts the server
const { execSync } = require('child_process');

// Step 1: Run migrations
try {
  execSync('node migrations/run.js', { stdio: 'inherit', timeout: 30000 });
} catch (err) {
  console.error('Migration failed:', err.message);
  // Continue anyway - migrations might have already been applied
}

// Step 2: Start the server
require('./src/index.js');
