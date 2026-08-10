import { sha256 } from "../utils/hash.js";
import { fetchWithTimeout, sleep } from "../utils/http.js";
import { stripHtml } from "../utils/text.js";

const MARKET_PAGES = [
  { key: "index", url: "https://tw.stock.yahoo.com/world-indices" },
  { key: "stock", url: "https://tw.stock.yahoo.com/us-market" },
  { key: "commodity", url: "https://tw.stock.yahoo.com/commodities" },
  { key: "crypto", url: "https://tw.stock.yahoo.com/cryptocurrencies" }
];

export class MarketMovesSource {
  constructor(options = {}) {
    this.name = "全球市场异动";
    this.instruments = Array.isArray(options.instruments) ? options.instruments : [];
  }

  async fetch(context) {
    const pageTexts = new Map();
    const failures = [];

    for (const page of MARKET_PAGES) {
      try {
        const response = await fetchWithTimeout(page.url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "zh-TW,zh;q=0.9,en;q=0.6",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36"
          }
        }, context.timeoutMs);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        pageTexts.set(page.key, stripHtml(await response.text()));
      } catch (error) {
        failures.push(`${page.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await sleep(350);
    }

    if (!pageTexts.size) throw new Error(`Yahoo公开行情页面全部失败：${failures.join("；")}`);

    const now = new Date();
    const output = [];
    let foundQuotes = 0;
    for (const instrument of this.instruments) {
      const pageKey = pageKeyForInstrument(instrument);
      if (!pageKey) continue;
      const text = pageTexts.get(pageKey);
      if (!text) continue;
      const quote = extractQuote(text, instrument.symbol);
      if (!quote) continue;
      foundQuotes += 1;
      const item = detectDailyPageMove(quote, instrument, now);
      if (item) output.push(item);
    }

    console.log(JSON.stringify({
      time: now.toISOString(),
      level: failures.length ? "warn" : "info",
      message: "Yahoo公开行情雷达完成",
      pages: pageTexts.size,
      failedPages: failures.length,
      configuredInstruments: this.instruments.length,
      foundQuotes,
      alerts: output.length,
      ...(failures.length ? { failures } : {})
    }));

    return output;
  }
}

export function extractQuote(text, symbol) {
  const index = String(text).indexOf(symbol);
  if (index < 0) return undefined;
  const segment = String(text).slice(index + symbol.length, index + symbol.length + 260);
  const match = segment.match(/([0-9][0-9,.]*)\s+([+-]?[0-9][0-9,.]*)\s+([+-]?\d+(?:\.\d+)?)%/);
  if (!match) return undefined;

  const price = numberFrom(match[1]);
  const absoluteChange = numberFrom(match[2]);
  let changePct = Number(match[3]);
  if (!Number.isFinite(price) || !Number.isFinite(absoluteChange) || !Number.isFinite(changePct)) return undefined;
  if (absoluteChange < 0 && changePct > 0) changePct *= -1;
  return { price, absoluteChange, changePct };
}

export function detectDailyPageMove(quote, instrument, now = new Date()) {
  const threshold = Number(instrument.dayThreshold || 0);
  const changePct = Number(quote?.changePct);
  if (!Number.isFinite(changePct) || threshold <= 0 || Math.abs(changePct) < threshold) return undefined;

  const direction = changePct >= 0 ? "涨" : "跌";
  const absPct = Math.abs(changePct);
  const ticker = instrument.type === "stock" ? `（${instrument.symbol}）` : "";
  const title = `${instrument.name}${ticker}日内${direction}${formatPercent(absPct)}`;
  const sessionDate = now.toISOString().slice(0, 10);
  const level = Math.max(1, Math.floor(absPct / threshold));
  const id = `market:${sha256(`${instrument.symbol}:day:${direction}:${level}:${sessionDate}`)}`;
  const source = instrument.group === "stock"
    ? "明星股异动"
    : instrument.group === "cross-asset" ? "跨资产异动" : "全球指数异动";
  const strength = absPct / threshold;

  return {
    id,
    source,
    sourceKind: "market",
    title,
    description: `最新价${quote.price}；日内${direction}${formatPercent(absPct)}`,
    publishedAt: now.toISOString(),
    language: "zh",
    marketMovePct: changePct,
    marketMoveBasis: "day",
    assetType: instrument.type || instrument.group || "market",
    importanceHint: Math.min(100, Math.round(74 + Math.min(22, Math.max(0, strength - 1) * 14)))
  };
}

function pageKeyForInstrument(instrument) {
  if (instrument.group === "index" || instrument.type === "index") return "index";
  if (instrument.group === "stock" || instrument.type === "stock") return "stock";
  if (instrument.type === "commodity") return "commodity";
  if (instrument.type === "crypto") return "crypto";
  return undefined;
}

function numberFrom(value) {
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : undefined;
}

function formatPercent(value) {
  const digits = value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/g, "")}%`;
}

// Legacy chart helper retained for unit-test compatibility. Runtime no longer calls Yahoo's chart endpoint.
export function detectMarketMove(payload, instrument, now = Date.now()) {
  const result = payload?.chart?.result?.[0];
  if (!result) return undefined;
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes) || !timestamps.length) return undefined;
  const points = timestamps
    .map((timestamp, index) => ({ timestamp: Number(timestamp), close: Number(closes[index]) }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.close) && point.close > 0);
  if (points.length < 2) return undefined;

