import { runReminders } from "./workers/reminders.js";
import { pool } from "./lib/db.js";

try {
  const result=await runReminders();
  console.log(result);
} finally {
  await pool.end();
}
