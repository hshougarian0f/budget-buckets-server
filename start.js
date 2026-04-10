// Wrapper script to catch ALL startup errors
console.log('START.JS: Beginning server startup...');
console.log('START.JS: PORT =', process.env.PORT);
console.log('START.JS: NODE_ENV =', process.env.NODE_ENV);

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error('STACK:', err.stack);
  // Keep process alive briefly so logs flush
  setTimeout(() => process.exit(1), 2000);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  setTimeout(() => process.exit(1), 2000);
});

try {
  console.log('START.JS: Loading src/index.js...');
  require('./src/index.js');
  console.log('START.JS: src/index.js loaded successfully');
} catch (error) {
  console.error('START.JS CRASH:', error.message);
  console.error('START.JS STACK:', error.stack);
  // Keep process alive briefly so logs flush
  setTimeout(() => process.exit(1), 5000);
}
