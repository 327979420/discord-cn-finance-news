import { loadDotEnv } from "./env.js";
loadDotEnv();
import { DiscordPublisher } from "./services/discord.js";

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) throw new Error("请先在 .env 中填写 DISCORD_WEBHOOK_URL");
const publisher = new DiscordPublisher({
  webhookUrl,
  username: process.env.DISCORD_USERNAME || "情报助手",
  avatarUrl: process.env.DISCORD_AVATAR_URL || undefined,
  includeSourceUrl: false,
  dryRun: false,
  timeoutMs: 20000
});
await publisher.publish({
  id: "test",
  source: "本地测试",
  sourceKind: "rss",
  title: "Webhook 测试",
  publishedAt: new Date().toISOString(),
  message: "快讯：中文金融新闻机器人连接成功。"
});
console.log("测试消息已发送。请检查 Discord 频道。");