  const latest = points.at(-1);
  const previousClose = firstFinite(result.meta?.chartPreviousClose, result.meta?.previousClose);
  const dayPct = previousClose > 0 ? percentageChange(latest.close, previousClose) : undefined;
  const suddenMinutes = instrument.suddenMinutes || 30;
  const targetTimestamp = latest.timestamp - suddenMinutes * 60;
  let reference = points[0];
  for (const point of points) {
    if (point.timestamp <= targetTimestamp) reference = point;
    else break;
  }
  const suddenPct = reference && reference.timestamp < latest.timestamp ? percentageChange(latest.close, reference.close) : undefined;
  const dayThreshold = Number(instrument.dayThreshold || 0);
  const suddenThreshold = Number(instrument.suddenThreshold || 0);
  const dayStrength = Number.isFinite(dayPct) && dayThreshold > 0 ? Math.abs(dayPct) / dayThreshold : 0;
  const suddenStrength = Number.isFinite(suddenPct) && suddenThreshold > 0 ? Math.abs(suddenPct) / suddenThreshold : 0;
  if (dayStrength < 1 && suddenStrength < 1) return undefined;

  const basis = suddenStrength >= dayStrength ? "sudden" : "day";
  const changePct = basis === "sudden" ? suddenPct : dayPct;
  const threshold = basis === "sudden" ? suddenThreshold : dayThreshold;
  if (!Number.isFinite(changePct) || threshold <= 0) return undefined;
  const direction = changePct >= 0 ? "涨" : "跌";
  const absPct = Math.abs(changePct);
  const scope = basis === "sudden" ? `过去${suddenMinutes}分钟` : "日内";
  const ticker = instrument.type === "stock" ? `（${instrument.symbol}）` : "";
  const latestMs = latest.timestamp * 1000;
  if (now - latestMs > 3 * 60 * 60 * 1000) return undefined;
  return {
    id: `market:${sha256(`${instrument.symbol}:${basis}:${direction}:${Math.max(1, Math.floor(absPct / threshold))}:${Math.floor(latest.timestamp / 3600)}`)}`,
    source: instrument.group === "stock" ? "明星股异动" : instrument.group === "cross-asset" ? "跨资产异动" : "全球指数异动",
    sourceKind: "market",
    title: `${instrument.name}${ticker}${scope}${direction}${formatPercent(absPct)}`,
    publishedAt: new Date(latestMs).toISOString(),
    language: "zh",
    marketMovePct: changePct,
    marketMoveBasis: basis,
    assetType: instrument.type || instrument.group || "market",
    importanceHint: 80
  };
}

function percentageChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return undefined;
  return (current / previous - 1) * 100;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}
