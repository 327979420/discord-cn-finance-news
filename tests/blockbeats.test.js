import test from "node:test";
import assert from "node:assert/strict";
import { parseBlockBeats } from "../src/sources/blockbeats-source.js";

test("uses the displayed Beijing time instead of pretending old items are new", () => {
  const now = new Date("2026-08-17T02:00:00.000Z");
  const [item] = parseBlockBeats("<h2>09:35 比特币突破新高</h2>", 10, now);
  assert.equal(item.publishedAt, "2026-08-17T01:35:00.000Z");
  assert.equal(item.timestampReliable, true);
});

test("marks BlockBeats entries without a displayed time as unreliable", () => {
  const [item] = parseBlockBeats("<h2>历史快讯标题</h2>", 10, new Date("2026-08-17T02:00:00.000Z"));
  assert.equal(item.timestampReliable, false);
});

