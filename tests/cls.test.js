import test from "node:test";
import assert from "node:assert/strict";
import { buildClsTelegraphUrl } from "../src/sources/cls-source.js";

test("builds signed CLS telegraph URL", () => {
  const url = new URL(buildClsTelegraphUrl());
  assert.equal(url.origin, "https://www.cls.cn");
  assert.equal(url.pathname, "/api/cache");
  assert.equal(url.searchParams.get("appName"), "CailianpressWeb");
  assert.equal(url.searchParams.get("name"), "telegraph");
  assert.equal(url.searchParams.get("os"), "web");
  assert.equal(url.searchParams.get("sv"), "8.7.9");
  assert.match(url.searchParams.get("sign"), /^[a-f0-9]{32}$/);
});
