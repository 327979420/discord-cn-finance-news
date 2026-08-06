import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
    `);
  }

  isProcessed(itemId) {
    return Boolean(this.database.prepare("SELECT 1 AS found FROM processed_items WHERE item_id = ? LIMIT 1").get(itemId));
  }

  hasContentHash(contentHash) {
    return Boolean(this.database.prepare("SELECT 1 AS found FROM sent_messages WHERE content_hash = ? LIMIT 1").get(contentHash));
  }

  hasMessageHash(messageHash) {
    return Boolean(this.database.prepare("SELECT 1 AS found FROM sent_messages WHERE message_hash = ? LIMIT 1").get(messageHash));
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
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  stats() {
    const processed = this.database.prepare("SELECT COUNT(*) AS count FROM processed_items").get().count;
    const sent = this.database.prepare("SELECT COUNT(*) AS count FROM sent_messages").get().count;
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
