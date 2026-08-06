import test from "node:test";
import assert from "node:assert/strict";
import { containsChinese, matchesKeywordRules, normalizeForHash, parseGdeltDate, stripHtml, truncateChineseStyle } from "../src/utils/text.js";

test("text helpers", () => {
  assert.equal(stripHtml("<p>美联储&nbsp;维持 <b>利率</b></p>"), "美联储 维持 利率");
  assert.equal(containsChinese("Gold rises"), false);
  assert.equal(containsChinese("黄金上涨"), true);
  assert.equal(normalizeForHash("快讯：黄金 上涨！"), "快讯黄金上涨");
  assert.equal(truncateChineseStyle("一二三四五", 4), "一二三…");
  assert.equal(matchesKeywordRules("英伟达发布财报", undefined, ["英伟达"], ["广告"]), true);
  assert.equal(matchesKeywordRules("英伟达广告", undefined, ["英伟达"], ["广告"]), false);
  assert.equal(parseGdeltDate("20260806T031500Z"), "2026-08-06T03:15:00.000Z");
});
