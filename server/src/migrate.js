import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./lib/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(here, "../sql");

try {
  const files = (await fs.readdir(sqlDir)).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(sqlDir, file), "utf8");
    console.log(`Running ${file}...`);
    await pool.query(sql);
  }
  console.log("Database migrations complete.");
} finally {
  await pool.end();
}
