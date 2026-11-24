import assert from "node:assert/strict";
import test from "node:test";
import { digestDue, latestSlot } from "../src/services/digest-schedule.js";
import { checkDigest, numberSupported, numbersIn, parseResult, HeadlineDigestWriter } from "../src/services/digest-writer.js";
import { buildDigestEmbed, sourceLabel, sourceLinks } from "../src/services/digest-card.js";
import { snapshotRows } from "../src/services/market-snapshot.js";
import { coinbaseQuote } from "../src/sources/market-moves-source.js";
import { runDigestCycle } from "../src/digest.js";
import { runPipelineCycle } from "../src/pipeline.js";
import { NewsStore } from "../src/store/news-store.js";

const digestConfig = {
  enabled: true,
  timezone: "Asia/Shanghai",
  maxLateMinutes: 150,
  maxWindowHours: 18,
  maxCandidates: 40,
  minCandidateScore: 45,
  slots: [
    { time: "07:30", title: "早报 · 美股收盘", regions: ["us", "cross"] },
    { time: "12:00", title: "午间 · 亚太盘中", regions: ["asia", "cross"] },
    { time: "17:00", title: "傍晚 · 欧洲开盘", regions: ["europe"] },
    { time: "21:15", title: "晚间 · 美股开盘前", regions: ["europe", "cross"] }
  ]
};

test("latest slot uses Beijing wall-clock time, including yesterday's last slot", () => {
  // 2026-11-19 03:31 UTC = 11:31 Beijing -> 07:30 slot
  assert.equal(latestSlot(digestConfig, new Date("2026-11-19T03:31:00Z")).key, "2026-11-19 07:30");
  // 2026-11-18 23:00 UTC = 07:00 Beijing on the 19th -> 21:15 on the 18th
  assert.equal(latestSlot(digestConfig, new Date("2026-11-18T23:00:00Z")).key, "2026-11-18 21:15");
  assert.equal(latestSlot(digestConfig, new Date("2026-11-18T23:30:00Z")).at.toISOString(), "2026-11-18T23:30:00.000Z");
});

test("a slot is due once, and skipped when the run is too late", () => {
  const now = new Date("2026-11-19T04:10:00Z"); // 12:10 Beijing
  assert.deepEqual(
    [digestDue(digestConfig, "2026-11-19 07:30", now).due, digestDue(digestConfig, "2026-11-19 07:30", now).slot.key],
    [true, "2026-11-19 12:00"]
  );
  assert.equal(digestDue(digestConfig, "2026-11-19 12:00", now).reason, "already-posted");
  assert.equal(digestDue(digestConfig, undefined, new Date("2026-11-19T07:00:00Z")).reason, "missed"); // 15:00, 3h late
});

test("numbers must come from cited items, allowing rounding and unit changes", () => {
  assert.deepEqual(numbersIn("爆仓超3,812.09万美元，跌2.3%"), [3812.09, 2.3]);
  assert.ok(numberSupported(3812, [3812.09]));
  assert.ok(numberSupported(12, [1.2])); // 1.2 billion -> 12亿
  assert.ok(numberSupported(1050, [1050]));
  assert.ok(!numberSupported(5, [2.3, 3812.09]));
});

const items = [
  { id: "a", source: "BlockBeats快讯", title: "比特币跌破6.25万美元关口，过去1小时爆仓超3812.09万美元", publishedAt: "2026-11-18T18:00:00Z", language: "zh" },
  { id: "b", source: "Yahoo股市国际财经", title: "輝達財報亮眼仍跌近3%！AI投資與出口管制等「四大疑慮」未散", url: "https://tw.news.yahoo.com/b", publishedAt: "2026-11-19T00:10:00Z", language: "zh", preserveTitle: true },
  { id: "c", source: "BlockBeats快讯", title: "美股收盘三大股指涨跌不一，英伟达跌近3%，AMD涨5.3%", publishedAt: "2026-11-19T00:12:00Z", language: "zh" }
];

