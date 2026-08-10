import { sha256 } from "../utils/hash.js";
import { fetchWithTimeout } from "../utils/http.js";
import { safeIsoDate } from "../utils/text.js";

export class PolymarketSource {
  constructor(options) {
    this.name = "Polymarket";
    this.limit = options.limit;
    this.minVolume = options.minVolume;
    this.minHourPriceChange = options.minHourPriceChange ?? 0.08;
    this.minDayPriceChange = options.minDayPriceChange ?? 0.15;
  }

  async fetch(context) {
    const url = new URL("https://gamma-api.polymarket.com/events");
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(this.limit));
    url.searchParams.set("order", "volume");
    url.searchParams.set("ascending", "false");
    if (this.minVolume > 0) url.searchParams.set("volume_min", String(this.minVolume));

    const response = await fetchWithTimeout(url, { headers: { "user-agent": "discord-cn-finance-news/0.2" } }, context.timeoutMs);
    if (!response.ok) throw new Error(`Polymarket 请求失败：${response.status} ${response.statusText}`);
    const events = await response.json();
    return Array.isArray(events) ? events.flatMap((event) => this.eventToMoves(event)) : [];
  }

  eventToMoves(event) {
    if (!event?.id || !event?.title || !Array.isArray(event.markets)) return [];
    if (looksLikeSports(event)) return [];

    const eventVolume = numeric(event.volume);
    if (eventVolume < this.minVolume) return [];

    return event.markets.flatMap((market) => {
      const hourChange = numericOrUndefined(market?.oneHourPriceChange);
      const dayChange = numericOrUndefined(market?.oneDayPriceChange);
      const hourStrength = hourChange === undefined || this.minHourPriceChange <= 0 ? 0 : Math.abs(hourChange) / this.minHourPriceChange;
      const dayStrength = dayChange === undefined || this.minDayPriceChange <= 0 ? 0 : Math.abs(dayChange) / this.minDayPriceChange;
      if (hourStrength < 1 && dayStrength < 1) return [];

      const basis = hourStrength >= dayStrength ? "1h" : "24h";
      const change = basis === "1h" ? hourChange : dayChange;
      const threshold = basis === "1h" ? this.minHourPriceChange : this.minDayPriceChange;
      if (change === undefined || threshold <= 0) return [];

      const currentProbability = firstOutcomeProbability(market?.outcomePrices);
      const changePp = change * 100;
      const direction = changePp >= 0 ? "上升" : "下降";
      const level = Math.max(1, Math.floor(Math.abs(change) / threshold));
      const updatedAt = safeIsoDate(market?.updatedAt || event?.updatedAt || new Date().toISOString());
      const timestamp = new Date(updatedAt).getTime();
      const bucket = basis === "1h"
        ? Math.floor(timestamp / 3600000)
        : new Date(timestamp).toISOString().slice(0, 10);
      const marketId = market?.id || market?.conditionId || market?.slug || event.id;
      const eventUrl = event.slug ? `https://polymarket.com/event/${event.slug}` : undefined;
      const subject = market?.question || event.title;
      const probabilityText = currentProbability === undefined ? "" : `，当前概率约${Math.round(currentProbability * 100)}%`;
      const description = `Polymarket概率${basis === "1h" ? "1小时" : "24小时"}${direction}${Math.abs(changePp).toFixed(1)}个百分点${probabilityText}；事件成交量约$${compactNumber(eventVolume)}`;
      const strength = Math.max(hourStrength, dayStrength);

      return [{
        id: `polymarket-move:${sha256(`${marketId}:${basis}:${direction}:${level}:${bucket}`)}`,
        source: this.name,
        sourceKind: "polymarket_move",
        title: subject,
        description,
        ...(eventUrl ? { url: eventUrl } : {}),
        ...((event.image || event.icon) ? { imageUrl: event.image || event.icon } : {}),
        publishedAt: updatedAt,
        language: "en",
        polymarketMovement: true,
        polymarketChangePp: changePp,
        polymarketVolume: eventVolume,
        importanceHint: Math.min(100, Math.round(74 + Math.min(24, Math.max(0, strength - 1) * 12)))
      }];
    });
  }
}

function firstOutcomeProbability(value) {
  if (!value) return undefined;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) return undefined;
  const number = Number(parsed[0]);
  return Number.isFinite(number) ? number : undefined;
}

function looksLikeSports(event) {
  const text = `${event.category || ""} ${event.title || ""}`.toLowerCase();
  return /sports|esports|nba|nfl|nhl|mlb|soccer|football|tennis|ufc|f1|formula 1|champions league|premier league/.test(text);
}

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function numericOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function compactNumber(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}
