import { loadDotEnv } from "./env.js";
loadDotEnv();

import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { createLogger } from "./logger.js";
import { runPipelineCycle } from "./pipeline.js";
import { DiscordPublisher } from "./services/discord.js";
import { Summarizer } from "./services/summarizer.js";
import { ClsSource } from "./sources/cls-source.js";
import { GdeltSource } from "./sources/gdelt-source.js";
import { MarketMovesSource } from "./sources/market-moves-source.js";
import { PolymarketSource } from "./sources/polymarket-source.js";
import { RssSource } from "./sources/rss-source.js";
import { NewsStore } from "./store/news-store.js";

const logger = createLogger();
const config = loadConfig();
const store = new NewsStore(config.DATABASE_PATH);
const sources = createSources(config);
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
  if (running || shuttingDown) return;
  running = true;
  try {
    const result = await runPipelineCycle({ config, sources, store, summarizer, publisher, logger });
    healthState.lastCycleAt = new Date().toISOString();
    healthState.lastCycleOk = result.failedSources < sources.length;
    healthState.lastCycleResult = result;
    delete healthState.lastError;
    logger.info(result, "本轮新闻处理完成");
  } catch (error) {
    healthState.lastCycleAt = new Date().toISOString();
    healthState.lastCycleOk = false;
    healthState.lastError = error instanceof Error ? error.message : String(error);
    logger.error({ error: healthState.lastError }, "本轮处理异常");
  } finally {
    running = false;
  }
}

await cycle();
if (config.RUN_ONCE) {
  store.close();
  process.exit(0);
}

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
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

function createSources(config) {
  const sourcesConfig = config.sources;
  const result = [];
  if (sourcesConfig.cls.enabled) result.push(new ClsSource(sourcesConfig.cls));
  for (const source of sourcesConfig.rss) {
    if (source.enabled) result.push(new RssSource(source));
  }
  if (sourcesConfig.marketMoves.enabled && sourcesConfig.marketMoves.instruments.length) {
    result.push(new MarketMovesSource(sourcesConfig.marketMoves));
  }
  if (sourcesConfig.polymarket.enabled && config.OPENAI_API_KEY) {
    result.push(new PolymarketSource(sourcesConfig.polymarket));
  }
  if (sourcesConfig.gdelt.enabled && sourcesConfig.gdelt.queries.length && config.OPENAI_API_KEY) {
    result.push(new GdeltSource(sourcesConfig.gdelt));
  }
  if (!result.length) throw new Error("config/sources.json 中没有启用任何新闻源");
  return result;
}
