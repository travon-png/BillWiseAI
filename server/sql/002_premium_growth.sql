CREATE TABLE IF NOT EXISTS savings_goals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(14,2) NOT NULL CHECK (target_amount > 0),
  current_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_date date,
  category text NOT NULL DEFAULT 'General',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS savings_goals_user_idx
  ON savings_goals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS households (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS households_owner_idx
  ON households(owner_user_id);

CREATE TABLE IF NOT EXISTS household_members (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner','member')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(household_id,email)
);
CREATE INDEX IF NOT EXISTS household_members_user_idx
  ON household_members(user_id,status);
CREATE INDEX IF NOT EXISTS household_members_email_idx
  ON household_members(lower(email),status);

CREATE TABLE IF NOT EXISTS household_expenses (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  due_date date,
  category text NOT NULL DEFAULT 'Shared',
  assigned_to_email text,
  paid boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS household_expenses_household_idx
  ON household_expenses(household_id,due_date);

CREATE TABLE IF NOT EXISTS money_report_snapshots (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,month_key)
);
