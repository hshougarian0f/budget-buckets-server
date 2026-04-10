const admin = require('firebase-admin');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

function initializeFirebase() {
  if (admin.apps.length > 0) return admin;

  try {
    // Option 1: Service account JSON file (local development)
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath && fs.existsSync(path.resolve(serviceAccountPath))) {
      const serviceAccount = require(path.resolve(serviceAccountPath));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      logger.info('Firebase initialized with service account file');
      return admin;
    }

    // Option 2: Individual environment variables (production/Railway)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Railway stores the key with escaped newlines
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
      logger.info('Firebase initialized with environment variables');
      return admin;
    }

    throw new Error('No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID + FIREBASE_PRIVATE_KEY');
  } catch (error) {
    logger.error('Firebase initialization failed', { error: error.message });
    throw error;
  }
}

module.exports = initializeFirebase();
