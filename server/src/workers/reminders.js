import cron from "node-cron";
import { query } from "../lib/db.js";
import { newId } from "../lib/auth.js";
import { PLANS } from "../lib/plans.js";
import {
  sendReminderEmail,
  sendHouseholdExpenseReminderEmail,
  sendHouseholdDigestEmail,
  emailConfigured,
} from "../lib/email.js";

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function dayDiff(dueValue, today) {
  const due = new Date(`${dateOnly(dueValue)}T00:00:00`);
  return Math.round((due - today) / 86400000);
}

function shouldSendReminder(diff, configuredDays = [7, 3, 1, 0]) {
  if (diff >= 0) return configuredDays.includes(diff);
  return [1, 3, 7].includes(Math.abs(diff));
}

function whenText(diff) {
  if (diff === 0) return "today";
  if (diff > 0) return `in ${diff} day${diff === 1 ? "" : "s"}`;
  const n = Math.abs(diff);
  return `${n} day${n === 1 ? "" : "s"} overdue`;
}

async function reserveDelivery({ userId, billId, key, channel }) {
  try {
    await query(
      `INSERT INTO reminder_deliveries(id,user_id,bill_id,reminder_key,channel,status)
       VALUES($1,$2,$3,$4,$5,'reserved')`,
      [newId(), userId, billId, key, channel]
    );
    return true;
  } catch (e) {
    if (e?.code === "23505") return false;
    throw e;
  }
}

async function markDelivery({ userId, billId, key, channel, status, error = null }) {
  await query(
    `UPDATE reminder_deliveries SET status=$1,error=$2
     WHERE user_id=$3 AND bill_id=$4 AND reminder_key=$5 AND channel=$6`,
    [status, error, userId, billId, key, channel]
  );
}

async function reserveHouseholdDelivery({ householdId, expenseId, userId, key, channel }) {
  try {
    await query(
      `INSERT INTO household_reminder_deliveries(
        id,household_id,expense_id,user_id,reminder_key,channel,status
      ) VALUES($1,$2,$3,$4,$5,$6,'reserved')`,
      [newId(), householdId, expenseId, userId, key, channel]
    );
    return true;
  } catch (e) {
    if (e?.code === "23505") return false;
    if (e?.code === "42P01") return false;
    throw e;
  }
}

async function markHouseholdDelivery({ expenseId, userId, key, channel, status, error = null }) {
  await query(
    `UPDATE household_reminder_deliveries SET status=$1,error=$2
     WHERE expense_id=$3 AND user_id=$4 AND reminder_key=$5 AND channel=$6`,
    [status, error, expenseId, userId, key, channel]
  );
}

async function runPersonalReminders(today) {
  const users = (await query(
    `SELECT id,name,email,plan,reminder_days,email_reminders FROM users`
  )).rows;

  let notifications = 0, emails = 0;

  for (const user of users) {
    const days = Array.isArray(user.reminder_days) ? user.reminder_days : [7, 3, 1, 0];
    const bills = (await query(
      `SELECT * FROM bills
       WHERE user_id=$1 AND paid=false
         AND due_date BETWEEN current_date - interval '8 days'
                          AND current_date + interval '31 days'`,
      [user.id]
    )).rows;

    for (const bill of bills) {
      const diff = dayDiff(bill.due_date, today);
      if (!shouldSendReminder(diff, days)) continue;

      const key = `${dateOnly(bill.due_date)}:${diff}`;
      const when = whenText(diff);
      const message = `${bill.name} ($${Number(bill.amount).toFixed(2)}) is ${when}.`;

      if (await reserveDelivery({ userId: user.id, billId: bill.id, key, channel: "in-app" })) {
        await query(
          `INSERT INTO notifications(id,user_id,type,title,message,severity)
           VALUES($1,$2,'bill-reminder',$3,$4,$5)`,
          [newId(), user.id, `${bill.name} · ${when}`, message, diff <= 1 ? "high" : "info"]
        );
        await markDelivery({ userId: user.id, billId: bill.id, key, channel: "in-app", status: "sent" });
        notifications++;
      }

      const emailAllowed = user.email_reminders && PLANS[user.plan]?.emailReminders && emailConfigured();
      if (emailAllowed && await reserveDelivery({ userId: user.id, billId: bill.id, key, channel: "email" })) {
        try {
          await sendReminderEmail({
            to: user.email,
            userName: user.name,
            billName: bill.name,
            amount: bill.amount,
            dueDate: dateOnly(bill.due_date),
            days: diff,
          });
          await markDelivery({ userId: user.id, billId: bill.id, key, channel: "email", status: "sent" });
          emails++;
        } catch (e) {
          await markDelivery({ userId: user.id, billId: bill.id, key, channel: "email", status: "failed", error: String(e.message || e) });
        }
      }
    }
  }

  return { notifications, emails };
}

