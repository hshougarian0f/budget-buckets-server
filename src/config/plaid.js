const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const logger = require('./logger');

// Map environment string to Plaid environment
const envMap = {
  sandbox: PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development,
  production: PlaidEnvironments.production,
};

const plaidEnv = process.env.PLAID_ENV || 'sandbox';

if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
  logger.warn('Plaid credentials not configured. Bank linking will not work.');
}

const configuration = new Configuration({
  basePath: envMap[plaidEnv] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

logger.info(`Plaid client initialized in ${plaidEnv} mode`);

module.exports = plaidClient;
