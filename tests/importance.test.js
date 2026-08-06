import test from "node:test";
import assert from "node:assert/strict";
import { scoreImportance, selectImportantItems } from "../src/services/importance.js";

function item(title, extra = {}) {
  return {
    id: title,
    source: extra.source || "财联社电报",
    sourceKind: extra.sourceKind || "cls",
    title,
    description: extra.description || "",
    publishedAt: extra.publishedAt || new Date().toISOString()
  };
}

test("marks a circuit breaker as breaking", () => {
  const result = scoreImportance(item("韩国交易所KOSPI期货跌超5%，触发熔断"));
  assert.equal(result.shouldSend, true);
  assert.equal(result.isBreaking, true);
  assert.ok(result.score >= 82);
});

test("filters generic political announcements", () => {
  const result = scoreImportance(item("特朗普总统宣布将公布新的医疗计划"));
  assert.equal(result.shouldSend, false);
  assert.equal(result.reason, "generic-politics");
});

test("keeps market-moving tariff policy", () => {
  const result = scoreImportance(item("特朗普宣布对芯片进口加征25%关税"));
  assert.equal(result.shouldSend, true);
});

test("filters feature articles and promotional content", () => {
  const result = scoreImportance(item("一文读懂本周最值得关注的十个加密项目"));
  assert.equal(result.shouldSend, false);
  assert.equal(result.reason, "junk");
});

test("filters irrelevant Polymarket politics", () => {
  const result = scoreImportance(item("Will a presidential candidate visit France this year?", { sourceKind: "polymarket", source: "Polymarket" }));
  assert.equal(result.shouldSend, false);
  assert.equal(result.reason, "irrelevant-polymarket");
});

test("selects high-score items and caps each source", () => {
  const now = Date.now();
  const inputs = [
    item("美联储意外降息50个基点", { publishedAt: new Date(now - 3000).toISOString() }),
    item("韩国交易所KOSPI期货跌超5%，触发熔断", { publishedAt: new Date(now - 2000).toISOString() }),
    item("美国CPI同比升至4%", { publishedAt: new Date(now - 1000).toISOString() }),
    item("比特币现货ETF获监管批准", { source: "PANews快讯", sourceKind: "rss" })
  ];
  const result = selectImportantItems(inputs, { minScore: 60, breakingScore: 82, maxItems: 3, maxPerSource: 2 });
  assert.equal(result.selected.length, 3);
  assert.equal(result.selected.filter((entry) => entry.source === "财联社电报").length, 2);
  assert.ok(result.selected.some((entry) => entry.alertPrefix === "突发"));
});