async function runHouseholdReminders(today) {
  let notifications = 0, emails = 0;

  let expenses;
  try {
    expenses = (await query(
      `SELECT e.*,h.name household_name
       FROM household_expenses e
       JOIN households h ON h.id=e.household_id
       JOIN users owner ON owner.id=h.owner_user_id
       WHERE owner.plan='family'
         AND e.paid=false
         AND e.due_date BETWEEN current_date - interval '8 days'
                            AND current_date + interval '7 days'
       ORDER BY e.due_date`
    )).rows;
  } catch (e) {
    if (e?.code === "42P01" || e?.code === "42703") return { notifications, emails };
    throw e;
  }

  for (const expense of expenses) {
    const diff = dayDiff(expense.due_date, today);
    const splits = (await query(
      `SELECT member_email,amount,status
       FROM household_expense_splits
       WHERE expense_id=$1 AND status='unpaid'`,
      [expense.id]
    )).rows;

    let targets = splits.map(s => ({ email: s.member_email, amount: Number(s.amount), assigned: true }));

    if (expense.reminder_scope === "everyone") {
      const active = (await query(
        `SELECT u.id,u.name,u.email,u.reminder_days,u.email_reminders
         FROM household_members hm
         JOIN users u ON u.id=hm.user_id
         WHERE hm.household_id=$1 AND hm.status='active'`,
        [expense.household_id]
      )).rows;
      const splitByEmail = new Map(splits.map(s => [String(s.member_email).toLowerCase(), Number(s.amount)]));
      targets = active.map(u => ({
        ...u,
        amount: splitByEmail.get(String(u.email).toLowerCase()) ?? Number(expense.amount),
        assigned: splitByEmail.has(String(u.email).toLowerCase()),
      }));
    }

    const seen = new Set();
    for (const target of targets) {
      if (!target.email) continue;
      const emailKey = String(target.email).toLowerCase();
      if (seen.has(emailKey)) continue;
      seen.add(emailKey);

      const user = target.id ? target : (await query(
        `SELECT id,name,email,reminder_days,email_reminders
         FROM users WHERE lower(email)=lower($1) LIMIT 1`,
        [target.email]
      )).rows[0];
      if (!user) continue;

      const days = Array.isArray(user.reminder_days) ? user.reminder_days : [7, 3, 1, 0];
      if (!shouldSendReminder(diff, days)) continue;

      const key = `${dateOnly(expense.due_date)}:${diff}:${emailKey}`;
      const when = whenText(diff);
      const scope = target.assigned ? `Your share is $${Number(target.amount).toFixed(2)}.` : `The household total is $${Number(expense.amount).toFixed(2)}.`;
      const message = `${expense.name} in ${expense.household_name} is ${when}. ${scope}`;

      if (await reserveHouseholdDelivery({ householdId: expense.household_id, expenseId: expense.id, userId: user.id, key, channel: "in-app" })) {
        await query(
          `INSERT INTO notifications(id,user_id,type,title,message,severity)
           VALUES($1,$2,'household-reminder',$3,$4,$5)`,
          [newId(), user.id, `${expense.name} · ${expense.household_name}`, message, diff <= 1 ? "high" : "info"]
        );
        await markHouseholdDelivery({ expenseId: expense.id, userId: user.id, key, channel: "in-app", status: "sent" });
        notifications++;
      }

      if (user.email_reminders && emailConfigured() && await reserveHouseholdDelivery({ householdId: expense.household_id, expenseId: expense.id, userId: user.id, key, channel: "email" })) {
        try {
          await sendHouseholdExpenseReminderEmail({
            to: user.email,
            userName: user.name,
            householdName: expense.household_name,
            expenseName: expense.name,
            amount: target.amount,
            dueDate: dateOnly(expense.due_date),
            days: diff,
          });
          await markHouseholdDelivery({ expenseId: expense.id, userId: user.id, key, channel: "email", status: "sent" });
          emails++;
        } catch (e) {
          await markHouseholdDelivery({ expenseId: expense.id, userId: user.id, key, channel: "email", status: "failed", error: String(e.message || e) });
        }
      }
    }
  }

  return { notifications, emails };
}

