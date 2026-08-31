import assert from "node:assert/strict";
import test from "node:test";
import { runPipelineCycle } from "../src/pipeline.js";
import { NewsStore } from "../src/store/news-store.js";

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

test("reports the source name when an adapter fails", async () => {
  const errors = [];
  const result = await runPipelineCycle({
    config,
    sources: [{ name: "broken-source", fetch: async () => { throw new Error("offline"); } }],
    store: new NewsStore(":memory:"),
    summarizer: { summarize: async () => undefined },
    publisher: { publish: async () => {} },
    logger: { info() {}, warn() {}, error(fields) { errors.push(fields); } }
  });

  assert.equal(result.failedSources, 1);
  assert.equal(errors[0].source, "broken-source");
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
  assert.equal(result.sent, 0);
  store.close();
});
