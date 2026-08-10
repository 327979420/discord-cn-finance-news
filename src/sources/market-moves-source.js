import { sha256 } from "../utils/hash.js";
import { fetchWithTimeout } from "../utils/http.js";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export class MarketMovesSource {
  constructor(options = {}) {
    this.name = "全球市场异动";
    this.instruments = Array.isArray(options.instruments) ? options.instruments : [];
    this.interval = options.interval || "5m";
    this.range = options.range || "1d";
    this.concurrency = options.concurrency || 5;
  }

  async fetch(context) {
    const output = [];
    const failures = [];
    let successfulProbes = 0;

    for (let start = 0; start < this.instruments.length; start += this.concurrency) {
      const chunk = this.instruments.slice(start, start + this.concurrency);
      const results = await Promise.allSettled(chunk.map((instrument) => this.fetchInstrument(instrument, context.timeoutMs)));
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          successfulProbes += 1;
          if (result.value) output.push(result.value);
          return;
        }
        failures.push({
          symbol: chunk[index]?.symbol || "unknown",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      });
    }

    if (failures.length === this.instruments.length && this.instruments.length > 0) {
      throw new Error(`全球行情探针全部失败：${failures.slice(0, 3).map((item) => `${item.symbol} ${item.error}`).join("；")}`);
    }

    console.log(JSON.stringify({
      time: new Date().toISOString(),
      level: failures.length ? "warn" : "info",
      message: "全球行情探针完成",
      probes: this.instruments.length,
      successfulProbes,
      failedProbes: failures.length,
      alerts: output.length,
      ...(failures.length ? { sampleFailures: failures.slice(0, 3) } : {})
    }));

    return output;
  }

  async fetchInstrument(instrument, timeoutMs) {
    const url = new URL(`${YAHOO_CHART_BASE}/${encodeURIComponent(instrument.symbol)}`);
    url.searchParams.set("range", this.range);
    url.searchParams.set("interval", this.interval);
    url.searchParams.set("includePrePost", "true");
    url.searchParams.set("events", "div,splits");

    const response = await fetchWithTimeout(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36"
      }
    }, timeoutMs);
    if (!response.ok) throw new Error(`${instrument.symbol} 行情请求失败：${response.status} ${response.statusText}`);
    const payload = await response.json();
    return detectMarketMove(payload, instrument);
  }
}

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
  const meta = result.meta || {};
  const previousClose = firstFinite(meta.chartPreviousClose, meta.previousClose);
  const dayPct = previousClose > 0 ? percentageChange(latest.close, previousClose) : undefined;

  const suddenMinutes = instrument.suddenMinutes || 30;
  const targetTimestamp = latest.timestamp - suddenMinutes * 60;
  let reference = points[0];
  for (const point of points) {
    if (point.timestamp <= targetTimestamp) reference = point;
    else break;
  }
  const suddenPct = reference && reference.timestamp < latest.timestamp
    ? percentageChange(latest.close, reference.close)
    : undefined;

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
  const title = `${instrument.name}${ticker}${scope}${direction}${formatPercent(absPct)}`;
  const latestMs = latest.timestamp * 1000;
  const sessionDate = new Date(latestMs).toISOString().slice(0, 10);
  const level = Math.max(1, Math.floor(absPct / threshold));
  const timeBucket = basis === "sudden" ? Math.floor(latest.timestamp / 3600) : sessionDate;
  const id = `market:${sha256(`${instrument.symbol}:${basis}:${direction}:${level}:${timeBucket}`)}`;
  const source = instrument.group === "stock"
    ? "明星股异动"
    : instrument.group === "cross-asset" ? "跨资产异动" : "全球指数异动";
  const strength = Math.max(dayStrength, suddenStrength);
  const importanceHint = Math.min(100, Math.round(72 + Math.min(24, Math.max(0, strength - 1) * 14)));

  if (now - latestMs > 3 * 60 * 60 * 1000) return undefined;

  return {
    id,
    source,
    sourceKind: "market",
    title,
    description: [
      Number.isFinite(dayPct) ? `当日${dayPct >= 0 ? "上涨" : "下跌"}${formatPercent(Math.abs(dayPct))}` : "",
      Number.isFinite(suddenPct) ? `${suddenMinutes}分钟变动${suddenPct >= 0 ? "+" : "-"}${formatPercent(Math.abs(suddenPct))}` : ""
    ].filter(Boolean).join("；"),
    publishedAt: new Date(latestMs).toISOString(),
    language: "zh",
    marketMovePct: changePct,
    marketMoveBasis: basis,
    assetType: instrument.type || instrument.group || "market",
    importanceHint
  };
}

function percentageChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return undefined;
  return (current / previous - 1) * 100;
}

function formatPercent(value) {
  const digits = value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/g, "")}%`;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}