function weekKey(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

async function reserveDigest(householdId, memberEmail, key) {
  try {
    await query(
      `INSERT INTO household_digest_deliveries(id,household_id,member_email,week_key,status)
       VALUES($1,$2,$3,$4,'reserved')`,
      [newId(), householdId, memberEmail, key]
    );
    return true;
  } catch (e) {
    if (e?.code === "23505" || e?.code === "42P01") return false;
    throw e;
  }
}

async function markDigest(householdId, memberEmail, key, status, error = null) {
  await query(
    `UPDATE household_digest_deliveries SET status=$1,error=$2
     WHERE household_id=$3 AND lower(member_email)=lower($4) AND week_key=$5`,
    [status, error, householdId, memberEmail, key]
  );
}

async function runAutomaticHouseholdDigests(now) {
  if (!emailConfigured()) return { emails: 0 };

  let settings;
  try {
    settings = (await query(
      `SELECT hs.*,h.name household_name
       FROM household_settings hs
       JOIN households h ON h.id=hs.household_id
       JOIN users owner ON owner.id=h.owner_user_id
       WHERE hs.weekly_digest_enabled=true
         AND owner.plan='family'
         AND hs.digest_weekday=$1
         AND hs.digest_hour=$2`,
      [now.getDay(), now.getHours()]
    )).rows;
  } catch (e) {
    if (e?.code === "42P01") return { emails: 0 };
    throw e;
  }

  const key = weekKey(now);
  let emails = 0;
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  for (const setting of settings) {
    const [members, expenses, splits] = await Promise.all([
      query(
        `SELECT u.id,u.name,u.email,u.email_reminders
         FROM household_members hm
         JOIN users u ON u.id=hm.user_id
         WHERE hm.household_id=$1 AND hm.status='active'`,
        [setting.household_id]
      ),
      query(
        `SELECT * FROM household_expenses
         WHERE household_id=$1 AND paid=false
           AND due_date BETWEEN $2 AND $3
         ORDER BY due_date`,
        [setting.household_id, today, cutoff]
      ),
      query(
        `SELECT * FROM household_expense_splits
         WHERE household_id=$1 AND status='unpaid'`,
        [setting.household_id]
      ),
    ]);

    for (const member of members.rows) {
      if (!member.email_reminders) continue;
      if (!(await reserveDigest(setting.household_id, member.email, key))) continue;

      try {
        const mySplits = splits.rows.filter(s => String(s.member_email).toLowerCase() === String(member.email).toLowerCase());
        const myIds = new Set(mySplits.map(s => s.expense_id));
        const upcoming = expenses.rows.filter(e => e.reminder_scope === "everyone" || myIds.has(e.id));
        const unpaidAssigned = mySplits.reduce((sum, s) => sum + Number(s.amount || 0), 0);

        await sendHouseholdDigestEmail({
          to: member.email,
          userName: member.name || member.email,
          householdName: setting.household_name,
          upcoming,
          unpaidAssigned,
        });
        await markDigest(setting.household_id, member.email, key, "sent");
        emails++;
      } catch (e) {
        await markDigest(setting.household_id, member.email, key, "failed", String(e.message || e));
      }
    }
  }

  return { emails };
}

export async function runReminders() {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const personal = await runPersonalReminders(today);
  const family = await runHouseholdReminders(today);
  const digest = await runAutomaticHouseholdDigests(now);

  console.log(
    `[reminders] personal_notifications=${personal.notifications} personal_emails=${personal.emails} ` +
    `family_notifications=${family.notifications} family_emails=${family.emails} digest_emails=${digest.emails}`
  );

  return { personal, family, digest };
}

export function startReminderWorker() {
  const schedule = process.env.REMINDER_CRON || "0 * * * *";
  cron.schedule(schedule, () => runReminders().catch(e => console.error("[reminders]", e)));
  console.log(`[reminders] worker scheduled: ${schedule}`);
}
