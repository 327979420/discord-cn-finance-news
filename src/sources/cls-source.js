import { createHash } from "node:crypto";
import { sha256 } from "../utils/hash.js";
import { fetchWithTimeout } from "../utils/http.js";
import { safeIsoDate, stripHtml } from "../utils/text.js";

const ROOT_URL = "https://www.cls.cn";

export class ClsSource {
  constructor(options = {}) {
    this.name = "财联社电报";
    this.limit = options.limit || 50;
  }

  async fetch(context) {
    const url = buildClsTelegraphUrl();
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          accept: "application/json, text/plain, */*",
          referer: `${ROOT_URL}/telegraph`,
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36"
        }
      },
      context.timeoutMs
    );

    if (!response.ok) {
      throw new Error(`财联社请求失败：${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const rows = payload?.data?.roll_data;
    if (!Array.isArray(rows)) {
      throw new Error("财联社返回的数据格式不符合预期");
    }

    return rows.slice(0, this.limit).map((item) => normalizeItem(item));
  }
}

export function buildClsTelegraphUrl() {
  const params = new URLSearchParams({
    appName: "CailianpressWeb",
    name: "telegraph",
    os: "web",
    sv: "8.7.9"
  });
  params.sort();
  const sha1 = createHash("sha1").update(params.toString()).digest("hex");
  const sign = createHash("md5").update(sha1).digest("hex");
  params.append("sign", sign);
  return `${ROOT_URL}/api/cache?${params.toString()}`;
}

function normalizeItem(item) {
  const title = stripHtml(item.title || item.content || "财联社快讯");
  const content = stripHtml(item.content || "");
  const publishedAt = timestampToIso(item.ctime);
  const stablePart = item.id || item.roll_id || item.shareurl || `${item.ctime}:${title}`;

  return {
    id: `cls:${sha256(String(stablePart))}`,
    source: "财联社电报",
    sourceKind: "cls",
    title,
    ...(content && content !== title ? { description: content } : {}),
    ...(item.shareurl ? { url: item.shareurl } : {}),
    ...(Array.isArray(item.images) && item.images[0] ? { imageUrl: item.images[0] } : {}),
    publishedAt,
    language: "zh"
  };
}

function timestampToIso(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return new Date(number < 1_000_000_000_000 ? number * 1000 : number).toISOString();
  }
  return safeIsoDate(value);
}
