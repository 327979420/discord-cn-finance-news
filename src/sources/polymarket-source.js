import { fetchWithTimeout } from "../utils/http.js";
import { safeIsoDate } from "../utils/text.js";

export class PolymarketSource {
  constructor(options) {
    this.name = "Polymarket";
    this.limit = options.limit;
    this.minVolume = options.minVolume;
  }

  async fetch(context) {
    const url = new URL("https://gamma-api.polymarket.com/events/keyset");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(this.limit));
    url.searchParams.set("ascending", "false");
    const response = await fetchWithTimeout(url, { headers: { "user-agent": "discord-cn-finance-news/0.1" } }, context.timeoutMs);
    if (!response.ok) throw new Error(`Polymarket 请求失败：${response.status} ${response.statusText}`);
    const data = await response.json();
    return (data.events || [])
      .filter((event) => event?.id && event?.title)
      .filter((event) => numeric(event.volume) >= this.minVolume)
      .map((event) => ({
        id: `polymarket:${event.id}`,
        source: this.name,
        sourceKind: "polymarket",
        title: event.title,
        ...((event.subtitle || event.description) ? { description: [event.subtitle, event.description].filter(Boolean).join(" — ") } : {}),
        ...(event.slug ? { url: `https://polymarket.com/event/${event.slug}` } : {}),
        ...((event.image || event.icon) ? { imageUrl: event.image || event.icon } : {}),
        publishedAt: safeIsoDate(event.createdAt || event.creationDate || event.published_at),
        language: "en"
      }));
  }
}

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}
