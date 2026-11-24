import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newsTextSimilarity } from "../utils/text.js";

export class NewsStore {
  constructor(databasePath) {
    if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS processed_items (
        item_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        processed_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sent_messages (
        content_hash TEXT PRIMARY KEY,
        message_hash TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        published_at TEXT NOT NULL,
        sent_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS delivery_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        sent_since_image INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      INSERT OR IGNORE INTO delivery_state (singleton, sent_since_image) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS news_pool (
        item_id TEXT PRIMARY KEY,
        published_at TEXT NOT NULL,
        item_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS runtime_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
  }

  isProcessed(itemId) {
    return Boolean(this.database.prepare("SELECT 1 AS found FROM processed_items WHERE item_id = ? LIMIT 1").get(itemId));
  }

  lastSuccessfulCycleAt() {
    return this.database.prepare("SELECT value FROM runtime_state WHERE key = 'last_successful_cycle_at'").get()?.value;
  }

  recordSuccessfulCycle(at) {
    this.database.prepare("INSERT OR REPLACE INTO runtime_state (key, value) VALUES ('last_successful_cycle_at', ?)").run(at);
  }

  breakingSentToday(now = new Date()) {
    return Number(this.getState(`breaking_sent:${beijingDay(now)}`) || 0);
  }

  countBreakingSent(now = new Date()) {
    this.setState(`breaking_sent:${beijingDay(now)}`, this.breakingSentToday(now) + 1);
  }

  // Sources only list their latest items (Yahoo about three hours' worth), so
  // runs between cards keep what they saw here for the next card to use.
  addToPool(items) {
    const insert = this.database.prepare("INSERT OR IGNORE INTO news_pool (item_id, published_at, item_json) VALUES (?, ?, ?)");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const item of items) insert.run(item.id, item.publishedAt, JSON.stringify(item));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  poolSince(sinceIso) {
    return this.database.prepare("SELECT item_json FROM news_pool WHERE published_at >= ? ORDER BY published_at").all(sinceIso)
      .map((row) => JSON.parse(row.item_json));
  }

  getState(key) {
    return this.database.prepare("SELECT value FROM runtime_state WHERE key = ?").get(key)?.value;
  }

  setState(key, value) {
    this.database.prepare("INSERT OR REPLACE INTO runtime_state (key, value) VALUES (?, ?)").run(key, String(value));
  }

  pendingNewsAt() {
    return this.database.prepare("SELECT value FROM runtime_state WHERE key = 'pending_news_at'").get()?.value;
  }

  recordPendingNews(at) {
    if (at) this.database.prepare("INSERT OR REPLACE INTO runtime_state (key, value) VALUES ('pending_news_at', ?)").run(at);
    else this.database.prepare("DELETE FROM runtime_state WHERE key = 'pending_news_at'").run();
  }

  // Re-evaluate previously rejected items after scoring rules change, within the freshness window.
  isFinalized(itemId) {
    const row = this.database.prepare("SELECT status FROM processed_items WHERE item_id = ?").get(itemId);
    return Boolean(row && !row.status.startsWith("filtered:") && row.status !== "dry-run");
  }

  hasContentHash(contentHash) {
    return Boolean(this.database.prepare("SELECT 1 AS found FROM sent_messages WHERE content_hash = ? LIMIT 1").get(contentHash));
  }

  hasMessageHash(messageHash) {
    return Boolean(this.database.prepare("SELECT 1 AS found FROM sent_messages WHERE message_hash = ? LIMIT 1").get(messageHash));
  }

  findSimilarSent(title, options = {}) {
    const cutoff = new Date(Date.now() - (options.hours ?? 36) * 3600000).toISOString();
    const rows = this.database.prepare("SELECT title FROM sent_messages WHERE sent_at >= ? ORDER BY sent_at DESC LIMIT 300").all(cutoff);
    return rows.find((row) => (!options.preserveNumbers || numberSignature(title) === numberSignature(row.title))
      && newsTextSimilarity(title, row.title) >= (options.threshold ?? 0.72));
  }

  shouldAttachImage(item, options = {}) {
    if (!isUsableImageUrl(item.imageUrl)) return false;
    if ((item.importanceScore || 0) < (options.minScore ?? 82)) return false;
    if (item.sourceKind === "market" || item.sourceKind === "polymarket_move") return false;
    return this.sentSinceImage() >= Math.max(0, (options.interval ?? 10) - 1);
  }

  markProcessed(item, status) {
    this.database.prepare(`INSERT OR REPLACE INTO processed_items (item_id, source, status, processed_at) VALUES (?, ?, ?, ?)`)
      .run(item.id, item.source, status, new Date().toISOString());
  }

  recordSent(item, contentHash, messageHash) {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO sent_messages (content_hash, message_hash, source, title, url, published_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(contentHash, messageHash, item.source, item.title, item.url || null, item.publishedAt, now);
      this.database.prepare(`INSERT OR REPLACE INTO processed_items (item_id, source, status, processed_at) VALUES (?, ?, 'sent', ?)`)
        .run(item.id, item.source, now);
      this.database.prepare("UPDATE delivery_state SET sent_since_image = ? WHERE singleton = 1")
        .run(item.imageUrl ? 0 : this.sentSinceImage() + 1);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  // Items a digest card used count as sent (so later cards and breaking posts skip
  // them); the rest of the window's candidates are closed as digest-omitted.
  recordDigest(usedItems, omittedItems, slotKey, contentHashFor) {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const sent = this.database.prepare(`INSERT OR IGNORE INTO sent_messages (content_hash, message_hash, source, title, url, published_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const processed = this.database.prepare(`INSERT OR REPLACE INTO processed_items (item_id, source, status, processed_at) VALUES (?, ?, ?, ?)`);
      for (const item of usedItems) {
        sent.run(contentHashFor(item), `digest:${slotKey}:${item.id}`, item.source, item.title, item.url || null, item.publishedAt, now);
        processed.run(item.id, item.source, "digested", now);
      }
      for (const item of omittedItems) processed.run(item.id, item.source, "digest-omitted", now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  sentSinceImage() {
    return this.database.prepare("SELECT sent_since_image FROM delivery_state WHERE singleton = 1").get().sent_since_image;
  }

  stats() {
    const processed = this.database.prepare("SELECT COUNT(*) AS count FROM processed_items").get().count;
    const sent = this.database.prepare("SELECT COUNT(*) AS count FROM sent_messages").get().count;
    return { processed, sent };
  }

  prune(options = {}) {
    const processedCutoff = new Date(Date.now() - (options.processedDays ?? 30) * 86400000).toISOString();
    const sentCutoff = new Date(Date.now() - (options.sentDays ?? 180) * 86400000).toISOString();
    const processed = this.database.prepare("DELETE FROM processed_items WHERE processed_at < ?").run(processedCutoff).changes;
    const sent = this.database.prepare("DELETE FROM sent_messages WHERE sent_at < ?").run(sentCutoff).changes;
    this.database.prepare("DELETE FROM news_pool WHERE published_at < ?").run(new Date(Date.now() - 3 * 86400000).toISOString());
    this.database.prepare("DELETE FROM runtime_state WHERE key LIKE 'breaking_sent:%' AND key < ?").run(`breaking_sent:${beijingDay(new Date(Date.now() - 7 * 86400000))}`);
    return { processed, sent };
  }

  close() {
    try {
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      this.database.close();
    }
  }
}

function beijingDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
}

function numberSignature(title) {
  const text = String(title).normalize("NFKC").replace(/(\d),(?=\d)/g, "$1");
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).sort((a, b) => a - b).join(",");
}

function isUsableImageUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/(?:logo|icon|avatar|emoji|tracking|pixel|spacer)/i.test(url.pathname);
  } catch {
    return false;
  }
}