test("checkDigest keeps traceable lines in topic order and drops the rest", () => {
  const draft = {
    headline: "英伟达财报后仍跌近3%",
    sections: [
      { topic: "加密货币", lines: [
        { text: "比特币跌破6.25万美元，1小时爆仓超3812万美元", sources: [1] },
        { text: "比特币24小时跌5%", sources: [1] }
      ] },
      { topic: "美股与科技", lines: [
        { text: "英伟达财报亮眼仍跌近3%，AMD涨5.3%，市场担忧出口管制", sources: [2, 3] },
        { text: "某条引用了不存在的条目", sources: [9] }
      ] }
    ]
  };
  const checked = checkDigest(draft, items);
  assert.equal(checked.headline, "英伟达财报后仍跌近3%");
  assert.deepEqual(checked.sections.map((section) => section.topic), ["美股与科技", "加密货币"]);
  assert.deepEqual(checked.sections[0].lines[0].items.map((item) => item.id), ["b", "c"]);
  assert.deepEqual(checked.dropped.map((drop) => drop.reason.split(":")[0]).sort(), ["unknown-source", "unsupported-number"]);
});

test("checkDigest drops a headline with an invented number", () => {
  const checked = checkDigest({ headline: "英伟达暴跌8%", sections: [] }, items);
  assert.equal(checked.headline, "");
});

test("parseResult reads Claude Code's structured output and reports failures", () => {
  const draft = { headline: "x", sections: [] };
  assert.deepEqual(parseResult(JSON.stringify({ type: "result", is_error: false, structured_output: draft })), draft);
  assert.throws(() => parseResult(JSON.stringify({ type: "result", is_error: true, result: "Not logged in" })), /Not logged in/);
});

test("headline fallback prefers simplified-Chinese sources over raw teaser titles", async () => {
  const written = await new HeadlineDigestWriter().write({ items: items.map((item, index) => ({ ...item, importanceScore: 90 - index })) });
  assert.deepEqual(written.sections[0].lines.map((line) => line.items[0].id), ["a", "c", "b"]);
});

test("market rows bold moves past the alert threshold and keep only big stock moves", () => {
  const rows = snapshotRows([
    { symbol: "^GSPC", short: "标普", region: "us", group: "index", changePct: -1.6, dayThreshold: 1.5 },
    { symbol: "^IXIC", short: "纳指", region: "us", group: "index", changePct: 0.42, dayThreshold: 1.8 },
    { symbol: "NVDA", short: "NVDA", group: "stock", type: "stock", changePct: -2.89, dayThreshold: 4 },
    { symbol: "AAPL", short: "AAPL", group: "stock", type: "stock", changePct: 0.15, dayThreshold: 3.5 },
    { symbol: "BTC-USD", short: "BTC", group: "cross-asset", type: "crypto", changePct: -2.33, dayThreshold: 5 }
  ], ["us", "stocks", "cross", "asia"]);
  assert.deepEqual(rows, [
    { label: "美股", text: "标普 **-1.60%** · 纳指 +0.42%" },
    { label: "个股", text: "NVDA -2.89%" },
    { label: "资产", text: "BTC -2.33%" }
  ]);
});

test("Coinbase 24-hour stats give a signed change", () => {
  assert.deepEqual(coinbaseQuote({ open: "64374.87", last: "62873.97" }), { price: 62873.97, absoluteChange: -1500.9, changePct: -2.33 });
  assert.equal(coinbaseQuote({ open: "0", last: "1" }), undefined);
});

test("the card links each source once and labels the writer", () => {
  assert.equal(sourceLabel("GDELT · www.reuters.com"), "reuters.com");
  assert.equal(sourceLinks([items[1], items[2], items[0]]), "[Yahoo](https://tw.news.yahoo.com/b) · 律动");
  const embed = buildDigestEmbed({
    slot: { title: "早报 · 美股收盘", at: new Date("2026-11-18T23:30:00Z") },
    digest: { headline: "英伟达财报后仍跌近3%", writer: "claude", sections: [{ topic: "美股与科技", lines: [{ text: "英伟达跌近3%", items: [items[1]] }] }] },
    marketRows: [{ label: "美股", text: "标普 -0.23%" }],
    timeZone: "Asia/Shanghai",
    now: new Date("2026-11-18T23:31:00Z"),
    windowLabel: "21:15–07:31 北京时间"
  });
  assert.equal(embed.title, "早报 · 美股收盘 · 11月19日");
  assert.equal(embed.description, "**英伟达财报后仍跌近3%**\n\n`美股` 标普 -0.23%");
  assert.equal(embed.fields[0].value, "• 英伟达跌近3%  [Yahoo](https://tw.news.yahoo.com/b)");
  assert.match(embed.footer.text, /Claude 整理/);
});

function quietLogger() {
  return { info() {}, warn() {}, error() {} };
}

