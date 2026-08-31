import express from "express";
import bcrypt from "bcryptjs";
import { newId, signUser, requireAuth } from "../lib/auth.js";
import { one, query } from "../lib/db.js";

const router = express.Router();

function publicUser(u) {
  return {
    id:u.id, name:u.name, email:u.email, plan:u.plan,
    reminderDays:u.reminder_days || [7,3,1,0],
    emailReminders:Boolean(u.email_reminders),
    createdAt:u.created_at,
  };
}

router.post("/register", async (req,res,next) => {
  try {
    const { name,email,password } = req.body || {};
    if (!name || !email || !password)
      return res.status(400).json({error:"Name, email and password are required."});
    if (String(password).length < 10)
      return res.status(400).json({error:"Password must be at least 10 characters."});

    const normalized = String(email).trim().toLowerCase();
    if (await one("SELECT id FROM users WHERE email=$1",[normalized]))
      return res.status(409).json({error:"An account already exists with this email."});

    const id = newId();
    const hash = await bcrypt.hash(String(password),12);
    const result = await query(
      `INSERT INTO users(id,name,email,password_hash)
       VALUES($1,$2,$3,$4)
       RETURNING id,name,email,plan,reminder_days,email_reminders,created_at`,
      [id,String(name).trim(),normalized,hash]
    );
    const user = result.rows[0];
    res.json({token:signUser(user),user:publicUser(user)});
  } catch(e) { next(e); }
});

router.post("/login", async (req,res,next) => {
  try {
    const email = String(req.body?.email||"").trim().toLowerCase();
    const row = await one("SELECT * FROM users WHERE email=$1",[email]);
    if (!row || !(await bcrypt.compare(String(req.body?.password||""),row.password_hash)))
      return res.status(401).json({error:"Invalid email or password."});
    res.json({token:signUser(row),user:publicUser(row)});
  } catch(e){ next(e); }
});

router.get("/me", requireAuth, (req,res) => res.json({user:publicUser(req.user)}));

router.put("/preferences", requireAuth, async (req,res,next) => {
  try {
    const reminderDays = Array.isArray(req.body?.reminderDays)
      ? [...new Set(req.body.reminderDays.map(Number).filter(x=>Number.isInteger(x)&&x>=0&&x<=30))].sort((a,b)=>b-a)
      : req.user.reminder_days;
    const emailReminders = req.body?.emailReminders == null
      ? req.user.email_reminders
      : Boolean(req.body.emailReminders);

    const row = await one(
      `UPDATE users
       SET reminder_days=$1::jsonb,email_reminders=$2,updated_at=now()
       WHERE id=$3
       RETURNING id,name,email,plan,reminder_days,email_reminders,created_at`,
      [JSON.stringify(reminderDays),emailReminders,req.user.id]
    );
    res.json({token:signUser(row),user:publicUser(row)});
  } catch(e){ next(e); }
});

export default router;
