-- Budget Buckets - Initial Database Schema
-- All monetary values stored as integers (cents) to avoid floating point issues

-- Users table - linked to Firebase Auth via firebase_uid
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(128) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);

-- Plaid items - represents a bank connection
-- access_token is encrypted and NEVER sent to the client
CREATE TABLE IF NOT EXISTS plaid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,  -- Plaid access token - NEVER expose to client
  item_id VARCHAR(255) NOT NULL,  -- Plaid item ID
  institution_id VARCHAR(50),
  institution_name VARCHAR(255),
  cursor TEXT,  -- For incremental transaction sync
  status VARCHAR(20) DEFAULT 'active',  -- active, error, revoked
  error_code VARCHAR(100),
  consent_expiration TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plaid_items_user_id ON plaid_items(user_id);
CREATE INDEX idx_plaid_items_item_id ON plaid_items(item_id);

-- Accounts from Plaid
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plaid_item_id UUID NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plaid_account_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  official_name VARCHAR(255),
  type VARCHAR(50),  -- depository, credit, etc.
  subtype VARCHAR(50),  -- checking, savings, credit card, etc.
  mask VARCHAR(4),  -- Last 4 digits
  current_balance INTEGER,  -- In cents
  available_balance INTEGER,  -- In cents
  currency_code VARCHAR(3) DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_plaid_account_id ON accounts(plaid_account_id);

-- User-defined budget categories (buckets)
-- MUST be created before transactions (foreign key dependency)
CREATE TABLE IF NOT EXISTS budget_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50) DEFAULT 'folder',
  color VARCHAR(7) DEFAULT '#6C5CE7',
  budget_amount INTEGER NOT NULL,  -- Monthly budget in cents
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_budget_categories_user_id ON budget_categories(user_id);

-- Transactions from Plaid
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  plaid_transaction_id VARCHAR(255) UNIQUE,
  amount INTEGER NOT NULL,  -- In cents (positive = money out, matches Plaid convention)
  name VARCHAR(500) NOT NULL,
  merchant_name VARCHAR(255),
  date DATE NOT NULL,
  pending BOOLEAN DEFAULT false,
  category_id UUID REFERENCES budget_categories(id) ON DELETE SET NULL,
  plaid_category TEXT[],  -- Plaid's auto-categorization
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(user_id, date DESC);
CREATE INDEX idx_transactions_category ON transactions(user_id, category_id);
CREATE INDEX idx_transactions_plaid_id ON transactions(plaid_transaction_id);

-- Budget cycles (monthly periods)
CREATE TABLE IF NOT EXISTS budget_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  name VARCHAR(50),  -- e.g. "April 2026"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, start_date)
);

CREATE INDEX idx_budget_cycles_user_id ON budget_cycles(user_id, start_date DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply auto-update triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plaid_items_updated_at BEFORE UPDATE ON plaid_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_budget_categories_updated_at BEFORE UPDATE ON budget_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
