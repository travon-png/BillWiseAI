import express from "express";
import { requireAuth, requirePlan, newId } from "../lib/auth.js";
import { query, one } from "../lib/db.js";
import { PLANS } from "../lib/plans.js";
import { bankSyncConfigured } from "../lib/plaid.js";
import {
  emailConfigured,
  verifyEmailConnection,
  sendTestEmail,
  sendHouseholdInviteEmail
} from "../lib/email.js";

const router = express.Router();
router.use(requireAuth);

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function parseDate(value) {
  return new Date(`${dateOnly(value)}T12:00:00`);
}

function addRecurrence(date, recurrence) {
  const d = new Date(date);

  if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "biweekly") d.setDate(d.getDate() + 14);
  else if (recurrence === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (recurrence === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);

  return d;
}

function sum(rows, key = "amount") {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function groupAmounts(rows, keySelector, amountSelector = row => Number(row.amount || 0)) {
  const out = {};

  for (const row of rows) {
    const key = keySelector(row) || "Other";
    out[key] = Number((Number(out[key] || 0) + amountSelector(row)).toFixed(2));
  }

  return Object.entries(out)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

async function baseFinancialData(userId) {
  const [bills, incomes, accounts, transactions] = await Promise.all([
    query("SELECT * FROM bills WHERE user_id=$1 ORDER BY due_date", [userId]),
    query("SELECT * FROM incomes WHERE user_id=$1 ORDER BY payday", [userId]),
    query("SELECT * FROM bank_accounts WHERE user_id=$1 ORDER BY name", [userId]),
    query(
      `SELECT * FROM bank_transactions
       WHERE user_id=$1
       ORDER BY date DESC
       LIMIT 1500`,
      [userId]
    ),
  ]);

  return {
    bills: bills.rows,
    incomes: incomes.rows,
    accounts: accounts.rows,
    transactions: transactions.rows,
  };
}

function buildForecast({ bills, incomes, accounts, days }) {
  const start = new Date();
  start.setHours(12, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const events = [];

  for (const bill of bills) {
    if (bill.paid) continue;

    let d = parseDate(bill.due_date);
    let guard = 0;

    if (bill.recurring) {
      while (d < start && guard++ < 120) {
        d = addRecurrence(d, bill.recurrence);
      }

      while (d <= end && guard++ < 180) {
        events.push({
          date: d.toISOString().slice(0, 10),
          type: "bill",
          name: bill.name,
          category: bill.category,
          amount: Number(bill.amount),
        });
        d = addRecurrence(d, bill.recurrence);
      }
    } else if (d >= start && d <= end) {
      events.push({
        date: d.toISOString().slice(0, 10),
        type: "bill",
        name: bill.name,
        category: bill.category,
        amount: Number(bill.amount),
      });
    }
  }

  for (const income of incomes) {
    let d = parseDate(income.payday);
    let guard = 0;

    while (d < start && guard++ < 120) {
      d = addRecurrence(d, income.recurrence || "biweekly");
    }

    while (d <= end && guard++ < 180) {
      events.push({
        date: d.toISOString().slice(0, 10),
        type: "income",
        name: income.name,
        category: "Income",
        amount: Number(income.amount),
      });
      d = addRecurrence(d, income.recurrence || "biweekly");
    }
  }

  events.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (a.type === "income" ? -1 : 1)
  );

  const totalBills = sum(events.filter(x => x.type === "bill"));
  const totalIncome = sum(events.filter(x => x.type === "income"));
  const netChange = totalIncome - totalBills;
  const startingBankBalance = sum(accounts, "current_balance");
  const hasConnectedBalance = accounts.length > 0;

  let running = hasConnectedBalance ? startingBankBalance : 0;
  let lowestKnownBalance = hasConnectedBalance ? running : null;
  let shortfallDate = null;

  if (hasConnectedBalance) {
    for (const event of events) {
      running += event.type === "income" ? event.amount : -event.amount;

      if (lowestKnownBalance == null || running < lowestKnownBalance) {
        lowestKnownBalance = running;
      }

      if (!shortfallDate && running < 0) {
        shortfallDate = event.date;
      }
    }
  }

  const billsByCategory = groupAmounts(
    events.filter(x => x.type === "bill"),
    x => x.category
  );

  return {
    days,
    totalBills: Number(totalBills.toFixed(2)),
    totalIncome: Number(totalIncome.toFixed(2)),
    netChange: Number(netChange.toFixed(2)),
    startingBankBalance: hasConnectedBalance
      ? Number(startingBankBalance.toFixed(2))
      : null,
    knownEndingBalance: hasConnectedBalance
      ? Number((startingBankBalance + netChange).toFixed(2))
      : null,
    lowestKnownBalance: lowestKnownBalance == null
      ? null
      : Number(lowestKnownBalance.toFixed(2)),
    shortfallDate,
    billsByCategory,
    events,
    disclaimer:
      "Forecast uses only saved recurring bills, income, and connected balances. It may not include cash spending, taxes, debt, fees, irregular purchases, or transactions that have not synced yet.",
  };
}

router.get(
  "/forecast",
  requirePlan("plus", "pro", "family"),
  async (req, res, next) => {
    try {
      const maxDays = PLANS[req.user.plan].forecastDays;
      const requested = Math.max(7, Number(req.query.days || maxDays));
      const days = Math.min(maxDays, requested);

      const data = await baseFinancialData(req.user.id);
      res.json({
        plan: req.user.plan,
        maxDays,
        forecast: buildForecast({ ...data, days }),
      });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/insights",
  requirePlan("plus", "pro", "family"),
  async (req, res, next) => {
    try {
      const { bills, accounts, transactions } =
        await baseFinancialData(req.user.id);

      const subscriptions = bills.filter(x => x.is_subscription);
      const increases = bills
        .filter(
          x =>
            x.previous_amount != null &&
            Number(x.amount) > Number(x.previous_amount)
        )
        .map(x => ({
          id: x.id,
          name: x.name,
          previousAmount: Number(x.previous_amount),
          currentAmount: Number(x.amount),
          increase: Number(x.amount) - Number(x.previous_amount),
        }))
        .sort((a, b) => b.increase - a.increase);

      const highCostSubscriptions = subscriptions
        .map(x => ({
          id: x.id,
          name: x.name,
          monthlyAmount:
            x.recurrence === "yearly"
              ? Number(x.amount) / 12
              : Number(x.amount),
          annualAmount:
            x.recurrence === "yearly"
              ? Number(x.amount)
              : Number(x.amount) * 12,
        }))
        .sort((a, b) => b.annualAmount - a.annualAmount);

      const latest30 = transactions.filter(x => {
        const d = parseDate(x.date);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        return d >= cutoff && Number(x.amount) > 0 && !x.pending;
      });

      const categorySpending = groupAmounts(
        latest30,
        x => x.category || "Other"
      );

      const largestBills = bills
        .filter(x => !x.paid)
        .map(x => ({
          id: x.id,
          name: x.name,
          amount: Number(x.amount),
          category: x.category,
          dueDate: dateOnly(x.due_date),
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      res.json({
        subscriptionMonthly: Number(sum(subscriptions).toFixed(2)),
        subscriptionYearly: Number((sum(subscriptions) * 12).toFixed(2)),
        subscriptionsCount: subscriptions.length,
        highCostSubscriptions: highCostSubscriptions.slice(0, 6),
        increases: increases.slice(0, 10),
        largestBills,
        connectedAccounts: accounts.length,
        categorySpending30Days: categorySpending.slice(0, 8),
        transactionSampleSize30Days: latest30.length,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/goals",
  requirePlan("plus", "pro", "family"),
  async (req, res, next) => {
    try {
      const r = await query(
        `SELECT * FROM savings_goals
         WHERE user_id=$1
         ORDER BY created_at DESC`,
        [req.user.id]
      );
      res.json({ goals: r.rows });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/goals",
  requirePlan("plus", "pro", "family"),
  async (req, res, next) => {
    try {
      const g = req.body || {};
      if (!g.name || Number(g.targetAmount) <= 0) {
        return res.status(400).json({
          error: "Goal name and a target amount greater than 0 are required.",
        });
      }

      const row = await one(
        `INSERT INTO savings_goals(
          id,user_id,name,target_amount,current_amount,target_date,category,notes
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [
          newId(),
          req.user.id,
          String(g.name).trim(),
          Number(g.targetAmount),
          Math.max(0, Number(g.currentAmount || 0)),
          g.targetDate || null,
          g.category || "General",
          g.notes || "",
        ]
      );

      res.json({ goal: row });
    } catch (e) {
      next(e);
    }
  }
);

router.put(
  "/goals/:id",
  requirePlan("plus", "pro", "family"),
  async (req, res, next) => {
    try {
      const current = await one(
        "SELECT * FROM savings_goals WHERE id=$1 AND user_id=$2",
        [req.params.id, req.user.id]
      );

      if (!current) {
        return res.status(404).json({ error: "Goal not found." });
      }

      const g = req.body || {};
      const row = await one(
        `UPDATE savings_goals SET
          name=$1,
          target_amount=$2,
          current_amount=$3,
          target_date=$4,
          category=$5,
          notes=$6,
          updated_at=now()
         WHERE id=$7 AND user_id=$8
         RETURNING *`,
        [
          g.name ?? current.name,
          Number(g.targetAmount ?? current.target_amount),
          Math.max(0, Number(g.currentAmount ?? current.current_amount)),
          g.targetDate === undefined
            ? current.target_date
            : g.targetDate || null,
          g.category ?? current.category,
          g.notes ?? current.notes,
          req.params.id,
          req.user.id,
        ]
      );

      res.json({ goal: row });
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  "/goals/:id",
  requirePlan("plus", "pro", "family"),
  async (req, res, next) => {
    try {
      await query(
        "DELETE FROM savings_goals WHERE id=$1 AND user_id=$2",
        [req.params.id, req.user.id]
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/report",
  requirePlan("pro", "family"),
  async (req, res, next) => {
    try {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ""))
        ? String(req.query.month)
        : new Date().toISOString().slice(0, 7);

      const start = `${month}-01`;
      const nextDate = new Date(`${start}T12:00:00`);
      nextDate.setMonth(nextDate.getMonth() + 1);
      const end = nextDate.toISOString().slice(0, 10);

      const [transactions, bills, incomes] = await Promise.all([
        query(
          `SELECT * FROM bank_transactions
           WHERE user_id=$1 AND date >= $2 AND date < $3
           ORDER BY date DESC`,
          [req.user.id, start, end]
        ),
        query(
          `SELECT * FROM bills
           WHERE user_id=$1 AND due_date >= $2 AND due_date < $3
           ORDER BY due_date`,
          [req.user.id, start, end]
        ),
        query(
          `SELECT * FROM incomes
           WHERE user_id=$1 AND payday >= $2 AND payday < $3
           ORDER BY payday`,
          [req.user.id, start, end]
        ),
      ]);

      const postedSpend = transactions.rows.filter(
        x => !x.pending && Number(x.amount) > 0
      );

      const categorySpending = groupAmounts(
        postedSpend,
        x => x.category || "Other"
      );

      const merchantSpending = groupAmounts(
        postedSpend,
        x => x.merchant_name || x.name || "Unknown"
      );

      const payload = {
        month,
        connectedTransactionSpend: Number(sum(postedSpend).toFixed(2)),
        knownBillsDue: Number(sum(bills.rows).toFixed(2)),
        enteredIncome: Number(sum(incomes.rows).toFixed(2)),
        subscriptionsDue: Number(
          sum(bills.rows.filter(x => x.is_subscription)).toFixed(2)
        ),
        categorySpending: categorySpending.slice(0, 12),
        topMerchants: merchantSpending.slice(0, 10),
        bills: bills.rows,
        incomes: incomes.rows,
        transactionCount: postedSpend.length,
        disclaimer:
          "This report summarizes data available to BillWise AI. Bank transactions can be delayed, incomplete, duplicated during provider corrections, or categorized differently by the financial institution.",
      };

      await query(
        `INSERT INTO money_report_snapshots(id,user_id,month_key,payload)
         VALUES($1,$2,$3,$4::jsonb)
         ON CONFLICT(user_id,month_key)
         DO UPDATE SET payload=excluded.payload,created_at=now()`,
        [newId(), req.user.id, month, JSON.stringify(payload)]
      );

      res.json({ report: payload });
    } catch (e) {
      next(e);
    }
  }
);

router.get("/integrations/status", async (req, res, next) => {
  try {
    const provider = String(process.env.BILLING_PROVIDER || "demo").toLowerCase();
    const stripeConfigured = Boolean(
      process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.STRIPE_PRICE_PLUS &&
      process.env.STRIPE_PRICE_PRO &&
      process.env.STRIPE_PRICE_FAMILY
    );
    const polarConfigured = Boolean(
      process.env.POLAR_ACCESS_TOKEN &&
      process.env.POLAR_WEBHOOK_SECRET &&
      process.env.POLAR_PRODUCT_PLUS &&
      process.env.POLAR_PRODUCT_PRO &&
      process.env.POLAR_PRODUCT_FAMILY
    );

    let databaseConnected = false;
    try {
      await query("SELECT 1");
      databaseConnected = true;
    } catch {}

    const emailHealth = await verifyEmailConnection();

    const billing = await one(
      `SELECT provider,status,plan,current_period_end,cancel_at_period_end
       FROM billing_customers WHERE user_id=$1`,
      [req.user.id]
    );

    const bankCount = await one(
      `SELECT count(*)::int count FROM bank_items WHERE user_id=$1`,
      [req.user.id]
    );

    res.json({
      postgres: {
        configured: databaseConnected,
        label: "Secure cloud data",
      },
      email: {
        configured: emailHealth.configured && emailHealth.reachable,
        configuredButUnreachable: emailHealth.configured && !emailHealth.reachable,
        enabledForUser: Boolean(req.user.email_reminders),
        label: "Email reminders",
      },
      billing: {
        provider,
        productionReady:
          (provider === "stripe" && stripeConfigured) ||
          (provider === "polar" && polarConfigured),
        demo: provider === "demo",
        status: billing?.status || (provider === "demo" ? "demo" : "not_started"),
        plan: billing?.plan || req.user.plan,
        currentPeriodEnd: billing?.current_period_end || null,
        cancelAtPeriodEnd: Boolean(billing?.cancel_at_period_end),
      },
      bank: {
        configured: bankSyncConfigured(),
        provider: "Plaid",
        env: process.env.PLAID_ENV || "sandbox",
        readOnly: true,
        connections: bankCount?.count || 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  "/integrations/test-email",
  requirePlan("plus", "pro", "family"),
  async (req, res, next) => {
    try {
      if (!emailConfigured()) {
        return res.status(503).json({
          error: "SMTP is not configured yet.",
        });
      }

      try {
        await sendTestEmail({
          to: req.user.email,
          userName: req.user.name,
        });
      } catch (error) {
        console.error("Test email failed:", error.message);
        return res.status(502).json({
          error: "The email provider could not send the test message. Check your SMTP credentials and sender address.",
        });
      }

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

async function membership(householdId, user) {
  const owner = await one(
    "SELECT * FROM households WHERE id=$1 AND owner_user_id=$2",
    [householdId, user.id]
  );

  if (owner) {
    return { household: owner, role: "owner", status: "active" };
  }

  const member = await one(
    `SELECT hm.*,h.name household_name,h.owner_user_id
     FROM household_members hm
     JOIN households h ON h.id=hm.household_id
     WHERE hm.household_id=$1
       AND (
         hm.user_id=$2 OR lower(hm.email)=lower($3)
       )
       AND hm.status='active'`,
    [householdId, user.id, user.email]
  );

  return member
    ? {
        household: {
          id: member.household_id,
          name: member.household_name,
          owner_user_id: member.owner_user_id,
        },
        role: member.role,
        status: member.status,
      }
    : null;
}

router.get(
  "/family",
  requirePlan("family"),
  async (req, res, next) => {
    try {
      // Automatically attach active invitations that were created before
      // the invited person had a BillWise account.
      await query(
        `UPDATE household_members
         SET user_id=$1,updated_at=now()
         WHERE lower(email)=lower($2)
           AND user_id IS NULL
           AND status='active'`,
        [req.user.id, req.user.email]
      );

      const households = await query(
        `SELECT DISTINCT
           h.*,
           CASE WHEN h.owner_user_id=$1 THEN 'owner' ELSE hm.role END AS my_role
         FROM households h
         LEFT JOIN household_members hm
           ON hm.household_id=h.id
          AND hm.status='active'
         WHERE h.owner_user_id=$1
            OR hm.user_id=$1
            OR lower(hm.email)=lower($2)
         ORDER BY h.created_at DESC`,
        [req.user.id, req.user.email]
      );

      const pending = await query(
        `SELECT hm.*,h.name household_name
         FROM household_members hm
         JOIN households h ON h.id=hm.household_id
         WHERE lower(hm.email)=lower($1)
           AND hm.status='pending'
         ORDER BY hm.created_at DESC`,
        [req.user.email]
      );

      const result = [];

      for (const household of households.rows) {
        const members = await query(
          `SELECT id,user_id,email,role,status,created_at
           FROM household_members
           WHERE household_id=$1
           ORDER BY role DESC,created_at`,
          [household.id]
        );

        const expenses = await query(
          `SELECT * FROM household_expenses
           WHERE household_id=$1
           ORDER BY paid ASC,due_date ASC NULLS LAST,created_at DESC`,
          [household.id]
        );

        result.push({
          ...household,
          members: members.rows,
          expenses: expenses.rows,
        });
      }

      res.json({
        households: result,
        pendingInvites: pending.rows,
        memberLimit: PLANS.family.householdMembers,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/family",
  requirePlan("family"),
  async (req, res, next) => {
    try {
      const existing = await one(
        "SELECT id FROM households WHERE owner_user_id=$1",
        [req.user.id]
      );

      if (existing) {
        return res.status(409).json({
          error: "This account already owns a household.",
        });
      }

      const household = await one(
        `INSERT INTO households(id,owner_user_id,name)
         VALUES($1,$2,$3)
         RETURNING *`,
        [
          newId(),
          req.user.id,
          String(req.body?.name || `${req.user.name}'s Household`).trim(),
        ]
      );

      await query(
        `INSERT INTO household_members(
          id,household_id,user_id,email,role,status
        ) VALUES($1,$2,$3,$4,'owner','active')`,
        [
          newId(),
          household.id,
          req.user.id,
          req.user.email,
        ]
      );

      res.json({ household });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/family/:id/invite",
  requirePlan("family"),
  async (req, res, next) => {
    try {
      const household = await one(
        "SELECT * FROM households WHERE id=$1 AND owner_user_id=$2",
        [req.params.id, req.user.id]
      );

      if (!household) {
        return res.status(403).json({
          error: "Only the household owner can invite members.",
        });
      }

      const count = await one(
        `SELECT count(*)::int count
         FROM household_members
         WHERE household_id=$1
           AND status IN ('pending','active')`,
        [household.id]
      );

      if (count.count >= PLANS.family.householdMembers) {
        return res.status(403).json({
          error: `Family supports up to ${PLANS.family.householdMembers} household members including the owner.`,
        });
      }

      const email = String(req.body?.email || "").trim().toLowerCase();

      if (!email || !email.includes("@")) {
        return res.status(400).json({
          error: "Enter a valid email address.",
        });
      }

      const invitedUser = await one(
        "SELECT id FROM users WHERE lower(email)=lower($1)",
        [email]
      );

      const invite = await one(
        `INSERT INTO household_members(
          id,household_id,user_id,email,role,status
        ) VALUES($1,$2,$3,$4,'member','pending')
        ON CONFLICT(household_id,email)
        DO UPDATE SET
          user_id=excluded.user_id,
          status='pending',
          updated_at=now()
        RETURNING *`,
        [
          newId(),
          household.id,
          invitedUser?.id || null,
          email,
        ]
      );

      let emailSent = false;

      if (emailConfigured()) {
        try {
          await sendHouseholdInviteEmail({
            to: email,
            inviterName: req.user.name,
            householdName: household.name,
          });
          emailSent = true;
        } catch (e) {
          console.warn("Household invitation email failed:", e.message);
        }
      }

      res.json({ invite, emailSent });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/family/:id/accept",
  requirePlan("family"),
  async (req, res, next) => {
    try {
      const invite = await one(
        `SELECT * FROM household_members
         WHERE household_id=$1
           AND lower(email)=lower($2)
           AND status='pending'`,
        [req.params.id, req.user.email]
      );

      if (!invite) {
        return res.status(404).json({
          error: "No pending household invitation was found for this email.",
        });
      }

      await query(
        `UPDATE household_members
         SET user_id=$1,status='active',updated_at=now()
         WHERE id=$2`,
        [req.user.id, invite.id]
      );

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/family/:id/expenses",
  requirePlan("family"),
  async (req, res, next) => {
    try {
      const access = await membership(req.params.id, req.user);

      if (!access) {
        return res.status(403).json({
          error: "You do not have access to this household.",
        });
      }

      const e = req.body || {};

      if (!e.name || Number(e.amount) < 0) {
        return res.status(400).json({
          error: "Expense name and amount are required.",
        });
      }

      const row = await one(
        `INSERT INTO household_expenses(
          id,household_id,created_by_user_id,name,amount,due_date,
          category,assigned_to_email,paid,notes
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *`,
        [
          newId(),
          req.params.id,
          req.user.id,
          String(e.name).trim(),
          Number(e.amount),
          e.dueDate || null,
          e.category || "Shared",
          e.assignedToEmail || null,
          Boolean(e.paid),
          e.notes || "",
        ]
      );

      res.json({ expense: row });
    } catch (e) {
      next(e);
    }
  }
);

router.put(
  "/family/:householdId/expenses/:expenseId",
  requirePlan("family"),
  async (req, res, next) => {
    try {
      const access = await membership(req.params.householdId, req.user);

      if (!access) {
        return res.status(403).json({
          error: "You do not have access to this household.",
        });
      }

      const current = await one(
        `SELECT * FROM household_expenses
         WHERE id=$1 AND household_id=$2`,
        [req.params.expenseId, req.params.householdId]
      );

      if (!current) {
        return res.status(404).json({
          error: "Shared expense not found.",
        });
      }

      const e = req.body || {};

      const row = await one(
        `UPDATE household_expenses SET
          name=$1,
          amount=$2,
          due_date=$3,
          category=$4,
          assigned_to_email=$5,
          paid=$6,
          notes=$7,
          updated_at=now()
         WHERE id=$8 AND household_id=$9
         RETURNING *`,
        [
          e.name ?? current.name,
          Number(e.amount ?? current.amount),
          e.dueDate === undefined
            ? current.due_date
            : e.dueDate || null,
          e.category ?? current.category,
          e.assignedToEmail === undefined
            ? current.assigned_to_email
            : e.assignedToEmail || null,
          e.paid ?? current.paid,
          e.notes ?? current.notes,
          req.params.expenseId,
          req.params.householdId,
        ]
      );

      res.json({ expense: row });
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  "/family/:householdId/expenses/:expenseId",
  requirePlan("family"),
  async (req, res, next) => {
    try {
      const access = await membership(req.params.householdId, req.user);

      if (!access) {
        return res.status(403).json({
          error: "You do not have access to this household.",
        });
      }

      await query(
        `DELETE FROM household_expenses
         WHERE id=$1 AND household_id=$2`,
        [req.params.expenseId, req.params.householdId]
      );

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
