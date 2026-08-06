import { sha256 } from "./utils/hash.js";
import { matchesKeywordRules, normalizeForHash } from "./utils/text.js";
import { selectImportantItems } from "./services/importance.js";

export async function runPipelineCycle(deps) {
  const { config, sources, store, summarizer, publisher, logger } = deps;
  const fetchResults = await Promise.allSettled(sources.map(async (source) => ({ source: source.name, items: await source.fetch({ timeoutMs: config.REQUEST_TIMEOUT_MS }) })));
  const items = [];
  let failedSources = 0;
  for (const result of fetchResults) {
    if (result.status === "fulfilled") {
      logger.info({ source: result.value.source, count: result.value.items.length }, "新闻源抓取完成");
      items.push(...result.value.items);
    } else {
      failedSources += 1;
      logger.error({ error: errorToString(result.reason) }, "新闻源抓取失败");
    }
  }

  const now = Date.now();
  const maxAgeMs = config.MAX_NEWS_AGE_MINUTES * 60000;
  const eligible = items
    .filter((item) => {
      const publishedAt = new Date(item.publishedAt).getTime();
      return Number.isFinite(publishedAt) && now - publishedAt <= maxAgeMs && publishedAt <= now + 300000;
    })
    .filter((item) => matchesKeywordRules(item.title, item.description, config.includeKeywords, config.excludeKeywords))
    .filter((item) => !store.isProcessed(item.id));

  const { selected: candidates, evaluated } = selectImportantItems(eligible, {
    minScore: config.MIN_IMPORTANCE_SCORE,
    breakingScore: config.BREAKING_IMPORTANCE_SCORE,
    maxItems: config.MAX_ITEMS_PER_CYCLE,
    maxPerSource: config.MAX_ITEMS_PER_SOURCE
  });

  let filteredJunk = 0;
  let filteredLowImportance = 0;
  for (const { item, importance } of evaluated) {
    if (importance.shouldSend) continue;
    store.markProcessed(item, `filtered:${importance.reason}`);
    if (["junk", "generic-politics", "irrelevant-polymarket", "empty"].includes(importance.reason)) filteredJunk += 1;
    else filteredLowImportance += 1;
  }

  logger.info({
    eligible: eligible.length,
    selected: candidates.length,
    filteredJunk,
    filteredLowImportance,
    threshold: config.MIN_IMPORTANCE_SCORE
  }, "重要性筛选完成");

  let sent = 0;
  let duplicate = 0;
  let skippedNoAi = 0;
  for (const item of candidates) {
    const contentHash = sha256(normalizeForHash(`${item.title} ${item.description || ""}`));
    if (store.hasContentHash(contentHash)) {
      store.markProcessed(item, "duplicate");
      duplicate += 1;
      continue;
    }
    try {
      const message = await summarizer.summarize(item);
      if (!message) {
        skippedNoAi += 1;
        logger.warn({ source: item.source, title: item.title, score: item.importanceScore }, "英文新闻需要 OPENAI_API_KEY，暂未发送");
        continue;
      }
      const messageHash = sha256(normalizeForHash(message));
      if (store.hasMessageHash(messageHash)) {
        store.markProcessed(item, "duplicate");
        duplicate += 1;
        continue;
      }
      await publisher.publish({ ...item, message });
      if (config.DRY_RUN) store.markProcessed(item, "dry-run");
      else store.recordSent(item, contentHash, messageHash);
      sent += 1;
      logger.info({ source: item.source, score: item.importanceScore, message }, config.DRY_RUN ? "本地预览完成" : "已推送至 Discord");
    } catch (error) {
      logger.error({ source: item.source, title: item.title, score: item.importanceScore, error: errorToString(error) }, "处理新闻失败，将在下轮重试");
    }
  }
  return {
    fetched: items.length,
    eligible: eligible.length,
    candidates: candidates.length,
    sent,
    duplicate,
    skippedNoAi,
    filteredJunk,
    filteredLowImportance,
    failedSources
  };
}

function errorToString(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
