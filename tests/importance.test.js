import test from "node:test";
import assert from "node:assert/strict";
import { scoreImportance, selectImportantItems, isMajorEarningsResult } from "../src/services/importance.js";

function item(title, extra = {}) {
  return {
    id: title,
    source: extra.source || "财联社电报",
    sourceKind: extra.sourceKind || "cls",
    title,
    description: extra.description || "",
    publishedAt: extra.publishedAt || new Date().toISOString(),
    ...extra
  };
}

test("major company earnings survive scoring in simplified and traditional Chinese", () => {
  for (const title of [
    "苹果公布季度财报，每股收益2.1元",
    "蘋果公布季度財報，每股收益2.1元",
    "輝達營收達500億美元，財報優於預期",
    "台積電公布第三季財報，每股盈餘12元",
    "美光发布季度财报，每股收益3.5元",
    "甲骨文公布财报，营收达到150亿美元",
    "台積電第三季每股盈餘12元",
    "AAPL Q3 EPS $2.10, revenue $90 billion"
  ]) {
    const result = scoreImportance(item(title, { sourceKind: "rss" }));
    assert.equal(result.shouldSend, true, title);
    assert.ok(result.reasons.includes("major-earnings-result"), title);
  }
});

test("earnings previews, forecasts and opinion do not receive reported-result priority", () => {
  for (const title of [
    "美光财报前瞻：每股收益预计同比增长940%",
    "蘋果將公布季度財報，分析師預計營收達100億",
    "輝達財報優於預期？專家曝1關鍵數據",
    "美股財報季買氣升溫，標普創歷史新高",
    "蘋果公布財報日期10月30日",
    "AAPL will report Q3 earnings on October 30"
  ]) assert.equal(isMajorEarningsResult(title), false, title);
});

test("traditional promotional headlines remain rejected", () => {
  assert.equal(scoreImportance(item("一文讀懂蘋果財報：營收達100億", { sourceKind: "rss" })).reason, "junk");
});

test("reported earnings get one slot within the existing source quota", () => {
  const earnings = item("蘋果公布季度財報，每股收益2.1元", { source: "Yahoo", sourceKind: "rss" });
  const other = [1, 2, 3].map((n) => item(`美股上涨${n * 10}%`, { source: "Yahoo", sourceKind: "rss", importanceHint: 95 }));
  const result = selectImportantItems([...other, earnings], { maxItems: 2, maxPerSource: 2 });
  assert.equal(result.selected.length, 2);
  assert.ok(result.selected.some((entry) => entry.id === earnings.id));
});

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

test("keeps genuinely major political events", () => {
  const result = scoreImportance(item("某国宣布进入国家紧急状态，总统辞职"));
  assert.equal(result.shouldSend, true);
});

test("keeps major public-health emergencies", () => {
  const result = scoreImportance(item("世卫宣布新型传染病构成国际关注的突发公共卫生事件"));
  assert.equal(result.shouldSend, true);
  assert.equal(result.isBreaking, true);
});

test("filters feature articles and promotional content", () => {
  const result = scoreImportance(item("一文读懂本周最值得关注的十个加密项目"));
  assert.equal(result.shouldSend, false);
  assert.equal(result.reason, "junk");
});

test("filters irrelevant legacy Polymarket politics", () => {
  const result = scoreImportance(item("Will a presidential candidate visit France this year?", { sourceKind: "polymarket", source: "Polymarket" }));
  assert.equal(result.shouldSend, false);
  assert.equal(result.reason, "irrelevant-polymarket");
});

test("keeps a large Polymarket probability move", () => {
  const result = scoreImportance(item("Will the Fed cut rates in September?", {
    sourceKind: "polymarket_move",
    source: "Polymarket",
    description: "Polymarket概率1小时上升12.0个百分点，当前概率约68%",
    polymarketChangePp: 12,
    importanceHint: 80
  }));
  assert.equal(result.shouldSend, true);
});

test("keeps direct global market anomalies", () => {
  const result = scoreImportance(item("纳斯达克综合指数过去30分钟跌1.2%", {
    sourceKind: "market",
    source: "全球指数异动",
    marketMovePct: -1.2,
    importanceHint: 84
  }));
  assert.equal(result.shouldSend, true);
  assert.equal(result.isBreaking, true);
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
