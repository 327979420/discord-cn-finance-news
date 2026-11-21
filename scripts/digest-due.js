// Prints due=true|false for GitHub Actions, so a run that only checks for
// emergencies skips installing Claude Code. Mirrors decideDigest() in src/index.js.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { digestDue } from "../src/services/digest-schedule.js";

const sources = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH || "config/sources.json", "utf8"));
const digest = sources.digest;
let due = false;
if (process.env.FORCE_DIGEST === "true") due = Boolean(digest?.enabled);
else if (digest?.enabled && Array.isArray(digest.slots) && digest.slots.length) {
  let last;
  const dbPath = process.env.DATABASE_PATH || "data/news.db";
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      last = db.prepare("SELECT value FROM runtime_state WHERE key = 'last_digest_slot'").get()?.value;
    } catch {
      last = undefined;
    } finally {
      db.close();
    }
  }
  due = digestDue({ timezone: "Asia/Shanghai", maxLateMinutes: 150, ...digest }, last).due;
}
console.log(`due=${due}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `due=${due}\n`);
