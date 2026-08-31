ALTER TABLE household_expenses
  ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS split_mode text NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS series_id uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by_email text;

UPDATE household_expenses
SET series_id=id
WHERE series_id IS NULL;

CREATE INDEX IF NOT EXISTS household_expenses_series_idx
  ON household_expenses(household_id,series_id,due_date);

CREATE TABLE IF NOT EXISTS household_expense_splits (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES household_expenses(id) ON DELETE CASCADE,
  member_email text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS household_expense_splits_unique_member
  ON household_expense_splits(expense_id,lower(member_email));
CREATE INDEX IF NOT EXISTS household_expense_splits_member_idx
  ON household_expense_splits(lower(member_email),status);

CREATE TABLE IF NOT EXISTS household_budgets (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  category text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS household_budgets_unique_category
  ON household_budgets(household_id,month_key,lower(category));

CREATE TABLE IF NOT EXISTS household_goals (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(14,2) NOT NULL CHECK (target_amount > 0),
  current_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_date date,
  category text NOT NULL DEFAULT 'Family',
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS household_goals_household_idx
  ON household_goals(household_id,created_at DESC);

CREATE TABLE IF NOT EXISTS household_goal_contributions (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES household_goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_email text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS household_goal_contributions_goal_idx
  ON household_goal_contributions(goal_id,created_at DESC);

CREATE TABLE IF NOT EXISTS household_activity (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS household_activity_household_idx
  ON household_activity(household_id,created_at DESC);

CREATE TABLE IF NOT EXISTS household_reminder_deliveries (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES household_expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_key text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(expense_id,user_id,reminder_key,channel)
);
