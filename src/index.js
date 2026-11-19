import { loadDotEnv } from "./env.js";
loadDotEnv();

import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { createLogger } from "./logger.js";
import { runPipelineCycle } from "./pipeline.js";
import { runDigestCycle } from "./digest.js";
import { digestDue, latestSlot } from "./services/digest-schedule.js";
import { ClaudeDigestWriter, HeadlineDigestWriter } from "./services/digest-writer.js";
import { DiscordPublisher } from "./services/discord.js";
import { Summarizer } from "./services/summarizer.js";
import { BlockBeatsSource } from "./sources/blockbeats-source.js";
import { ClsSource } from "./sources/cls-source.js";
import { GdeltSource } from "./sources/gdelt-source.js";
import { MarketMovesSource } from "./sources/market-moves-source.js";
import { PolymarketSource } from "./sources/polymarket-source.js";
import { RssSource } from "./sources/rss-source.js";
import { NewsStore } from "./store/news-store.js";
import { cycleIsHealthy } from "./services/freshness.js";
import fs from "node:fs";

const logger = createLogger();
const config = loadConfig();
const store = new NewsStore(config.DATABASE_PATH);
const pruned = config.DRY_RUN ? { processed: 0, sent: 0 } : store.prune();
if (pruned.processed || pruned.sent) logger.info(pruned, "已清理过期去重状态");
const digestConfig = config.sources.digest;
const claudeWriter = digestConfig.enabled && config.DIGEST_WRITER === "claude";
// Cards can include English sources because Claude translates them; the
// between-cards path cannot, so it never fetches them.
const sources = createSources(config, { english: Boolean(config.OPENAI_API_KEY) && !digestConfig.enabled });
const digestSources = digestConfig.enabled ? createSources(config, { english: claudeWriter || Boolean(config.OPENAI_API_KEY) }) : sources;
const digestWriter = claudeWriter ? new ClaudeDigestWriter({ model: config.DIGEST_MODEL }) : new HeadlineDigestWriter();
const fallbackWriter = new HeadlineDigestWriter();
const summarizer = new Summarizer({
  apiKey: config.OPENAI_API_KEY,
  model: config.OPENAI_MODEL,
  defaultPrefix: config.DEFAULT_PREFIX,
  maxChineseChars: config.MAX_CHINESE_CHARS,
  timeoutMs: config.REQUEST_TIMEOUT_MS
});
const publisher = new DiscordPublisher({
  webhookUrl: config.DISCORD_WEBHOOK_URL,
  username: config.DISCORD_USERNAME,
  avatarUrl: config.DISCORD_AVATAR_URL,
  includeSourceUrl: config.INCLUDE_SOURCE_URL,
  dryRun: config.DRY_RUN,
  timeoutMs: config.REQUEST_TIMEOUT_MS
});
const healthState = { startedAt: new Date().toISOString() };
const healthServer = config.RUN_ONCE ? undefined : startHealthServer(config.PORT, healthState, store);
let running = false;
let shuttingDown = false;

async function cycle() {
  if (running || shuttingDown) return undefined;
  running = true;
  try {
    const due = decideDigest();
    const result = due
      ? await runDigestCycle({ config, sources: digestSources, store, writer: digestWriter, fallbackWriter, publisher, logger, slot: due.slot })
      : await runPipelineCycle({ config: { ...config, BREAKING_ONLY: digestConfig.enabled }, sources, store, summarizer, publisher, logger });
    healthState.lastCycleAt = new Date().toISOString();
    healthState.lastCycleOk = cycleIsHealthy(result, sources.length);
    healthState.lastCycleResult = result;
    delete healthState.lastError;
    logger.info(result, "本轮新闻处理完成");
    return result;
  } catch (error) {
    healthState.lastCycleAt = new Date().toISOString();
    healthState.lastCycleOk = false;
    healthState.lastError = error instanceof Error ? error.message : String(error);
    logger.error({ error: healthState.lastError }, "本轮处理异常");
    return undefined;
  } finally {
    running = false;
  }
}

const firstResult = await cycle();
if (config.RUN_ONCE) {
  store.close();
  if (!cycleIsHealthy(firstResult, sources.length)) process.exitCode = 1;
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### 抓取与发送结果\n\n\`\`\`json\n${JSON.stringify(firstResult || { error: healthState.lastError }, null, 2)}\n\`\`\`\n`);
  }
} else {
  const timer = setInterval(() => void cycle(), config.POLL_INTERVAL_SECONDS * 1000);
  logger.info({ sourceCount: sources.length, intervalSeconds: config.POLL_INTERVAL_SECONDS, dryRun: config.DRY_RUN, health: `http://localhost:${config.PORT}/healthz` }, "中文金融快讯服务已启动");

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "正在关闭服务");
    clearInterval(timer);
    healthServer?.close();
    while (running) await new Promise((resolve) => setTimeout(resolve, 100));
    store.close();
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

function decideDigest() {
  if (!digestConfig.enabled) return undefined;
  if (config.FORCE_DIGEST) return { slot: latestSlot(digestConfig) };
  const due = digestDue(digestConfig, store.getState("last_digest_slot"));
  logger.info({ due: due.due, reason: due.reason, slot: due.slot?.key }, due.due ? "到点发送简报卡" : "非简报时段，只检查紧急事件");
  return due.due ? due : undefined;
}

function createSources(config, options = {}) {
  const sourcesConfig = config.sources;
  const result = [];
  if (sourcesConfig.cls.enabled) result.push(new ClsSource(sourcesConfig.cls));
  for (const source of sourcesConfig.rss) {
    if (source.enabled) result.push(new RssSource(source));
  }
  if (sourcesConfig.blockbeats.enabled) result.push(new BlockBeatsSource(sourcesConfig.blockbeats));
  if (sourcesConfig.marketMoves.enabled && sourcesConfig.marketMoves.instruments.length) {
    result.push(new MarketMovesSource(sourcesConfig.marketMoves));
  }
  // English sources are extras for the card; their outages are logged, not alerted.
  if (sourcesConfig.polymarket.enabled && options.english) {
    result.push(Object.assign(new PolymarketSource(sourcesConfig.polymarket), { optional: digestConfig.enabled }));
  }
  if (sourcesConfig.gdelt.enabled && sourcesConfig.gdelt.queries.length && options.english) {
    result.push(Object.assign(new GdeltSource(sourcesConfig.gdelt), { optional: digestConfig.enabled }));
  }
  if (!options.english && !digestConfig.enabled && (sourcesConfig.polymarket.enabled || sourcesConfig.gdelt.enabled)) {
    logger.warn({ polymarketEnabled: false, gdeltEnabled: false }, "未配置 OPENAI_API_KEY，英文来源未启用；中文来源继续运行");
  }
  if (!result.length) throw new Error("config/sources.json 中没有启用任何新闻源");
  return result;
}
