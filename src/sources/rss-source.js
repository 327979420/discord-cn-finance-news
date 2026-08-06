import { sha256 } from "../utils/hash.js";
import { fetchWithTimeout } from "../utils/http.js";
import { decodeXml, extractFirstImageUrl, safeIsoDate, stripHtml } from "../utils/text.js";

export class RssSource {
  constructor(options) {
    this.name = options.name;
    this.url = options.url;
    this.language = options.language;
  }

  async fetch(context) {
    const response = await fetchWithTimeout(this.url, {
      headers: { "user-agent": "discord-cn-finance-news/0.1" }
    }, context.timeoutMs);
    if (!response.ok) throw new Error(`RSS 请求失败：${response.status} ${response.statusText}`);
    return parseFeed(await response.text(), { name: this.name, language: this.language });
  }
}

export function parseFeed(xml, source) {
  const isAtom = /<feed[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return blocks.map((block) => parseItem(block, source, isAtom)).filter(Boolean);
}

function parseItem(block, source, isAtom) {
  const title = stripHtml(tag(block, "title"));
  if (!title) return undefined;
  const descriptionRaw = firstNonEmpty(tag(block, "content:encoded"), tag(block, "description"), tag(block, "content"), tag(block, "summary"));
  const description = stripHtml(descriptionRaw);
  const url = isAtom ? attribute(block, "link", "href") || tag(block, "link") : tag(block, "link") || attribute(block, "link", "href");
  const guid = firstNonEmpty(tag(block, "guid"), tag(block, "id"));
  const date = firstNonEmpty(tag(block, "pubDate"), tag(block, "published"), tag(block, "updated"), tag(block, "dc:date"));
  const imageUrl = firstNonEmpty(
    imageEnclosure(block),
    attribute(block, "media:content", "url"),
    attribute(block, "media:thumbnail", "url"),
    extractFirstImageUrl(descriptionRaw)
  );
  const publishedAt = safeIsoDate(decodeXml(date));
  const stableId = decodeXml(guid || url || `${title}:${publishedAt}`);
  return {
    id: `rss:${sha256(`${source.name}:${stableId}`)}`,
    source: source.name,
    sourceKind: "rss",
    title,
    ...(description ? { description } : {}),
    ...(url ? { url: decodeXml(url).trim() } : {}),
    ...(imageUrl ? { imageUrl: decodeXml(imageUrl).trim() } : {}),
    publishedAt,
    ...(source.language ? { language: source.language } : {})
  };
}

function tag(block, name) {
  const escaped = name.replace(":", "\\:");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1]?.trim() || "";
}

function attribute(block, tagName, attributeName) {
  const escaped = tagName.replace(":", "\\:");
  const match = block.match(new RegExp(`<${escaped}\\b[^>]*\\b${attributeName}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] || "";
}

function imageEnclosure(block) {
  const tags = [...block.matchAll(/<enclosure\b[^>]*>/gi)].map((match) => match[0]);
  for (const item of tags) {
    const type = item.match(/\btype=["']([^"']+)["']/i)?.[1] || "";
    const url = item.match(/\burl=["']([^"']+)["']/i)?.[1];
    if (url && (!type || type.startsWith("image/"))) return url;
  }
  return "";
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}
