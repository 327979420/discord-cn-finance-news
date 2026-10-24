import test from "node:test";
import assert from "node:assert/strict";
import { parseBlockBeats } from "../src/sources/blockbeats-source.js";

test("uses the displayed Beijing time instead of pretending old items are new", () => {
  const now = new Date("2026-08-17T02:00:00.000Z");
  const [item] = parseBlockBeats("<h2>09:35 比特币突破新高</h2>", 10, now);
  assert.equal(item.publishedAt, "2026-08-17T01:35:00.000Z");
  assert.equal(item.timestampReliable, true);
});

test("reads BlockBeats 24:xx as 00:xx of the current Beijing day", () => {
  const now = new Date("2026-10-24T02:11:00.000Z");
  const html = "<h2>24:36\n\t\t    富国银行等22家企业联名反对</h2><h2>01:01 美联储维持利率不变概率88.9%</h2>";
  const [late, early] = parseBlockBeats(html, 10, now);
  assert.equal(late.publishedAt, "2026-10-23T16:36:00.000Z");
  assert.equal(late.timestampReliable, true);
  assert.equal(early.publishedAt, "2026-10-23T17:01:00.000Z");
});

test("marks BlockBeats entries without a displayed time as unreliable", () => {
  const [item] = parseBlockBeats("<h2>历史快讯标题</h2>", 10, new Date("2026-08-17T02:00:00.000Z"));
  assert.equal(item.timestampReliable, false);
});

