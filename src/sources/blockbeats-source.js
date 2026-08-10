import { sha256 } from "../utils/hash.js";
import { fetchWithTimeout } from "../utils/http.js";
import { stripHtml } from "../utils/text.js";

const DEFAULT_URL = "https://www.theblockbeats.info/newsflash/";

export class BlockBeatsSource {
  constructor(options = {}) {
    this.name = "BlockBeats快讯";
    this.url = options.url || DEFAULT_URL;
    this.limit = options.limit || 30;
  }

  async fetch(context) {
    const response = await fetchWithTimeout(this.url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36"
      }
    }, context.timeoutMs);
    if (!response.ok) throw new Error(`BlockBeats 请求失败：${response.status} ${response.statusText}`);
    return parseBlockBeats(await response.text(), this.limit);
  }
}

export function parseBlockBeats(html, limit = 30, now = new Date()) {
  const headings = [...String(html).matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => stripHtml(match[1]))
    .map((text) => text.replace(/^\d{1,2}:\d{2}\s+/, "").trim())
    .filter(Boolean)
    .filter((text) => !isPageChrome(text));

  const unique = [...new Set(headings)].slice(0, limit);
  return unique.map((title) => ({
    id: `blockbeats:${sha256(title)}`,
    source: "BlockBeats快讯",
    sourceKind: "rss",
    title,
    publishedAt: now.toISOString(),
    language: "zh"
  }));
}

function isPageChrome(text) {
  return [
    "加密事件日历", "链上侦探持续监控", "24H重要资讯", "重要快讯", "热门文章"
  ].some((label) => text === label || text.startsWith(label));
}
