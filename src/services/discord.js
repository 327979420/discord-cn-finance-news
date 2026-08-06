import { fetchWithTimeout, sleep } from "../utils/http.js";

export class DiscordPublisher {
  constructor(options) {
    this.options = options;
  }

  async publish(item) {
    const content = this.options.includeSourceUrl && item.url ? `${item.message}\n${item.url}` : item.message;
    if (this.options.dryRun) {
      console.log(`\n[DRY RUN] ${content}${item.imageUrl ? `\n图片：${item.imageUrl}` : ""}\n`);
      return;
    }
    if (!this.options.webhookUrl) throw new Error("Discord Webhook 未配置");
    const payload = {
      content,
      username: this.options.username,
      ...(this.options.avatarUrl ? { avatar_url: this.options.avatarUrl } : {}),
      allowed_mentions: { parse: [] },
      ...(item.imageUrl ? { embeds: [{ image: { url: item.imageUrl } }] } : {})
    };
    await this.executeWebhook(payload);
  }

  async executeWebhook(payload) {
    const url = new URL(this.options.webhookUrl);
    url.searchParams.set("wait", "true");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }, this.options.timeoutMs);
      if (response.ok) return;
      const body = await response.text();
      if (response.status === 429 && attempt < 3) {
        await sleep(readRetryAfter(body) || 1500 * attempt);
        continue;
      }
      throw new Error(`Discord Webhook 发送失败：${response.status} ${body}`);
    }
  }
}

function readRetryAfter(body) {
  try {
    const retryAfter = JSON.parse(body).retry_after;
    if (typeof retryAfter !== "number") return undefined;
    return retryAfter > 100 ? retryAfter : retryAfter * 1000;
  } catch {
    return undefined;
  }
}
