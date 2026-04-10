// CRITICAL: Write to stderr immediately (unbuffered)
process.stderr.write('[FIREBASE] Module loading...\n');

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

process.stderr.write('[FIREBASE] Initializing Firebase...\n');
process.stderr.write('[FIREBASE] FIREBASE_PROJECT_ID: ' + (process.env.FIREBASE_PROJECT_ID ? 'SET' : 'NOT SET') + '\n');
process.stderr.write('[FIREBASE] FIREBASE_CLIENT_EMAIL: ' + (process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'NOT SET') + '\n');
process.stderr.write('[FIREBASE] FIREBASE_PRIVATE_KEY: ' + (process.env.FIREBASE_PRIVATE_KEY ? 'SET (length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : 'NOT SET') + '\n');

console.log('[FIREBASE] Initializing Firebase...');
console.log('[FIREBASE] FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'SET' : 'NOT SET');
console.log('[FIREBASE] FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'NOT SET');
console.log('[FIREBASE] FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET (length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : 'NOT SET');

function initializeFirebase() {
  if (admin.apps.length > 0) {
    console.log('[FIREBASE] ✓ Firebase already initialized');
    return admin;
  }

  try {
    // Option 1: Service account JSON file (local development)
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath && fs.existsSync(path.resolve(serviceAccountPath))) {
      console.log('[FIREBASE] Loading service account from file:', serviceAccountPath);
      const serviceAccount = require(path.resolve(serviceAccountPath));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[FIREBASE] ✓ Firebase initialized with service account file');
      return admin;
    }

    // Option 2: Individual environment variables (production/Railway)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
      console.log('[FIREBASE] Using environment variables for initialization');
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      console.log('[FIREBASE] Private key converted (length: ' + privateKey.length + ')');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
      });
      console.log('[FIREBASE] ✓ Firebase initialized with environment variables');
      return admin;
    }

    const errorMsg = 'No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID + FIREBASE_PRIVATE_KEY';
    console.error('[FIREBASE ERROR]', errorMsg);
    throw new Error(errorMsg);
  } catch (error) {
    console.error('[FIREBASE ERROR] Firebase initialization failed:', error.message);
    console.error('[FIREBASE ERROR] Stack:', error.stack);
    throw error;
  }
}

// Initialize Firebase immediately with error handling
let firebaseAdmin;
try {
  firebaseAdmin = initializeFirebase();
} catch (error) {
  console.error('[FIREBASE CRITICAL] Failed to initialize Firebase during module load');
  console.error('[FIREBASE CRITICAL] Error:', error.message);
  // Don't throw - let the server start so we can see the error in Railway logs
  // The actual error will happen when trying to use Firebase
  firebaseAdmin = null;
}

module.exports = firebaseAdmin || admin;
