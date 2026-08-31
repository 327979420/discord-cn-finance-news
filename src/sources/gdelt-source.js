import { sha256 } from "../utils/hash.js";
import { fetchWithTimeout } from "../utils/http.js";
import { parseGdeltDate } from "../utils/text.js";

export class GdeltSource {
  constructor(options) {
    this.name = "GDELT";
    this.queries = options.queries;
    this.maxRecordsPerQuery = options.maxRecordsPerQuery;
  }

  async fetch(context) {
    const results = await Promise.allSettled(this.queries.map((query) => this.fetchQuery(query, context.timeoutMs)));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length === results.length && results.length) {
      const reasons = failures.map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      throw new Error(`GDELT 所有查询均失败：${reasons.join("；")}`);
    }
    return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  async fetchQuery(query, timeoutMs) {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("maxrecords", String(this.maxRecordsPerQuery));
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    const response = await fetchWithTimeout(url, { headers: { "user-agent": "discord-cn-finance-news/0.1" } }, timeoutMs);
    if (!response.ok) throw new Error(`GDELT 请求失败：${response.status} ${response.statusText}`);
    const data = await response.json();
    return (data.articles || []).filter((article) => article?.title && (article.url || article.url_mobile)).map((article) => {
      const articleUrl = article.url || article.url_mobile;
      return {
        id: `gdelt:${sha256(articleUrl)}`,
        source: article.domain ? `GDELT · ${article.domain}` : this.name,
        sourceKind: "gdelt",
        title: article.title,
        url: articleUrl,
        ...(article.socialimage ? { imageUrl: article.socialimage } : {}),
        publishedAt: parseGdeltDate(article.seendate),
        ...(article.language ? { language: article.language } : {})
      };
    });
  }
}