test("a digest run posts one card, uses the pool and closes what it considered", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  const now = new Date("2026-11-19T00:00:00Z");
  const pooled = { id: "p", source: "Yahoo股市国际财经", sourceKind: "rss", title: "美联储会议纪要显示多数官员支持12月加息", publishedAt: "2026-11-18T20:00:00Z", language: "zh" };
  store.addToPool([pooled]);
  const fresh = { id: "f", source: "BlockBeats快讯", sourceKind: "rss", title: "比特币跌破6.25万美元关口，过去1小时爆仓超3812.09万美元", publishedAt: "2026-11-18T23:50:00Z", language: "zh" };
  const posted = [];
  const result = await runDigestCycle({
    config: { REQUEST_TIMEOUT_MS: 1000, SIMILAR_NEWS_WINDOW_HOURS: 36, DRY_RUN: false, includeKeywords: [], excludeKeywords: [], sources: { digest: digestConfig } },
    sources: [{ name: "test", fetch: async () => [fresh], lastQuotes: [{ symbol: "^GSPC", short: "标普", region: "us", changePct: -0.23, dayThreshold: 1.5, price: 7323.63 }] }],
    store,
    writer: {
      name: "claude",
      write: async ({ items: given }) => ({
        writer: "claude",
        headline: "",
        dropped: [],
        sections: [{ topic: "加密货币", lines: [{ text: "比特币跌破6.25万美元", items: [given.find((item) => item.id === "f")] }] }]
      })
    },
    fallbackWriter: new HeadlineDigestWriter(),
    publisher: { publishEmbed: async (embed) => posted.push(embed) },
    logger: quietLogger(),
    slot: { ...latestSlot(digestConfig, now), regions: ["us"] },
    now
  });
  assert.equal(result.posted, true);
  assert.equal(result.candidates, 2);
  assert.equal(posted.length, 1);
  assert.equal(store.getState("last_digest_slot"), "2026-11-19 07:30"); // 08:00 Beijing
  assert.equal(store.isFinalized("f"), true); // used
  assert.equal(store.isFinalized("p"), true); // considered and omitted by Claude
});

test("between cards only an emergency posts, within the daily cap", async (t) => {
  const store = new NewsStore(":memory:");
  t.after(() => store.close());
  const publishedAt = new Date().toISOString();
  const routine = { id: "r", source: "BlockBeats快讯", sourceKind: "rss", title: "比特币跌破6.25万美元关口，过去1小时爆仓超3812.09万美元", publishedAt, language: "zh" };
  const emergency = { id: "e", source: "BlockBeats快讯", sourceKind: "rss", title: "美股触发熔断，标普500暴跌7%，纽交所暂停交易", publishedAt, language: "zh" };
  const sent = [];
  const result = await runPipelineCycle({
    config: {
      REQUEST_TIMEOUT_MS: 1000, MAX_NEWS_AGE_MINUTES: 45, MIN_IMPORTANCE_SCORE: 60, BREAKING_IMPORTANCE_SCORE: 82,
      MAX_ITEMS_PER_CYCLE: 6, MAX_ITEMS_PER_SOURCE: 2, SIMILAR_NEWS_WINDOW_HOURS: 36, IMAGE_EVERY_N_MESSAGES: 10,
      IMAGE_MIN_IMPORTANCE_SCORE: 82, DRY_RUN: false, includeKeywords: [], excludeKeywords: [],
      BREAKING_ONLY: true, BREAKING_ONLY_SCORE: 95, MAX_BREAKING_PER_DAY: 3
    },
    sources: [{ name: "test", fetch: async () => [routine, emergency] }],
    store,
    summarizer: { summarize: async (item) => `突发：${item.title}` },
    publisher: { publish: async (item) => sent.push(item.id) },
    logger: quietLogger()
  });
  assert.deepEqual(sent, ["e"]);
  assert.equal(result.pending, 0);
  assert.equal(store.isFinalized("r"), false); // left for the next card
  assert.equal(store.breakingSentToday(), 1);
  assert.deepEqual(store.poolSince("2000-01-01T00:00:00Z").map((item) => item.id).sort(), ["e", "r"]);
});

