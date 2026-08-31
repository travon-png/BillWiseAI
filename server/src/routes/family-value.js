import express from "express";
import { requireAuth, newId } from "../lib/auth.js";
import { query, one } from "../lib/db.js";
import {
  emailConfigured,
  sendHouseholdInviteEmail,
  sendHouseholdDigestEmail,
} from "../lib/email.js";

const router = express.Router();
router.use(requireAuth);

const FAMILY_LIMIT = 5;
const VALID_RECURRENCE = new Set(["weekly", "biweekly", "monthly", "quarterly", "yearly"]);

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parseDate(value) {
  return new Date(`${dateOnly(value)}T12:00:00Z`);
}

function addRecurrence(value, recurrence = "monthly") {
  const d = parseDate(value);
  if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === "biweekly") d.setUTCDate(d.getUTCDate() + 14);
  else if (recurrence === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (recurrence === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function monthKey(value = new Date()) {
  const d = value instanceof Date ? value : parseDate(value);
  return d.toISOString().slice(0, 7);
}

function number(value) {
  return Number(value || 0);
}

async function logActivity(householdId, actor, action, entityType, entityId, message, metadata = {}) {
  await query(
    `INSERT INTO household_activity(
      id,household_id,actor_user_id,actor_email,action,entity_type,entity_id,message,metadata
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      newId(),
      householdId,
      actor?.id || null,
      actor?.email || "system@billwise.local",
      action,
      entityType,
      entityId || null,
      message,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function getAccess(householdId, user) {
  return one(
    `SELECT
       h.id,
       h.name,
       h.owner_user_id,
       owner.name owner_name,
       owner.email owner_email,
       owner.plan owner_plan,
       CASE
         WHEN h.owner_user_id=$2 THEN 'owner'
         ELSE hm.role
       END my_role,
       CASE
         WHEN h.owner_user_id=$2 THEN 'active'
         ELSE hm.status
       END my_status
     FROM households h
     JOIN users owner ON owner.id=h.owner_user_id
     LEFT JOIN household_members hm
       ON hm.household_id=h.id
      AND (
        hm.user_id=$2 OR lower(hm.email)=lower($3)
      )
     WHERE h.id=$1
       AND owner.plan='family'
       AND (
         h.owner_user_id=$2 OR hm.status='active'
       )
     LIMIT 1`,
    [householdId, user.id, user.email]
  );
}

async function getPrimaryAccess(user) {
  return one(
    `SELECT
       h.id,
       h.name,
       h.owner_user_id,
       h.created_at,
       owner.name owner_name,
       owner.email owner_email,
       owner.plan owner_plan,
       CASE
         WHEN h.owner_user_id=$1 THEN 'owner'
         ELSE hm.role
       END my_role,
       CASE
         WHEN h.owner_user_id=$1 THEN 'active'
         ELSE hm.status
       END my_status
     FROM households h
     JOIN users owner ON owner.id=h.owner_user_id
     LEFT JOIN household_members hm
       ON hm.household_id=h.id
      AND (
        hm.user_id=$1 OR lower(hm.email)=lower($2)
      )
     WHERE owner.plan='family'
       AND (
         h.owner_user_id=$1 OR hm.status='active'
       )
     ORDER BY (h.owner_user_id=$1) DESC,h.created_at DESC
     LIMIT 1`,
    [user.id, user.email]
  );
}

async function pendingInvites(user) {
  const r = await query(
    `SELECT hm.id,hm.household_id,hm.email,hm.created_at,h.name household_name,
            owner.name owner_name,owner.email owner_email
     FROM household_members hm
     JOIN households h ON h.id=hm.household_id
     JOIN users owner ON owner.id=h.owner_user_id
     WHERE lower(hm.email)=lower($1)
       AND hm.status='pending'
       AND owner.plan='family'
     ORDER BY hm.created_at DESC`,
    [user.email]
  );
  return r.rows;
}

async function activeMembers(householdId) {
  const r = await query(
    `SELECT hm.id,hm.user_id,hm.email,hm.role,hm.status,hm.created_at,
            u.name,u.plan
     FROM household_members hm
     LEFT JOIN users u ON u.id=hm.user_id
     WHERE hm.household_id=$1 AND hm.status='active'
     ORDER BY CASE WHEN hm.role='owner' THEN 0 ELSE 1 END,lower(hm.email)`,
    [householdId]
  );
  return r.rows;
}

async function validateCustomSplits(householdId, amount, requestedSplits = []) {
  const members = await activeMembers(householdId);
  const valid = new Set(members.map(m => String(m.email).toLowerCase()));
  let totalCents = 0;
  let count = 0;

  for (const raw of Array.isArray(requestedSplits) ? requestedSplits : []) {
    const email = String(raw?.email || "").trim().toLowerCase();
    const cents = Math.round(number(raw?.amount) * 100);
    if (!valid.has(email) || cents < 0) continue;
    if (cents > 0) count++;
    totalCents += Math.max(0, cents);
  }

  const expenseCents = Math.round(number(amount) * 100);
  if (!count || totalCents !== expenseCents) {
    throw Object.assign(
      new Error(`Custom shares must total exactly $${number(amount).toFixed(2)}.`),
      { status: 400 }
    );
  }
}

async function rebuildSplits(expense, requestedMode, requestedAssignedEmail, actor, requestedSplits = []) {
  await query("DELETE FROM household_expense_splits WHERE expense_id=$1", [expense.id]);

  const members = await activeMembers(expense.household_id);
  if (!members.length) return [];

  const mode = ["equal", "assigned", "custom"].includes(requestedMode)
    ? requestedMode
    : "assigned";
  const created = [];

  if (mode === "equal") {
    const totalCents = Math.round(number(expense.amount) * 100);
    const base = Math.floor(totalCents / members.length);
    let remainder = totalCents - base * members.length;

    for (const member of members) {
      const cents = base + (remainder-- > 0 ? 1 : 0);
      const row = await one(
        `INSERT INTO household_expense_splits(
          id,household_id,expense_id,member_email,amount,status
        ) VALUES($1,$2,$3,$4,$5,'unpaid')
        RETURNING *`,
        [newId(), expense.household_id, expense.id, member.email, cents / 100]
      );
      created.push(row);
    }
  } else if (mode === "custom") {
    const memberMap = new Map(members.map(m => [String(m.email).toLowerCase(), m]));
    const normalized = [];
    let totalCents = 0;

    for (const raw of Array.isArray(requestedSplits) ? requestedSplits : []) {
      const email = String(raw?.email || "").trim().toLowerCase();
      const amount = number(raw?.amount);
      if (!email || amount < 0 || !memberMap.has(email)) continue;
      const cents = Math.round(amount * 100);
      if (cents === 0) continue;
      totalCents += cents;
      normalized.push({ email: memberMap.get(email).email, cents });
    }

    const expenseCents = Math.round(number(expense.amount) * 100);
    if (!normalized.length || totalCents !== expenseCents) {
      throw Object.assign(
        new Error(`Custom shares must total exactly $${number(expense.amount).toFixed(2)}.`),
        { status: 400 }
      );
    }

    for (const split of normalized) {
      const row = await one(
        `INSERT INTO household_expense_splits(
          id,household_id,expense_id,member_email,amount,status
        ) VALUES($1,$2,$3,$4,$5,'unpaid')
        RETURNING *`,
        [newId(), expense.household_id, expense.id, split.email, split.cents / 100]
      );
      created.push(row);
    }
  } else {
    const requested = String(requestedAssignedEmail || actor.email).trim().toLowerCase();
    const target = members.find(m => String(m.email).toLowerCase() === requested) ||
      members.find(m => String(m.email).toLowerCase() === String(actor.email).toLowerCase()) ||
      members[0];

    const row = await one(
      `INSERT INTO household_expense_splits(
        id,household_id,expense_id,member_email,amount,status
      ) VALUES($1,$2,$3,$4,$5,'unpaid')
      RETURNING *`,
      [newId(), expense.household_id, expense.id, target.email, number(expense.amount)]
    );
    created.push(row);
  }

  return created;
}

async function rollForwardExpense(expense, actor) {
  if (!expense?.recurring || !expense?.due_date) return null;

  const recurrence = VALID_RECURRENCE.has(expense.recurrence) ? expense.recurrence : "monthly";
  const nextDue = addRecurrence(expense.due_date, recurrence);
  const seriesId = expense.series_id || expense.id;

  const existing = await one(
    `SELECT * FROM household_expenses
     WHERE household_id=$1 AND series_id=$2 AND due_date=$3
     LIMIT 1`,
    [expense.household_id, seriesId, nextDue]
  );
  if (existing) return existing;

  const next = await one(
    `INSERT INTO household_expenses(
      id,household_id,created_by_user_id,name,amount,due_date,category,
      assigned_to_email,paid,notes,recurring,recurrence,split_mode,series_id,
      reminder_scope,is_subscription
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,$9,true,$10,$11,$12,$13,$14)
    RETURNING *`,
    [
      newId(),
      expense.household_id,
      expense.created_by_user_id,
      expense.name,
      expense.amount,
      nextDue,
      expense.category,
      expense.assigned_to_email,
      expense.notes || "",
      recurrence,
      expense.split_mode || "assigned",
      seriesId,
      expense.reminder_scope || "assigned",
      Boolean(expense.is_subscription),
    ]
  );

  const previousSplits = await query(
    `SELECT member_email,amount FROM household_expense_splits
     WHERE expense_id=$1 ORDER BY created_at`,
    [expense.id]
  );

  for (const split of previousSplits.rows) {
    await query(
      `INSERT INTO household_expense_splits(
        id,household_id,expense_id,member_email,amount,status
      ) VALUES($1,$2,$3,$4,$5,'unpaid')`,
      [newId(), expense.household_id, next.id, split.member_email, split.amount]
    );
  }

  await logActivity(
    expense.household_id,
    actor,
    "recurring_expense_rolled_forward",
    "expense",
    next.id,
    `${expense.name} was automatically rolled forward to ${nextDue}.`,
    { previousExpenseId: expense.id, nextDue }
  );

  return next;
}

async function householdData(access, user) {
  const id = access.id;
  const currentMonth = monthKey();
  const nextMonthDate = new Date(`${currentMonth}-01T12:00:00Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const nextMonth = nextMonthDate.toISOString().slice(0, 7);
  const previousMonthDate = new Date(`${currentMonth}-01T12:00:00Z`);
  previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [membersR, expensesR, splitsR, budgetsR, goalsR, contributionsR, activityR] = await Promise.all([
    query(
      `SELECT hm.id,hm.user_id,hm.email,hm.role,hm.status,hm.created_at,
              u.name,u.plan
       FROM household_members hm
       LEFT JOIN users u ON u.id=hm.user_id
       WHERE hm.household_id=$1
       ORDER BY CASE WHEN hm.role='owner' THEN 0 ELSE 1 END,hm.created_at`,
      [id]
    ),
    query(
      `SELECT e.*,u.name created_by_name,u.email created_by_email
       FROM household_expenses e
       LEFT JOIN users u ON u.id=e.created_by_user_id
       WHERE e.household_id=$1
       ORDER BY e.paid ASC,e.due_date ASC NULLS LAST,e.created_at DESC
       LIMIT 250`,
      [id]
    ),
    query(
      `SELECT * FROM household_expense_splits
       WHERE household_id=$1
       ORDER BY created_at`,
      [id]
    ),
    query(
      `SELECT * FROM household_budgets
       WHERE household_id=$1 AND month_key=$2
       ORDER BY category`,
      [id, currentMonth]
    ),
    query(
      `SELECT * FROM household_goals
       WHERE household_id=$1
       ORDER BY created_at DESC`,
      [id]
    ),
    query(
      `SELECT c.*,u.name contributor_name
       FROM household_goal_contributions c
       LEFT JOIN users u ON u.id=c.user_id
       WHERE c.household_id=$1
       ORDER BY c.created_at DESC
       LIMIT 100`,
      [id]
    ),
    query(
      `SELECT * FROM household_activity
       WHERE household_id=$1
       ORDER BY created_at DESC
       LIMIT 40`,
      [id]
    ),
  ]);

  await query(
    `INSERT INTO household_settings(household_id)
     VALUES($1)
     ON CONFLICT(household_id) DO NOTHING`,
    [id]
  );
  const settings = await one(
    `SELECT weekly_digest_enabled,digest_weekday,digest_hour,remind_everyone_default
     FROM household_settings WHERE household_id=$1`,
    [id]
  );
  const viewerIncomes = (await query(
    `SELECT * FROM incomes WHERE user_id=$1 ORDER BY payday`,
    [user.id]
  )).rows;

  const expenses = expensesR.rows;
  const splits = splitsR.rows;
  const unpaid = expenses.filter(e => !e.paid);
  const monthExpenses = expenses.filter(e => {
    const due = dateOnly(e.due_date);
    return due && due >= `${currentMonth}-01` && due < `${nextMonth}-01`;
  });
  const paidThisMonth = expenses.filter(e => {
    const paid = e.paid_at ? new Date(e.paid_at).toISOString().slice(0, 7) : null;
    return paid === currentMonth;
  });
  const previousMonthExpenses = expenses.filter(e => {
    const due = dateOnly(e.due_date);
    return due && due >= `${previousMonth}-01` && due < `${currentMonth}-01`;
  });
  const dueNext7 = unpaid.filter(e => {
    const due = dateOnly(e.due_date);
    return due && due >= today && due <= next7;
  });
  const overdue = unpaid.filter(e => dateOnly(e.due_date) && dateOnly(e.due_date) < today);

  const recurringMonthly = expenses
    .filter(e => e.recurring)
    .reduce((sum, e) => {
      const amount = number(e.amount);
      const monthly = e.recurrence === "weekly" ? amount * 52 / 12
        : e.recurrence === "biweekly" ? amount * 26 / 12
        : e.recurrence === "quarterly" ? amount / 3
        : e.recurrence === "yearly" ? amount / 12
        : amount;
      return sum + monthly;
    }, 0);

  const subscriptionMonthly = expenses
    .filter(e => e.recurring && e.is_subscription)
    .reduce((sum, e) => {
      const amount = number(e.amount);
      const monthly = e.recurrence === "weekly" ? amount * 52 / 12
        : e.recurrence === "biweekly" ? amount * 26 / 12
        : e.recurrence === "quarterly" ? amount / 3
        : e.recurrence === "yearly" ? amount / 12
        : amount;
      return sum + monthly;
    }, 0);

  const futurePaydays = viewerIncomes
    .map(i => ({ ...i, date: dateOnly(i.payday) }))
    .filter(i => i.date && i.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextPayday = futurePaydays[0]?.date || null;

  const responsibility = {};
  for (const split of splits.filter(s => s.status === "unpaid")) {
    const key = String(split.member_email).toLowerCase();
    responsibility[key] = number((responsibility[key] || 0) + number(split.amount));
  }

  const expenseById = new Map(expenses.map(e => [e.id, e]));
  const myOpenSplits = splits.filter(s =>
    s.status === "unpaid" &&
    String(s.member_email).toLowerCase() === String(user.email).toLowerCase()
  );
  const dueBeforeNextPayday = nextPayday
    ? myOpenSplits.reduce((sum, split) => {
        const e = expenseById.get(split.expense_id);
        const due = dateOnly(e?.due_date);
        return due && due <= nextPayday ? sum + number(split.amount) : sum;
      }, 0)
    : null;
  const householdDueBeforeNextPayday = nextPayday
    ? unpaid.reduce((sum, e) => {
        const due = dateOnly(e.due_date);
        return due && due <= nextPayday ? sum + number(e.amount) : sum;
      }, 0)
    : null;

  const budgets = budgetsR.rows.map(b => {
    const scheduled = monthExpenses
      .filter(e => String(e.category).toLowerCase() === String(b.category).toLowerCase())
      .reduce((s, e) => s + number(e.amount), 0);
    const previousScheduled = previousMonthExpenses
      .filter(e => String(e.category).toLowerCase() === String(b.category).toLowerCase())
      .reduce((s, e) => s + number(e.amount), 0);
    const trendAmount = scheduled - previousScheduled;
    return {
      ...b,
      scheduled: Number(scheduled.toFixed(2)),
      previousMonthScheduled: Number(previousScheduled.toFixed(2)),
      trendAmount: Number(trendAmount.toFixed(2)),
      trendPercent: previousScheduled > 0 ? Number(((trendAmount / previousScheduled) * 100).toFixed(1)) : null,
      remaining: Number((number(b.amount) - scheduled).toFixed(2)),
      percent: number(b.amount) > 0 ? Math.round((scheduled / number(b.amount)) * 100) : 0,
      over: scheduled > number(b.amount),
    };
  });

  const goals = goalsR.rows.map(goal => ({
    ...goal,
    contributions: contributionsR.rows.filter(c => c.goal_id === goal.id),
  }));

  return {
    household: {
      id: access.id,
      name: access.name,
      ownerUserId: access.owner_user_id,
      ownerName: access.owner_name,
      ownerEmail: access.owner_email,
      myRole: access.my_role,
      memberLimit: FAMILY_LIMIT,
    },
    settings,
    members: membersR.rows,
    expenses,
    splits,
    budgets,
    goals,
    activity: activityR.rows,
    currentMonth,
    summary: {
      unpaidShared: Number(unpaid.reduce((s, e) => s + number(e.amount), 0).toFixed(2)),
      dueNext7: Number(dueNext7.reduce((s, e) => s + number(e.amount), 0).toFixed(2)),
      dueNext7Count: dueNext7.length,
      overdue: Number(overdue.reduce((s, e) => s + number(e.amount), 0).toFixed(2)),
      overdueCount: overdue.length,
      paidThisMonth: Number(paidThisMonth.reduce((s, e) => s + number(e.amount), 0).toFixed(2)),
      plannedThisMonth: Number(monthExpenses.reduce((s, e) => s + number(e.amount), 0).toFixed(2)),
      budgetTotal: Number(budgets.reduce((s, b) => s + number(b.amount), 0).toFixed(2)),
      overBudgetCount: budgets.filter(b => b.over).length,
      recurringMonthly: Number(recurringMonthly.toFixed(2)),
      subscriptionMonthly: Number(subscriptionMonthly.toFixed(2)),
      nextPayday,
      dueBeforeNextPayday: dueBeforeNextPayday == null ? null : Number(dueBeforeNextPayday.toFixed(2)),
      householdDueBeforeNextPayday: householdDueBeforeNextPayday == null ? null : Number(householdDueBeforeNextPayday.toFixed(2)),
      myOpenShares: Number(myOpenSplits.reduce((sum, split) => sum + number(split.amount), 0).toFixed(2)),
      responsibility: Object.entries(responsibility)
        .map(([email, amount]) => ({ email, amount: Number(amount.toFixed(2)) }))
        .sort((a, b) => b.amount - a.amount),
    },
    viewer: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      isOwner: access.my_role === "owner",
    },
  };
}

router.get("/overview", async (req, res, next) => {
  try {
    // Attach accepted records that were invited before the user registered.
    await query(
      `UPDATE household_members
       SET user_id=$1,updated_at=now()
       WHERE lower(email)=lower($2)
         AND user_id IS NULL
         AND status='active'`,
      [req.user.id, req.user.email]
    );

    const [access, invites] = await Promise.all([
      getPrimaryAccess(req.user),
      pendingInvites(req.user),
    ]);

    if (!access) {
      return res.json({
        entitled: false,
        canCreate: req.user.plan === "family",
        pendingInvites: invites,
        household: null,
      });
    }

    res.json({
      entitled: true,
      canCreate: false,
      pendingInvites: invites,
      ...(await householdData(access, req.user)),
    });
  } catch (e) {
    next(e);
  }
});

router.post("/household", async (req, res, next) => {
  try {
    if (req.user.plan !== "family") {
      return res.status(403).json({ error: "Creating a Family household requires the Family plan." });
    }

    const existing = await one("SELECT id FROM households WHERE owner_user_id=$1", [req.user.id]);
    if (existing) return res.status(409).json({ error: "This account already owns a household." });

    const household = await one(
      `INSERT INTO households(id,owner_user_id,name)
       VALUES($1,$2,$3)
       RETURNING *`,
      [newId(), req.user.id, String(req.body?.name || `${req.user.name}'s Household`).trim()]
    );

    await query(
      `INSERT INTO household_members(id,household_id,user_id,email,role,status)
       VALUES($1,$2,$3,$4,'owner','active')`,
      [newId(), household.id, req.user.id, req.user.email]
    );

    await logActivity(
      household.id,
      req.user,
      "household_created",
      "household",
      household.id,
      `${req.user.name} created ${household.name}.`
    );

    res.json({ household });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/invite", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access || access.my_role !== "owner") {
      return res.status(403).json({ error: "Only the Family household owner can invite members." });
    }

    const count = await one(
      `SELECT count(*)::int count
       FROM household_members
       WHERE household_id=$1 AND status IN ('pending','active')`,
      [access.id]
    );
    if (count.count >= FAMILY_LIMIT) {
      return res.status(403).json({ error: `Family includes up to ${FAMILY_LIMIT} people including the owner.` });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Enter a valid email address." });
    if (email === String(req.user.email).toLowerCase()) return res.status(400).json({ error: "You are already the household owner." });

    const invitedUser = await one("SELECT id FROM users WHERE lower(email)=lower($1)", [email]);
    const invite = await one(
      `INSERT INTO household_members(id,household_id,user_id,email,role,status)
       VALUES($1,$2,$3,$4,'member','pending')
       ON CONFLICT(household_id,email)
       DO UPDATE SET user_id=excluded.user_id,status='pending',updated_at=now()
       RETURNING *`,
      [newId(), access.id, invitedUser?.id || null, email]
    );

    let emailSent = false;
    if (emailConfigured()) {
      try {
        await sendHouseholdInviteEmail({
          to: email,
          inviterName: req.user.name,
          householdName: access.name,
        });
        emailSent = true;
      } catch (e) {
        console.warn("Family invite email failed:", e.message);
      }
    }

    await logActivity(
      access.id,
      req.user,
      "member_invited",
      "member",
      invite.id,
      `${req.user.name} invited ${email}.`,
      { email }
    );

    res.json({ invite, emailSent });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/accept", async (req, res, next) => {
  try {
    const invite = await one(
      `SELECT hm.*,h.name household_name,owner.plan owner_plan
       FROM household_members hm
       JOIN households h ON h.id=hm.household_id
       JOIN users owner ON owner.id=h.owner_user_id
       WHERE hm.household_id=$1
         AND lower(hm.email)=lower($2)
         AND hm.status='pending'`,
      [req.params.id, req.user.email]
    );

    if (!invite) return res.status(404).json({ error: "No active Family invitation was found for this email." });
    if (invite.owner_plan !== "family") return res.status(403).json({ error: "The household owner's Family subscription is not active." });

    await query(
      `UPDATE household_members
       SET user_id=$1,status='active',updated_at=now()
       WHERE id=$2`,
      [req.user.id, invite.id]
    );

    await logActivity(
      req.params.id,
      req.user,
      "member_joined",
      "member",
      invite.id,
      `${req.user.name} joined the household.`
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/members/:memberId", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access || access.my_role !== "owner") {
      return res.status(403).json({ error: "Only the household owner can remove members or cancel invitations." });
    }

    const member = await one(
      `SELECT * FROM household_members WHERE id=$1 AND household_id=$2`,
      [req.params.memberId, access.id]
    );
    if (!member) return res.status(404).json({ error: "Household member not found." });
    if (member.role === "owner") return res.status(400).json({ error: "The household owner cannot be removed." });

    const open = await one(
      `SELECT count(*)::int count
       FROM household_expense_splits
       WHERE household_id=$1 AND lower(member_email)=lower($2) AND status='unpaid'`,
      [access.id, member.email]
    );
    if (open?.count > 0) {
      return res.status(409).json({ error: "This person still has unpaid household shares. Mark or reassign those shares before removing them." });
    }

    await query("DELETE FROM household_members WHERE id=$1 AND household_id=$2", [member.id, access.id]);
    await logActivity(
      access.id, req.user, "member_removed", "member", member.id,
      `${req.user.name} removed ${member.email} from the household.`
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/leave", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this household." });
    if (access.my_role === "owner") {
      return res.status(400).json({ error: "The household owner cannot leave while owning the Family workspace." });
    }

    const open = await one(
      `SELECT count(*)::int count
       FROM household_expense_splits
       WHERE household_id=$1 AND lower(member_email)=lower($2) AND status='unpaid'`,
      [access.id, req.user.email]
    );
    if (open?.count > 0) {
      return res.status(409).json({ error: "You still have unpaid household shares. Handle those responsibilities before leaving." });
    }

    await query(
      `DELETE FROM household_members
       WHERE household_id=$1 AND (user_id=$2 OR lower(email)=lower($3)) AND role<>'owner'`,
      [access.id, req.user.id, req.user.email]
    );
    await logActivity(
      access.id, req.user, "member_left", "member", null,
      `${req.user.name} left the household.`
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/expenses", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this Family household." });

    const e = req.body || {};
    const amount = number(e.amount);
    if (!String(e.name || "").trim() || amount <= 0) {
      return res.status(400).json({ error: "Expense name and an amount greater than 0 are required." });
    }

    const recurring = Boolean(e.recurring);
    const recurrence = VALID_RECURRENCE.has(e.recurrence) ? e.recurrence : "monthly";
    const id = newId();
    const splitMode = ["equal", "assigned", "custom"].includes(e.splitMode) ? e.splitMode : "assigned";
    const reminderScope = e.reminderScope === "everyone" ? "everyone" : "assigned";
    const isSubscription = Boolean(e.isSubscription);

    if (splitMode === "custom") {
      await validateCustomSplits(access.id, amount, e.customSplits);
    }

    const expense = await one(
      `INSERT INTO household_expenses(
        id,household_id,created_by_user_id,name,amount,due_date,category,
        assigned_to_email,paid,notes,recurring,recurrence,split_mode,series_id,
        reminder_scope,is_subscription
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        id,
        access.id,
        req.user.id,
        String(e.name).trim(),
        amount,
        e.dueDate || null,
        e.category || "Shared",
        e.assignedToEmail || req.user.email,
        e.notes || "",
        recurring,
        recurrence,
        splitMode,
        id,
        reminderScope,
        isSubscription,
      ]
    );

    const splits = await rebuildSplits(expense, splitMode, e.assignedToEmail, req.user, e.customSplits);

    await logActivity(
      access.id,
      req.user,
      "expense_created",
      "expense",
      expense.id,
      `${req.user.name} added ${expense.name} for $${amount.toFixed(2)}.`,
      { splitMode, recurring, recurrence, reminderScope, isSubscription }
    );

    res.json({ expense, splits });
  } catch (e) {
    next(e);
  }
});

router.put("/:id/expenses/:expenseId", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this Family household." });

    const current = await one(
      `SELECT * FROM household_expenses
       WHERE id=$1 AND household_id=$2`,
      [req.params.expenseId, access.id]
    );
    if (!current) return res.status(404).json({ error: "Shared expense not found." });

    const isOwner = access.my_role === "owner";
    const isCreator = current.created_by_user_id === req.user.id;
    const isAssigned = String(current.assigned_to_email || "").toLowerCase() === String(req.user.email).toLowerCase();
    if (!isOwner && !isCreator && !isAssigned) {
      return res.status(403).json({ error: "Only the owner, creator, or assigned member can change this expense." });
    }

    const e = req.body || {};
    const nextRecurring = e.recurring === undefined ? current.recurring : Boolean(e.recurring);
    const nextRecurrence = VALID_RECURRENCE.has(e.recurrence) ? e.recurrence : current.recurrence;
    const nextSplitMode = ["equal", "assigned", "custom"].includes(e.splitMode) ? e.splitMode : current.split_mode;
    const nextPaid = e.paid === undefined ? current.paid : Boolean(e.paid);
    const nextReminderScope = e.reminderScope === undefined
      ? (current.reminder_scope || "assigned")
      : (e.reminderScope === "everyone" ? "everyone" : "assigned");
    const nextIsSubscription = e.isSubscription === undefined
      ? Boolean(current.is_subscription)
      : Boolean(e.isSubscription);

    const nextAmount = number(e.amount ?? current.amount);
    if (!nextPaid && nextSplitMode === "custom" && (e.customSplits !== undefined || e.amount !== undefined || e.splitMode !== undefined)) {
      await validateCustomSplits(access.id, nextAmount, e.customSplits || []);
    }

    const updated = await one(
      `UPDATE household_expenses SET
        name=$1,amount=$2,due_date=$3,category=$4,assigned_to_email=$5,
        notes=$6,recurring=$7,recurrence=$8,split_mode=$9,paid=$10,
        paid_at=CASE WHEN $10=true THEN COALESCE(paid_at,now()) ELSE NULL END,
        paid_by_email=CASE WHEN $10=true THEN $11 ELSE NULL END,
        reminder_scope=$12,is_subscription=$13,updated_at=now()
       WHERE id=$14 AND household_id=$15
       RETURNING *`,
      [
        e.name ?? current.name,
        nextAmount,
        e.dueDate === undefined ? current.due_date : e.dueDate || null,
        e.category ?? current.category,
        e.assignedToEmail === undefined ? current.assigned_to_email : e.assignedToEmail || req.user.email,
        e.notes ?? current.notes,
        nextRecurring,
        nextRecurrence,
        nextSplitMode,
        nextPaid,
        req.user.email,
        nextReminderScope,
        nextIsSubscription,
        current.id,
        access.id,
      ]
    );

    const splitRelevantChanged =
      e.splitMode !== undefined || e.assignedToEmail !== undefined || e.amount !== undefined || e.customSplits !== undefined;
    if (!nextPaid && splitRelevantChanged) {
      await rebuildSplits(updated, nextSplitMode, updated.assigned_to_email, req.user, e.customSplits || []);
    }
    if (nextPaid) {
      await query(
        `UPDATE household_expense_splits
         SET status='paid',paid_at=COALESCE(paid_at,now()),updated_at=now()
         WHERE expense_id=$1`,
        [current.id]
      );
      await rollForwardExpense(updated, req.user);
    }

    await logActivity(
      access.id,
      req.user,
      nextPaid ? "expense_paid" : "expense_updated",
      "expense",
      current.id,
      nextPaid
        ? `${req.user.name} marked ${current.name} paid.`
        : `${req.user.name} updated ${current.name}.`
    );

    res.json({ expense: updated });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/expenses/:expenseId", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this Family household." });

    const current = await one(
      `SELECT * FROM household_expenses
       WHERE id=$1 AND household_id=$2`,
      [req.params.expenseId, access.id]
    );
    if (!current) return res.status(404).json({ error: "Shared expense not found." });
    if (access.my_role !== "owner" && current.created_by_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the owner or creator can delete this expense." });
    }

    await query("DELETE FROM household_expenses WHERE id=$1 AND household_id=$2", [current.id, access.id]);
    await logActivity(access.id, req.user, "expense_deleted", "expense", current.id, `${req.user.name} deleted ${current.name}.`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/splits/:splitId/toggle", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this Family household." });

    const split = await one(
      `SELECT s.*,e.name expense_name,e.recurring,e.recurrence,e.due_date,e.series_id,
              e.created_by_user_id,e.category,e.assigned_to_email,e.notes,e.split_mode,e.amount,e.household_id
       FROM household_expense_splits s
       JOIN household_expenses e ON e.id=s.expense_id
       WHERE s.id=$1 AND s.household_id=$2`,
      [req.params.splitId, access.id]
    );
    if (!split) return res.status(404).json({ error: "Household share not found." });

    const isOwner = access.my_role === "owner";
    const isMine = String(split.member_email).toLowerCase() === String(req.user.email).toLowerCase();
    if (!isOwner && !isMine) {
      return res.status(403).json({ error: "You can only update your own assigned share." });
    }

    const nextStatus = split.status === "paid" ? "unpaid" : "paid";
    await query(
      `UPDATE household_expense_splits
       SET status=$1,paid_at=CASE WHEN $1='paid' THEN now() ELSE NULL END,updated_at=now()
       WHERE id=$2`,
      [nextStatus, split.id]
    );

    const left = await one(
      `SELECT count(*)::int count
       FROM household_expense_splits
       WHERE expense_id=$1 AND status='unpaid'`,
      [split.expense_id]
    );

    if (left.count === 0) {
      const expense = await one(
        `UPDATE household_expenses
         SET paid=true,paid_at=now(),paid_by_email=$1,updated_at=now()
         WHERE id=$2
         RETURNING *`,
        [req.user.email, split.expense_id]
      );
      await rollForwardExpense(expense, req.user);
    } else {
      await query(
        `UPDATE household_expenses
         SET paid=false,paid_at=NULL,paid_by_email=NULL,updated_at=now()
         WHERE id=$1`,
        [split.expense_id]
      );
    }

    await logActivity(
      access.id,
      req.user,
      nextStatus === "paid" ? "share_paid" : "share_reopened",
      "expense",
      split.expense_id,
      `${req.user.name} marked their ${split.expense_name} share ${nextStatus}.`,
      { amount: number(split.amount), memberEmail: split.member_email }
    );

    res.json({ ok: true, status: nextStatus });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/budgets", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access || access.my_role !== "owner") {
      return res.status(403).json({ error: "Only the household owner can set shared budgets." });
    }

    const category = String(req.body?.category || "").trim();
    const amount = number(req.body?.amount);
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || ""))
      ? String(req.body.month)
      : monthKey();

    if (!category || amount < 0) return res.status(400).json({ error: "Category and budget amount are required." });

    const existingBudget = await one(
      `SELECT id FROM household_budgets
       WHERE household_id=$1 AND month_key=$2 AND lower(category)=lower($3)
       LIMIT 1`,
      [access.id, month, category]
    );

    const budget = existingBudget
      ? await one(
          `UPDATE household_budgets
           SET category=$1,amount=$2,updated_at=now()
           WHERE id=$3
           RETURNING *`,
          [category, amount, existingBudget.id]
        )
      : await one(
          `INSERT INTO household_budgets(id,household_id,month_key,category,amount,created_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [newId(), access.id, month, category, amount, req.user.id]
        );

    await logActivity(access.id, req.user, "budget_set", "budget", budget.id, `${req.user.name} set the ${category} shared budget to $${amount.toFixed(2)} for ${month}.`);
    res.json({ budget });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/budgets/:budgetId", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access || access.my_role !== "owner") return res.status(403).json({ error: "Only the household owner can remove budgets." });
    await query("DELETE FROM household_budgets WHERE id=$1 AND household_id=$2", [req.params.budgetId, access.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/goals", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this Family household." });

    const name = String(req.body?.name || "").trim();
    const targetAmount = number(req.body?.targetAmount);
    if (!name || targetAmount <= 0) return res.status(400).json({ error: "Goal name and target amount are required." });

    const goal = await one(
      `INSERT INTO household_goals(
        id,household_id,name,target_amount,current_amount,target_date,category,created_by_user_id
      ) VALUES($1,$2,$3,$4,0,$5,$6,$7)
      RETURNING *`,
      [newId(), access.id, name, targetAmount, req.body?.targetDate || null, req.body?.category || "Family", req.user.id]
    );

    await logActivity(access.id, req.user, "goal_created", "goal", goal.id, `${req.user.name} created the shared goal ${name}.`);
    res.json({ goal });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/goals/:goalId/contribute", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this Family household." });

    const amount = number(req.body?.amount);
    if (amount <= 0) return res.status(400).json({ error: "Contribution must be greater than 0." });

    const goal = await one(
      `UPDATE household_goals
       SET current_amount=current_amount+$1,updated_at=now()
       WHERE id=$2 AND household_id=$3
       RETURNING *`,
      [amount, req.params.goalId, access.id]
    );
    if (!goal) return res.status(404).json({ error: "Shared goal not found." });

    const contribution = await one(
      `INSERT INTO household_goal_contributions(
        id,household_id,goal_id,user_id,member_email,amount,note
      ) VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [newId(), access.id, goal.id, req.user.id, req.user.email, amount, req.body?.note || ""]
    );

    await logActivity(access.id, req.user, "goal_contribution", "goal", goal.id, `${req.user.name} added $${amount.toFixed(2)} to ${goal.name}.`);
    res.json({ goal, contribution });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/goals/:goalId", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access || access.my_role !== "owner") return res.status(403).json({ error: "Only the household owner can delete shared goals." });
    await query("DELETE FROM household_goals WHERE id=$1 AND household_id=$2", [req.params.goalId, access.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/assistant", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access) return res.status(403).json({ error: "You do not have access to this Family household." });

    const data = await householdData(access, req.user);
    const raw = String(req.body?.question || "").trim();
    const q = raw.toLowerCase();
    const s = data.summary;
    let answer;

    const amountMatch = raw.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    const askedAmount = amountMatch ? Number(amountMatch[1]) : null;

    if (/who|owe|share|responsib|waiting/.test(q)) {
      answer = s.responsibility.length
        ? s.responsibility.map(x => `${x.email} has $${x.amount.toFixed(2)} in unpaid household shares.`).join(" ")
        : "Nobody has an unpaid household share right now.";
    } else if (/overdue|late/.test(q)) {
      answer = s.overdueCount
        ? `${s.overdueCount} shared expense${s.overdueCount === 1 ? " is" : "s are"} overdue, totaling $${s.overdue.toFixed(2)}.`
        : "There are no overdue shared expenses right now.";
    } else if (/subscription|recurring cost|recurring bill/.test(q)) {
      answer = data.expenses.some(e => e.is_subscription)
        ? `Known shared subscriptions are about $${s.subscriptionMonthly.toFixed(2)} per month. All recurring shared bills normalize to about $${s.recurringMonthly.toFixed(2)} per month.`
        : `There are no shared items marked as subscriptions yet. All recurring shared bills normalize to about $${s.recurringMonthly.toFixed(2)} per month.`;
    } else if (/payday|before i get paid|before pay/.test(q)) {
      answer = s.nextPayday
        ? `Your private BillWise income schedule shows your next entered payday as ${s.nextPayday}. The household has $${Number(s.householdDueBeforeNextPayday || 0).toFixed(2)} in open shared expenses due by then; your assigned portion is $${Number(s.dueBeforeNextPayday || 0).toFixed(2)}.`
        : "You do not have a future payday entered in your personal BillWise income schedule, so I cannot calculate your assigned household obligations before payday.";
    } else if (/afford|spend|buy|extra/.test(q) && askedAmount != null) {
      answer = `I cannot promise that $${askedAmount.toFixed(2)} is safe to spend from household data alone. Your open assigned household shares total $${s.myOpenShares.toFixed(2)}${s.nextPayday ? `, with $${Number(s.dueBeforeNextPayday || 0).toFixed(2)} due by your next entered payday on ${s.nextPayday}` : ""}. Check your personal dashboard and connected balances before treating the rest as spendable.`;
    } else if (/budget|limit|category/.test(q)) {
      const over = data.budgets.filter(b => b.over);
      answer = over.length
        ? `These shared budgets are over their planned limit: ${over.map(b => `${b.category} by $${Math.abs(b.remaining).toFixed(2)}`).join(", ")}.`
        : data.budgets.length
          ? "None of the shared category budgets are currently over their planned limit."
          : "No shared category budgets have been set for this month yet.";
    } else if (/goal|saving|fund/.test(q)) {
      answer = data.goals.length
        ? data.goals.map(g => `${g.name}: $${number(g.current_amount).toFixed(2)} of $${number(g.target_amount).toFixed(2)}.`).join(" ")
        : "There are no shared savings goals yet.";
    } else if (/next|due|week|friday|today|tomorrow/.test(q)) {
      answer = `${s.dueNext7Count} shared expense${s.dueNext7Count === 1 ? " is" : "s are"} due in the next 7 days, totaling $${s.dueNext7.toFixed(2)}. ${s.overdueCount ? `${s.overdueCount} additional item${s.overdueCount === 1 ? " is" : "s are"} already overdue.` : "Nothing is currently overdue."}`;
    } else {
      answer = `The household has $${s.unpaidShared.toFixed(2)} in unpaid shared expenses, $${s.dueNext7.toFixed(2)} due in the next 7 days, $${s.recurringMonthly.toFixed(2)} in normalized recurring monthly costs, and ${s.overBudgetCount} shared budget categor${s.overBudgetCount === 1 ? "y" : "ies"} over plan.`;
    }

    res.json({
      answer,
      disclaimer: "Household planning summary only. BillWise does not expose another member's private bills or bank transactions and does not guarantee that money is safe to spend.",
    });
  } catch (e) {
    next(e);
  }
});

router.put("/:id/settings", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access || access.my_role !== "owner") {
      return res.status(403).json({ error: "Only the household owner can change household reminder settings." });
    }

    const weekday = Math.min(6, Math.max(0, Number(req.body?.digestWeekday ?? 0)));
    const hour = Math.min(23, Math.max(0, Number(req.body?.digestHour ?? 8)));
    const settings = await one(
      `INSERT INTO household_settings(
        household_id,weekly_digest_enabled,digest_weekday,digest_hour,remind_everyone_default
      ) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(household_id) DO UPDATE SET
        weekly_digest_enabled=excluded.weekly_digest_enabled,
        digest_weekday=excluded.digest_weekday,
        digest_hour=excluded.digest_hour,
        remind_everyone_default=excluded.remind_everyone_default,
        updated_at=now()
      RETURNING *`,
      [
        access.id,
        req.body?.weeklyDigestEnabled !== false,
        weekday,
        hour,
        Boolean(req.body?.remindEveryoneDefault),
      ]
    );

    await logActivity(
      access.id,
      req.user,
      "household_settings_updated",
      "household",
      access.id,
      `${req.user.name} updated household reminder settings.`
    );

    res.json({ settings });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/digest", async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user);
    if (!access || access.my_role !== "owner") return res.status(403).json({ error: "Only the household owner can send a household digest." });
    if (!emailConfigured()) return res.status(503).json({ error: "SMTP is not configured yet." });

    const data = await householdData(access, req.user);
    const cutoff = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = data.expenses.filter(e => !e.paid && dateOnly(e.due_date) && dateOnly(e.due_date) >= today && dateOnly(e.due_date) <= cutoff);

    const users = await query(
      `SELECT DISTINCT u.id,u.name,u.email,u.email_reminders
       FROM household_members hm
       JOIN users u ON u.id=hm.user_id
       WHERE hm.household_id=$1 AND hm.status='active'`,
      [access.id]
    );

    let sent = 0;
    for (const member of users.rows) {
      if (!member.email_reminders) continue;
      const mySplits = data.splits.filter(s => String(s.member_email).toLowerCase() === String(member.email).toLowerCase() && s.status === "unpaid");
      const myExpenseIds = new Set(mySplits.map(s => s.expense_id));
      const assigned = upcoming.filter(e =>
        String(e.assigned_to_email || "").toLowerCase() === String(member.email).toLowerCase() || myExpenseIds.has(e.id)
      );
      await sendHouseholdDigestEmail({
        to: member.email,
        userName: member.name || member.email,
        householdName: access.name,
        upcoming: assigned,
        unpaidAssigned: mySplits.reduce((s, x) => s + number(x.amount), 0),
      });
      sent++;
    }

    await logActivity(access.id, req.user, "digest_sent", "household", access.id, `${req.user.name} sent the household digest to ${sent} member${sent === 1 ? "" : "s"}.`);
    res.json({ ok: true, sent });
  } catch (e) {
    next(e);
  }
});

export default router;
