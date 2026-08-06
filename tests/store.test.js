import test from "node:test";
import assert from "node:assert/strict";
import { NewsStore } from "../src/store/news-store.js";

const item = { id: "rss:1", source: "测试", sourceKind: "rss", title: "黄金上涨", publishedAt: "2026-08-06T00:00:00.000Z" };

test("store records sent and duplicate items", () => {
  const store = new NewsStore(":memory:");
  assert.equal(store.isProcessed(item.id), false);
  store.recordSent(item, "content-hash", "message-hash");
  assert.equal(store.isProcessed(item.id), true);
  assert.equal(store.hasContentHash("content-hash"), true);
  assert.deepEqual(store.stats(), { processed: 1, sent: 1 });
  store.close();
});

test("store marks duplicate without sent record", () => {
  const store = new NewsStore(":memory:");
  store.markProcessed(item, "duplicate");
  assert.deepEqual(store.stats(), { processed: 1, sent: 0 });
  store.close();
});
