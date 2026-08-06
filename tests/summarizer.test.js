import test from "node:test";
import assert from "node:assert/strict";
import { Summarizer, extractOutputText } from "../src/services/summarizer.js";

test("extracts raw Responses API output text", () => {
  assert.equal(extractOutputText({ output: [{ content: [{ type: "output_text", text: "测试" }] }] }), "测试");
});

test("uses Chinese passthrough without API key", async () => {
  const summarizer = new Summarizer({ model: "unused", defaultPrefix: "快讯", maxChineseChars: 50, timeoutMs: 1000 });
  const result = await summarizer.summarize({ id: "1", source: "测试", sourceKind: "rss", title: "黄金价格上涨", publishedAt: new Date().toISOString() });
  assert.equal(result, "快讯：黄金价格上涨。");
});
