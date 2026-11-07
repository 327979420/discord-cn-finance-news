import test from "node:test";
import assert from "node:assert/strict";
import { detectMarketMove, extractQuote, detectDailyPageMove, markTrend } from "../src/sources/market-moves-source.js";

function payload({ previousClose = 100, timestamps, closes }) {
  return {
    chart: {
      result: [{
        meta: { chartPreviousClose: previousClose },
        timestamp: timestamps,
        indicators: { quote: [{ close: closes }] }
      }]
    }
  };
}

test("detects a sharp 30 minute stock move", () => {
  const now = Date.UTC(2026, 7, 10, 3, 0, 0);
  const latest = Math.floor(now / 1000);
  const result = detectMarketMove(payload({
    timestamps: [latest - 3600, latest - 1800, latest],
    closes: [100, 100, 103]
  }), {
    symbol: "NVDA",
    name: "英伟达",
    group: "stock",
    type: "stock",
    dayThreshold: 4,
    suddenThreshold: 2,
    suddenMinutes: 30
  }, now);

  assert.ok(result);
  assert.equal(result.sourceKind, "market");
  assert.match(result.title, /英伟达（NVDA）过去30分钟涨3%/);
  assert.equal(result.marketMoveBasis, "sudden");
});

test("ignores ordinary market noise below thresholds", () => {
  const now = Date.UTC(2026, 7, 10, 3, 0, 0);
  const latest = Math.floor(now / 1000);
  const result = detectMarketMove(payload({
    timestamps: [latest - 3600, latest - 1800, latest],
    closes: [100, 100.2, 100.5]
  }), {
    symbol: "^GSPC",
    name: "标普500",
    group: "index",
    type: "index",
    dayThreshold: 1.5,
    suddenThreshold: 0.8,
    suddenMinutes: 30
  }, now);

  assert.equal(result, undefined);
});

// Rows as they appear in Yahoo Taiwan's tables on 30 Oct 2026, after tags are stripped.
const NVDA_ROW = "NVDA 204.64 9.02 4.22% 203.50 205.03 208.88 213.66 209.05 200.92 165.924M 10/31 04:00";
const IXIC_ROW = "^IXIC 25,437.00 747.73 2.86% 0.00 0.00 25,592.49 26,184.72 25,673.00 25,177.33 7.710B 10/31 05:15";
const BTC_ROW = "BTC-USD 76,740.08 2,120.56 2.69% - - 77,791.38 77,791.38 78,564.94 76,264.74 48.823B 10/31 06:30";

test("reads a fall from the previous close when the page shows no minus sign", () => {
  assert.deepEqual(extractQuote(NVDA_ROW, "NVDA"), { price: 204.64, absoluteChange: -9.02, changePct: -4.22 });
  assert.equal(extractQuote(IXIC_ROW, "^IXIC").changePct, -2.86);
  // Crypto's 昨收 does not match its 24-hour change, so without a marked sign it is skipped.
  assert.equal(extractQuote(BTC_ROW, "BTC-USD"), undefined);
  assert.equal(extractQuote(BTC_ROW.replace("2,120.56 2.69%", "-2,120.56 -2.69%"), "BTC-USD").changePct, -2.69);
  const alert = detectDailyPageMove(extractQuote(IXIC_ROW, "^IXIC"), { symbol: "^IXIC", name: "纳斯达克综合指数", group: "index", type: "index", dayThreshold: 1.8 });
  assert.equal(alert.title, "纳斯达克综合指数日内跌2.86%");
});

test("reads a rise from the previous close", () => {
  assert.equal(extractQuote("ORCL 139.56 8.89 6.80% 139.50 139.60 132.00 130.67 140.10 131.20 40.1M 10/31 04:00", "ORCL").changePct, 6.8);
});

test("skips a quote whose change does not match the previous close", () => {
  assert.equal(extractQuote("NVDA 204.64 9.02 4.22% 203.50 205.03 208.88 200.00 209.05 200.92", "NVDA"), undefined);
  assert.equal(extractQuote("NVDA 204.64 9.02 4.22%", "NVDA"), undefined);
});

test("turns Yahoo's colour triangles into signs", () => {
  const arrow = (trend) => `<span class="Fw(600) Jc(fe) D(f) Ai(c) C($c-trend-${trend})"><span class="Mend(4px) Bds(s)" style="border-color:#00ab5e"></span>`;
  const html = `<span class="Jc(fe) C($c-trend-down)">204.64</span>${arrow("down")}9.02</span>${arrow("down")}4.22%</span>${arrow("up")}3.05</span>`;
  assert.equal(markTrend(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), "204.64 -9.02 -4.22% +3.05");
});

test("skips a quote whose marked sign contradicts the previous close", () => {
  assert.equal(extractQuote(NVDA_ROW.replace("9.02 4.22%", "+9.02 +4.22%"), "NVDA"), undefined);
});
