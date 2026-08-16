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
  const raw = String(html);
  // The page puts its main/important newsflash stream before the event calendar.
  // Everything after that includes chain-whale monitoring and 24H recaps, which we do not want.
  const cutoff = raw.indexOf("加密事件日历");
  const mainStream = cutoff >= 0 ? raw.slice(0, cutoff) : raw;

  const headings = [...mainStream.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => stripHtml(match[1]))
    .map((text) => {
      const time = text.match(/^(\d{1,2}):(\d{2})\s+/);
      return { title: text.replace(/^\d{1,2}:\d{2}\s+/, "").trim(), time };
    })
    .filter(({ title }) => title && !isPageChrome(title));

  const unique = [...new Map(headings.map((entry) => [entry.title, entry])).values()].slice(0, limit);
  return unique.map(({ title, time }) => ({
    id: `blockbeats:${sha256(title)}`,
    source: "BlockBeats快讯",
    sourceKind: "rss",
    title,
    publishedAt: time ? blockBeatsTimeToIso(time, now) : now.toISOString(),
    timestampReliable: Boolean(time),
    language: "zh"
  }));
}

function blockBeatsTimeToIso(match, now) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  let inferred = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
  if (inferred.getTime() - now.getTime() > 2 * 60 * 60 * 1000) inferred = new Date(inferred.getTime() - 86400000);
  return inferred.toISOString();
}

function isPageChrome(text) {
  return ["重要快讯", "热门文章"].some((label) => text === label || text.startsWith(label));
}