test("long topics split into extra fields and URLs drop when the card is too big", () => {
  const longUrl = `https://tw.news.yahoo.com/${"%E8%BC%9D".repeat(60)}-1.html`;
  const lines = Array.from({ length: 9 }, (_, index) => ({ text: `第${index + 1}条：${"英伟达".repeat(20)}`, items: [{ source: "Yahoo股市国际财经", url: `${longUrl}?${index}` }, { source: "BlockBeats快讯" }] }));
  const embed = buildDigestEmbed({
    slot: { title: "早报 · 美股收盘", at: new Date("2026-11-18T23:30:00Z") },
    digest: { headline: "", writer: "claude", sections: [{ topic: "美股与科技", lines: lines.slice(0, 4) }, { topic: "公司动态", lines: lines.slice(4) }] },
    marketRows: [],
    timeZone: "Asia/Shanghai"
  });
  const total = embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  assert.ok(total <= 5600);
  assert.ok(embed.fields.every((field) => field.value.length <= 1024));
  assert.equal(embed.fields.filter((field) => field.name !== "​").length, 2);
  assert.equal(embed.fields.flatMap((field) => field.value.split("\n")).length, 9);
});

test("EquationNews items become clean simplified-Chinese news and skip exchange notices", async () => {
  const { toNewsItem, cleanHeadline, backgroundText } = await import("../src/sources/equation-news-source.js");
  const channel = { key: "tradfi", name: "方程式财经", importanceHint: 55 };
  assert.equal(cleanHeadline("*英伟达高层在最后一刻才得知该决定\n\n*英伟达在黄仁勋一事上的态度逆转未征求领导层意见\n\n$NVDA"),
    "英伟达高层在最后一刻才得知该决定；英伟达在黄仁勋一事上的态度逆转未征求领导层意见");
  const item = toNewsItem({
    no: 17063, time: "2026-11-23T19:01:45.465Z", channels: ["tradfi"], source: "PhoenixNews",
    zh: "*黄仁勋：第二次担任CEO我会做得更好", url: "https://eqn.news/tradfi/17063",
    ai: { summary: null, overview: { status: "ready", zh: { paragraphs: [{ text: "22日，董事会一致同意他复职。" }] } } }
  }, channel);
  assert.deepEqual(
    { id: item.id, source: item.source, title: item.title, url: item.url, hint: item.importanceHint },
    { id: "eqn:17063", source: "方程式财经", title: "黄仁勋：第二次担任CEO我会做得更好", url: "https://eqn.news/tradfi/17063", hint: 55 }
  );
  assert.match(item.description, /^背景（方程式AI检索，仅供参考）：22日/);
  assert.equal(toNewsItem({ no: 1, time: "2026-11-24T03:45:00Z", channels: ["main", "korea"], source: "UPBIT LISTING", zh: "[新增市场] 新增 Orochi Network(ON) 韩元市场" }, channel), undefined);
  assert.equal(toNewsItem({ no: 2, time: "2026-11-20T06:15:00Z", channels: ["main"], source: "Binance EN", zh: "Binance Futures 将上线多个 TradFi 永续合约" }, channel), undefined);
  assert.equal(backgroundText({ overview: { status: "pending" } }), "");
});

test("EquationNews pages back until the lookback window", async () => {
  const { EquationNewsSource } = await import("../src/sources/equation-news-source.js");
  const now = Date.now();
  const page = (start, cursor) => ({ items: Array.from({ length: 50 }, (_, i) => ({ no: start + i, time: new Date(now - (start + i) * 600000).toISOString(), channels: ["tradfi"], source: "Tradfin", zh: `第${start + i}条新闻标题内容` })), next_cursor: cursor });
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const before = new URL(url).searchParams.get("before");
    return new Response(JSON.stringify(before ? page(50, "c2") : page(0, "c1")), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const source = new EquationNewsSource({ channels: [{ key: "tradfi", name: "方程式财经" }], lookbackHours: 12, maxPages: 4 });
    const items = await source.fetch({ timeoutMs: 1000 });
    assert.equal(requested.length, 2); // second page reaches past 12 hours, so it stops
    assert.ok(items.every((item) => now - Date.parse(item.publishedAt) <= 12 * 3600000));
    assert.equal(items.length, 73); // items 0..72 are within 12h at 10-minute spacing
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("decided Polymarket markets are left out of cards", async () => {
  const { polymarketDecided } = await import("../src/digest.js");
  assert.equal(polymarketDecided("Polymarket概率1小时上升14.4个百分点，当前概率约100%；事件成交量约$11.0M"), true);
  assert.equal(polymarketDecided("Polymarket概率24小时下降17.0个百分点，当前概率约28%；事件成交量约$11.0M"), false);
  assert.equal(polymarketDecided("当前概率约2%"), true);
});
