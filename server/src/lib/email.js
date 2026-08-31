import nodemailer from "nodemailer";

function transporter() {
  if (!process.env.SMTP_HOST) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
}

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

export async function verifyEmailConnection() {
  const t = transporter();
  if (!t) return { configured: false, reachable: false };
  try {
    await t.verify();
    return { configured: true, reachable: true };
  } catch (error) {
    return { configured: true, reachable: false, error: error.message };
  }
}

async function send({ to, subject, text, html }) {
  const t = transporter();
  if (!t) throw new Error("SMTP is not configured.");

  return t.sendMail({
    from: process.env.EMAIL_FROM || "BillWise AI <reminders@example.com>",
    to,
    subject,
    text,
    html,
  });
}

export async function sendReminderEmail({
  to,
  userName,
  billName,
  amount,
  dueDate,
  days
}) {
  const when = days === 0
    ? "today"
    : days > 0
      ? `in ${days} day${days === 1 ? "" : "s"}`
      : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;

  await send({
    to,
    subject: `${billName} is due ${when}`,
    text: [
      `Hi ${userName},`,
      "",
      `${billName} ($${Number(amount).toFixed(2)}) is due ${when}.`,
      `Due date: ${dueDate}`,
      "",
      "Open BillWise AI to review your upcoming bills.",
    ].join("\n"),
    html: `
      <p>Hi ${escapeHtml(userName)},</p>
      <p><strong>${escapeHtml(billName)}</strong>
      ($${Number(amount).toFixed(2)}) is due <strong>${when}</strong>.</p>
      <p>Due date: ${escapeHtml(String(dueDate))}</p>
      <p>Open BillWise AI to review your upcoming bills.</p>
    `,
  });
}

export async function sendTestEmail({ to, userName }) {
  await send({
    to,
    subject: "BillWise AI reminders are connected",
    text: `Hi ${userName}, your BillWise AI email reminders are configured correctly.`,
    html: `
      <p>Hi ${escapeHtml(userName)},</p>
      <p>Your <strong>BillWise AI</strong> email reminders are configured correctly.</p>
    `,
  });
}

export async function sendHouseholdInviteEmail({
  to,
  inviterName,
  householdName
}) {
  const appUrl = process.env.APP_URL || "http://localhost:5173";

  await send({
    to,
    subject: `${inviterName} invited you to ${householdName} on BillWise AI`,
    text: [
      `${inviterName} invited you to the BillWise AI household "${householdName}".`,
      "",
      `Sign in with this email at ${appUrl} and open Household to accept the invite.`,
    ].join("\n"),
    html: `
      <p><strong>${escapeHtml(inviterName)}</strong> invited you to the
      BillWise AI household <strong>${escapeHtml(householdName)}</strong>.</p>
      <p>Sign in with this email and open <strong>Household</strong> to accept it.</p>
      <p><a href="${escapeHtml(appUrl)}">Open BillWise AI</a></p>
    `,
  });
}


export async function sendHouseholdExpenseReminderEmail({
  to,
  userName,
  householdName,
  expenseName,
  amount,
  dueDate,
  days,
}) {
  const when = days === 0
    ? "today"
    : days > 0
      ? `in ${days} day${days === 1 ? "" : "s"}`
      : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  await send({
    to,
    subject: `${expenseName} is due ${when} · ${householdName}`,
    text: [
      `Hi ${userName},`,
      "",
      `Your household item ${expenseName} ($${Number(amount).toFixed(2)}) is due ${when}.`,
      `Due date: ${dueDate}`,
      `Household: ${householdName}`,
      "",
      "Open BillWise AI > Household to review your assigned share.",
    ].join("\n"),
    html: `
      <p>Hi ${escapeHtml(userName)},</p>
      <p>Your household item <strong>${escapeHtml(expenseName)}</strong>
      ($${Number(amount).toFixed(2)}) is due <strong>${when}</strong>.</p>
      <p>Due date: ${escapeHtml(String(dueDate))}<br/>
      Household: ${escapeHtml(householdName)}</p>
      <p>Open BillWise AI → Household to review your assigned share.</p>
    `,
  });
}

export async function sendHouseholdDigestEmail({
  to,
  userName,
  householdName,
  upcoming = [],
  unpaidAssigned = 0,
}) {
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  const lines = upcoming.length
    ? upcoming.map(e => `- ${e.name}: $${Number(e.amount).toFixed(2)} due ${String(e.due_date).slice(0,10)}`)
    : ["- No assigned shared expenses due in the next 7 days."];
  const htmlRows = upcoming.length
    ? upcoming.map(e => `<li>${escapeHtml(e.name)} — $${Number(e.amount).toFixed(2)} — due ${escapeHtml(String(e.due_date).slice(0,10))}</li>`).join("")
    : "<li>No assigned shared expenses due in the next 7 days.</li>";

  await send({
    to,
    subject: `${householdName} · BillWise weekly household digest`,
    text: [
      `Hi ${userName},`,
      "",
      `Household: ${householdName}`,
      `Your unpaid assigned shares: $${Number(unpaidAssigned).toFixed(2)}`,
      "",
      "Next 7 days:",
      ...lines,
      "",
      `Open BillWise AI: ${appUrl}`,
    ].join("\n"),
    html: `
      <p>Hi ${escapeHtml(userName)},</p>
      <h3>${escapeHtml(householdName)}</h3>
      <p>Your unpaid assigned shares: <strong>$${Number(unpaidAssigned).toFixed(2)}</strong></p>
      <p><strong>Next 7 days</strong></p>
      <ul>${htmlRows}</ul>
      <p><a href="${escapeHtml(appUrl)}">Open BillWise AI</a></p>
    `,
  });
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[c]));
}
