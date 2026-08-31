import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { one } from "./db.js";

const secret = process.env.JWT_SECRET || "development-only-secret";
const expiresIn = process.env.JWT_EXPIRES_IN || "7d";

export function newId() {
  return crypto.randomUUID();
}

export function signUser(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, plan: user.plan },
    secret,
    { expiresIn }
  );
}

export function signShort(payload, expires = "10m") {
  return jwt.sign(payload, secret, { expiresIn: expires });
}

export function verifyShort(token) {
  return jwt.verify(token, secret);
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!raw) {
    return res.status(401).json({ error: "Authentication required." });
  }

  let claims;
  try {
    claims = jwt.verify(raw, secret);
  } catch {
    return res.status(401).json({ error: "Session expired or invalid." });
  }

  try {
    const user = await one(
      `SELECT id,name,email,plan,reminder_days,email_reminders,created_at
       FROM users
       WHERE id=$1`,
      [claims.sub]
    );

    if (!user) {
      return res.status(401).json({ error: "User no longer exists." });
    }

    req.user = user;
    next();
  } catch (error) {
    // Database/network problems are server problems, not authentication failures.
    next(error);
  }
}

export function requirePlan(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.plan)) {
      return res.status(403).json({
        error: `This feature requires ${allowed.join(" or ")}.`,
        requiredPlans: allowed,
      });
    }

    next();
  };
}
