import test from "node:test";
import assert from "node:assert/strict";
import { detectMarketMove } from "../src/sources/market-moves-source.js";

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
