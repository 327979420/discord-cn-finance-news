import test from "node:test";
import assert from "node:assert/strict";
import { newsWindowMinutes, cycleIsHealthy } from "../src/services/freshness.js";

const now = Date.parse("2026-10-12T10:00:00Z");
const config = { MAX_NEWS_AGE_MINUTES: 45, MAX_CATCHUP_AGE_MINUTES: 720 };

test("normal cadence retains a short freshness window", () => {
  assert.equal(newsWindowMinutes(config, "2026-10-12T09:50:00Z", now), 45);
});

test("a six-hour scheduling gap is covered with overlap", () => {
  assert.equal(newsWindowMinutes(config, "2026-10-12T04:00:00Z", now), 365);
});

test("first run and a long outage are capped at twelve hours", () => {
  assert.equal(newsWindowMinutes(config, undefined, now), 720);
  assert.equal(newsWindowMinutes(config, "2026-09-01T00:00:00Z", now), 720);
});

test("partial failures are unhealthy while an empty successful cycle is healthy", () => {
  assert.equal(cycleIsHealthy({ failedSources: 0, failedItems: 0, sent: 0 }, 3), true);
  assert.equal(cycleIsHealthy({ failedSources: 1, failedItems: 0 }, 3), false);
  assert.equal(cycleIsHealthy({ failedSources: 0, failedItems: 1 }, 3), false);
  assert.equal(cycleIsHealthy(undefined, 3), false);
});
