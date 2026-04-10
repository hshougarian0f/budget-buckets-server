// Single entry point: runs migrations then starts the server
const { execSync } = require('child_process');

console.log('=== BUDGET BUCKETS STARTUP ===');
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Step 1: Run migrations
try {
  console.log('Running migrations...');
  execSync('node migrations/run.js', { stdio: 'inherit', timeout: 30000 });
  console.log('Migrations complete.');
} catch (err) {
  console.error('Migration failed:', err.message);
  // Continue anyway - migrations might have already been applied
}

// Step 2: Start the server
console.log('Starting Express server...');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error('STACK:', err.stack);
  setTimeout(() => process.exit(1), 2000);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  setTimeout(() => process.exit(1), 2000);
});

try {
  require('./src/index.js');
  console.log('Express server module loaded.');
} catch (error) {
  console.error('SERVER CRASH:', error.message);
  console.error('STACK:', error.stack);
  setTimeout(() => process.exit(1), 5000);
}
