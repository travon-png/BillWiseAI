CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','plus','pro','family')),
  reminder_days jsonb NOT NULL DEFAULT '[7,3,1,0]'::jsonb,
  email_reminders boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  previous_amount numeric(12,2),
  due_date date NOT NULL,
  category text NOT NULL DEFAULT 'Other',
  recurring boolean NOT NULL DEFAULT true,
  recurrence text NOT NULL DEFAULT 'monthly',
  autopay boolean NOT NULL DEFAULT false,
  is_subscription boolean NOT NULL DEFAULT false,
  paid boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  source_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bills_user_due_idx ON bills(user_id, due_date);
CREATE INDEX IF NOT EXISTS bills_user_subscription_idx ON bills(user_id, is_subscription);

CREATE TABLE IF NOT EXISTS incomes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  payday date NOT NULL,
  recurrence text NOT NULL DEFAULT 'biweekly',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incomes_user_idx ON incomes(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  reminder_key text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, bill_id, reminder_key, channel)
);

CREATE TABLE IF NOT EXISTS billing_customers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  customer_id text,
  subscription_id text,
  status text NOT NULL DEFAULT 'none',
  plan text NOT NULL DEFAULT 'free',
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id)
);

CREATE TABLE IF NOT EXISTS bank_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'plaid',
  item_id text NOT NULL,
  institution_id text,
  institution_name text,
  encrypted_access_token text NOT NULL,
  cursor text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id)
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_item_id uuid NOT NULL REFERENCES bank_items(id) ON DELETE CASCADE,
  provider_account_id text NOT NULL,
  name text NOT NULL,
  official_name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric(14,2),
  available_balance numeric(14,2),
  iso_currency_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider_account_id)
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_item_id uuid NOT NULL REFERENCES bank_items(id) ON DELETE CASCADE,
  provider_transaction_id text NOT NULL,
  provider_account_id text NOT NULL,
  merchant_name text,
  name text NOT NULL,
  amount numeric(14,2) NOT NULL,
  date date NOT NULL,
  pending boolean NOT NULL DEFAULT false,
  category text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS bank_transactions_user_date_idx ON bank_transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_merchant_idx ON bank_transactions(user_id, merchant_name);
