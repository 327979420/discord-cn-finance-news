import assert from "node:assert/strict";
import test from "node:test";
import { runPipelineCycle } from "../src/pipeline.js";
import { NewsStore } from "../src/store/news-store.js";
import { sha256 } from "../src/utils/hash.js";
import { normalizeNewsFingerprint } from "../src/utils/text.js";

const config = {
  REQUEST_TIMEOUT_MS: 1000,
  MAX_NEWS_AGE_MINUTES: 45,
  MIN_IMPORTANCE_SCORE: 60,
  BREAKING_IMPORTANCE_SCORE: 82,
  MAX_ITEMS_PER_CYCLE: 6,
  MAX_ITEMS_PER_SOURCE: 2,
  SIMILAR_NEWS_WINDOW_HOURS: 36,
  IMAGE_EVERY_N_MESSAGES: 10,
  IMAGE_MIN_IMPORTANCE_SCORE: 82,
  DRY_RUN: false,
  includeKeywords: [],
  excludeKeywords: []
};

test("reports the source name when an adapter fails", async (t) => {
  const errors = [];
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  const result = await runPipelineCycle({
    config,
    sources: [{ name: "broken-source", fetch: async () => { throw new Error("offline"); } }],
    store,
    summarizer: { summarize: async () => undefined },
    publisher: { publish: async () => {} },
    logger: { info() {}, warn() {}, error(fields) { errors.push(fields); } }
  });

  assert.equal(result.failedSources, 1);
  assert.equal(errors[0].source, "broken-source");
  assert.equal(store.lastSuccessfulCycleAt(), undefined);
});

test("counts attempted and failed Discord deliveries", async () => {
  const store = new NewsStore(":memory:");
  const item = {
    id: "breaking-1",
    source: "test-source",
    sourceKind: "market",
    title: "标普500日内跌2%",
    publishedAt: new Date().toISOString(),
    language: "zh",
    importanceHint: 90,
    marketMovePct: -2
  };
  const result = await runPipelineCycle({
    config,
    sources: [{ name: "test-source", fetch: async () => [item] }],
    store,
    summarizer: { summarize: async () => "突发：标普500日内跌2%。" },
    publisher: { publish: async () => { throw new Error("webhook rejected"); } },
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.equal(result.attemptedDeliveries, 1);
  assert.equal(result.failedDeliveries, 1);
  assert.equal(result.failedItems, 1);
  assert.equal(result.sent, 0);
  assert.equal(store.lastSuccessfulCycleAt(), undefined);
  store.close();
});

function earnings(id, ageMinutes) {
  return { id, source: "Yahoo", sourceKind: "rss", title: `蘋果公布季度財報，每股收益${id}元`, publishedAt: new Date(Date.now() - ageMinutes * 60000).toISOString() };
}

async function runWithItems(store, items, extra = {}) {
  return runPipelineCycle({
    config: { ...config, ...extra },
    store,
    sources: [{ name: "Yahoo", fetch: async () => items }],
    summarizer: { summarize: async (item) => `快讯：${item.title}` },
    publisher: { publish: async () => {} },
    logger: { info() {}, warn() {}, error() {} }
  });
}

test("delayed runs catch missed earnings but reject news beyond the recovery cap", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  store.recordSuccessfulCycle(new Date(Date.now() - 360 * 60000).toISOString());
  const result = await runWithItems(store, [earnings("1", 240), earnings("2", 800)]);
  assert.equal(result.sent, 1);
  assert.equal(result.excluded.stale, 1);
  assert.ok(result.windowMinutes >= 365);
  assert.ok(store.lastSuccessfulCycleAt());
});

test("new scoring can re-evaluate a previously rejected earnings headline", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  const item = earnings("3", 10);
  store.markProcessed(item, "filtered:low-importance");
  assert.equal((await runWithItems(store, [item])).sent, 1);
  assert.equal((await runWithItems(store, [item])).sent, 0);
});

test("preview does not consume news or advance the recovery checkpoint", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  const item = earnings("4", 5);
  const result = await runWithItems(store, [item], { DRY_RUN: true });
  assert.equal(result.sent, 1);
  assert.deepEqual(store.stats(), { processed: 0, sent: 0 });
  assert.equal(store.lastSuccessfulCycleAt(), undefined);
  assert.equal((await runWithItems(store, [item])).sent, 1);
});

test("summarizer errors are counted independently of Discord failures", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  const result = await runPipelineCycle({
    config,
    store,
    sources: [{ name: "Yahoo", fetch: async () => [earnings("5", 1)] }],
    summarizer: { summarize: async () => { throw new Error("summary failed"); } },
    publisher: { publish: async () => assert.fail("must not publish") },
    logger: { info() {}, warn() {}, error() {} }
  });
  assert.equal(result.failedItems, 1);
  assert.equal(result.failedDeliveries, 0);
  assert.equal(result.attemptedDeliveries, 0);
});

test("delivered duplicates cannot consume the only available quota slot", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  const alreadySent = { ...earnings("6", 1), importanceHint: 100 };
  store.recordSent(alreadySent, sha256(normalizeNewsFingerprint(alreadySent.title)), "previous-message-hash");
  const repeatedFromAnotherFeed = { ...alreadySent, id: "different-item-id" };
  const fresh = earnings("7", 1);
  const result = await runWithItems(store, [repeatedFromAnotherFeed, fresh], { MAX_ITEMS_PER_CYCLE: 1, MAX_ITEMS_PER_SOURCE: 1 });
  assert.equal(result.sent, 1);
  assert.equal(result.duplicate, 1);
  assert.equal(store.isProcessed(fresh.id), true);
});

test("catch-up backlog remains eligible after a successful quota-limited cycle", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  store.recordSuccessfulCycle(new Date(Date.now() - 360 * 60000).toISOString());
  const items = [earnings("8", 240), earnings("9", 240)];
  const first = await runWithItems(store, items, { MAX_ITEMS_PER_CYCLE: 1 });
  assert.equal(first.sent, 1);
  assert.equal(first.pending, 1);
  const second = await runWithItems(store, items, { MAX_ITEMS_PER_CYCLE: 1 });
  assert.equal(second.sent, 1);
  assert.equal(second.pending, 0);
  assert.equal(store.pendingNewsAt(), undefined);
});
