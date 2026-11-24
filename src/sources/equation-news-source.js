// EquationNews (方程式新闻, eqn.news): free public REST API, no key.
// Simplified-Chinese newswire headlines (tradfi: Bloomberg/CNBC-style flashes),
// US stock and crypto big-move monitors, and crypto news (main). Each channel is
// paged back with `before` until the lookback window, so a digest card sees the
// whole period, not only the latest page. Items in `ai.overview` are written by
// EquationNews's own AI web search; they are passed on as labelled background.

import { fetchWithTimeout, sleep } from "../utils/http.js";

const API = "https://api.eqn.news/public/v1/news";
const PAGE_SIZE = 50;
// Exchange listing and notice feeds also appear in `main`; they are not news for this group.
const NOTICE_CHANNELS = new Set(["binance", "korea", "tier2", "tier3", "alpha", "hl", "earn"]);
const NOTICE_SOURCE = /listing|binance|bitget|okx|bybit|upbit|bithumb|coinbase|gate|kucoin/i;
const MAX_BACKGROUND_CHARS = 400;

export class EquationNewsSource {
  constructor(options = {}) {
    this.name = "方程式新闻";
    this.channels = options.channels || [];
    this.lookbackHours = options.lookbackHours ?? 18;
    this.maxPages = options.maxPages ?? 4;
  }

  async fetch(context) {
    const since = Date.now() - this.lookbackHours * 3600000;
    const output = [];
    const failures = [];
    for (const channel of this.channels) {
      try {
        output.push(...await this.fetchChannel(channel, since, context.timeoutMs));
      } catch (error) {
        failures.push(`${channel.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length === this.channels.length && this.channels.length) {
      throw new Error(`方程式新闻全部频道失败：${failures.join("；")}`);
    }
    return output;
  }

  async fetchChannel(channel, since, timeoutMs) {
    const items = [];
    let before;
    for (let page = 0; page < this.maxPages; page += 1) {
      const url = new URL(API);
      url.searchParams.set("channel", channel.key);
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (before) url.searchParams.set("before", before);
      const response = await fetchWithTimeout(url, {
        headers: { accept: "application/json", "user-agent": "discord-cn-finance-news/0.2" }
      }, timeoutMs);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      const pageItems = Array.isArray(data.items) ? data.items : [];
      items.push(...pageItems.map((raw) => toNewsItem(raw, channel)).filter(Boolean));
      const oldest = Math.min(...pageItems.map((raw) => Date.parse(raw.time)).filter(Number.isFinite));
      if (!data.next_cursor || !pageItems.length || !(oldest > since)) break;
      before = data.next_cursor;
      await sleep(300); // well inside the 10 requests/second limit
    }
    return items.filter((item) => Date.parse(item.publishedAt) >= since);
  }
}

// Bloomberg-style flashes start with "*" and may hold several lines; keep them as one headline.
export function cleanHeadline(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\*+\s*/, "").trim())
    .filter((line) => line && !/^\$[A-Z.]+(\s+\$[A-Z.]+)*$/.test(line))
    .join("；")
    .replace(/\s+/g, " ")
    .trim();
}

export function backgroundText(ai) {
  const points = (ai?.summary?.points || []).map((point) => point?.zh).filter(Boolean);
  const overview = ai?.overview?.status === "ready" ? (ai.overview.zh?.paragraphs || []).map((p) => p?.text).filter(Boolean) : [];
  const parts = [...points, ...overview];
  if (!parts.length) return "";
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return `背景（方程式AI检索，仅供参考）：${text.length > MAX_BACKGROUND_CHARS ? `${text.slice(0, MAX_BACKGROUND_CHARS)}…` : text}`;
}

export function toNewsItem(raw, channel) {
  if (!raw || !Number.isFinite(Date.parse(raw.time))) return undefined;
  const channels = Array.isArray(raw.channels) ? raw.channels : [];
  if (channels.some((key) => NOTICE_CHANNELS.has(key)) || NOTICE_SOURCE.test(String(raw.source || ""))) return undefined;
  const title = cleanHeadline(raw.zh || "");
  if (!title || title.length < 6) return undefined;
  const description = backgroundText(raw.ai);
  return {
    id: `eqn:${raw.no}`,
    source: channel.name,
    sourceKind: "rss",
    title,
    ...(description ? { description } : {}),
    ...(raw.url ? { url: raw.url } : {}),
    publishedAt: new Date(raw.time).toISOString(),
    timestampReliable: true,
    language: "zh",
    ...(Number.isFinite(channel.importanceHint) ? { importanceHint: channel.importanceHint } : {})
  };
}
