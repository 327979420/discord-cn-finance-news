import test from "node:test";
import assert from "node:assert/strict";
import { Summarizer, extractOutputText, selectUsefulText } from "../src/services/summarizer.js";

test("extracts raw Responses API output text", () => {
  assert.equal(extractOutputText({ output: [{ content: [{ type: "output_text", text: "测试" }] }] }), "测试");
});

test("uses a concise Chinese headline without API key", async () => {
  const summarizer = new Summarizer({ model: "unused", defaultPrefix: "快讯", maxChineseChars: 50, timeoutMs: 1000 });
  const result = await summarizer.summarize({
    id: "1",
    source: "测试",
    sourceKind: "rss",
    title: "黄金价格上涨",
    description: "这是一个很长的背景说明，不应该被整段拼接进Discord消息。",
    publishedAt: new Date().toISOString()
  });
  assert.equal(result, "快讯：黄金价格上涨：这是一个很长的背景说明，不应该被整段拼接进Discord消息。");
});

test("keeps a complete headline instead of appending the article body", async () => {
  const summarizer = new Summarizer({ model: "unused", defaultPrefix: "快讯", maxChineseChars: 72, timeoutMs: 1000 });
  const result = await summarizer.summarize({
    id: "2",
    source: "Yahoo股市",
    sourceKind: "rss",
    title: "美联储维持利率不变并重申关注通胀风险",
    description: "这是一整段很长的新闻正文，包含大量背景和重复信息。",
    preserveTitle: true,
    publishedAt: new Date().toISOString()
  });
  assert.equal(result, "快讯：美联储维持利率不变并重申关注通胀风险。");
});

test("removes links and keeps only the first useful sentence", () => {
  const result = selectUsefulText(
    "OpenAI发布安全更新。更多内容见 https://example.com/a",
    "第二段背景信息不应进入消息。",
    72
  );
  assert.equal(result, "OpenAI发布安全更新。");
});
