ALTER TABLE household_expenses
  ADD COLUMN IF NOT EXISTS reminder_scope text NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS is_subscription boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS household_settings (
  household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  weekly_digest_enabled boolean NOT NULL DEFAULT true,
  digest_weekday integer NOT NULL DEFAULT 0 CHECK (digest_weekday BETWEEN 0 AND 6),
  digest_hour integer NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
  remind_everyone_default boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO household_settings(household_id)
SELECT id FROM households
ON CONFLICT(household_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS household_digest_deliveries (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_email text NOT NULL,
  week_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS household_digest_deliveries_unique_week
  ON household_digest_deliveries(household_id,lower(member_email),week_key);

ALTER TABLE bank_items
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE billing_customers
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_product_id text;

CREATE INDEX IF NOT EXISTS household_expenses_subscription_idx
  ON household_expenses(household_id,is_subscription,paid);
