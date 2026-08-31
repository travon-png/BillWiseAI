import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool } from "./lib/db.js";

const file = process.argv[2] || path.resolve("./data.json");

if (!fs.existsSync(file)) {
  console.log(`No legacy JSON database found at ${file}. Nothing to import.`);
  await pool.end();
  process.exit(0);
}

const legacy = JSON.parse(fs.readFileSync(file, "utf8"));
const idMap = new Map();

function uuid() { return crypto.randomUUID(); }
function isoDate(v) {
  if (!v) return new Date().toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  for (const u of legacy.users || []) {
    const existing = await client.query("SELECT id FROM users WHERE email=$1", [String(u.email).toLowerCase()]);
    let newId;
    if (existing.rows[0]) {
      newId = existing.rows[0].id;
    } else {
      newId = uuid();
      await client.query(
        `INSERT INTO users(id,name,email,password_hash,plan,created_at)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          newId,
          u.name || "User",
          String(u.email || "").toLowerCase(),
          u.passwordHash || u.password_hash,
          ["free","plus","pro","family"].includes(u.plan) ? u.plan : "free",
          u.createdAt || new Date().toISOString(),
        ]
      );
    }
    idMap.set(u.id, newId);
  }

  for (const b of legacy.bills || []) {
    const userId = idMap.get(b.userId);
    if (!userId) continue;
    const duplicate = await client.query(
      `SELECT id FROM bills WHERE user_id=$1 AND name=$2 AND amount=$3 AND due_date=$4 LIMIT 1`,
      [userId, b.name, Number(b.amount || 0), isoDate(b.dueDate)]
    );
    if (duplicate.rows[0]) continue;
    await client.query(
      `INSERT INTO bills(
        id,user_id,name,amount,previous_amount,due_date,category,recurring,recurrence,
        autopay,is_subscription,paid,notes,source,created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',$14)`,
      [
        uuid(), userId, b.name || "Bill", Number(b.amount || 0),
        b.previousAmount == null ? null : Number(b.previousAmount), isoDate(b.dueDate),
        b.category || "Other", b.recurring !== false, b.recurrence || "monthly",
        Boolean(b.autopay), Boolean(b.isSubscription), Boolean(b.paid), b.notes || "",
        b.createdAt || new Date().toISOString(),
      ]
    );
  }

  for (const i of legacy.incomes || []) {
    const userId = idMap.get(i.userId);
    if (!userId) continue;
    const duplicate = await client.query(
      `SELECT id FROM incomes WHERE user_id=$1 AND name=$2 AND amount=$3 AND payday=$4 LIMIT 1`,
      [userId, i.name, Number(i.amount || 0), isoDate(i.payday)]
    );
    if (duplicate.rows[0]) continue;
    await client.query(
      `INSERT INTO incomes(id,user_id,name,amount,payday,recurrence)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [uuid(), userId, i.name || "Income", Number(i.amount || 0), isoDate(i.payday), i.recurrence || "biweekly"]
    );
  }

  await client.query("COMMIT");
  console.log(`Imported legacy BillWise data from ${file}.`);
  console.log(`Users mapped: ${idMap.size}`);
  console.log("Existing password hashes were preserved, so users can sign in with their current passwords.");
  console.log("Existing browser JWTs will not survive the database-ID migration; sign in again once after upgrading.");
} catch (e) {
  await client.query("ROLLBACK");
  console.error(e);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
