import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "../src/sources/rss-source.js";

test("parses RSS items and images", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[美联储维持利率不变]]></title><link>https://example.com/a</link><guid>a-1</guid><pubDate>Thu, 06 Aug 2026 03:15:00 GMT</pubDate><description><![CDATA[<p>声明强调通胀风险。</p><img src="https://example.com/a.jpg">]]></description></item></channel></rss>`;
  const items = parseFeed(xml, { name: "测试源", language: "zh" });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "美联储维持利率不变");
  assert.equal(items[0].description, "声明强调通胀风险。");
  assert.equal(items[0].imageUrl, "https://example.com/a.jpg");
  assert.equal(items[0].url, "https://example.com/a");
  assert.equal(items[0].timestampReliable, true);
});

test("marks missing publication dates as unreliable", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title>没有时间的旧闻</title><guid>old-1</guid></item></channel></rss>`;
  const [item] = parseFeed(xml, { name: "测试源", language: "zh" });
  assert.equal(item.timestampReliable, false);
});

test("passes source-specific display rules into RSS items", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title>国际财经标题</title><link>https://example.com/yahoo</link><guid>y-1</guid><pubDate>Thu, 06 Aug 2026 03:15:00 GMT</pubDate></item></channel></rss>`;
  const [item] = parseFeed(xml, {
    name: "Yahoo股市国际财经",
    language: "zh",
    preserveTitle: true,
    forceSourceUrl: true
  });
  assert.equal(item.preserveTitle, true);
  assert.equal(item.forceSourceUrl, true);
});
