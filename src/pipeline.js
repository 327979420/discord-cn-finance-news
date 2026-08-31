import { sha256 } from "./utils/hash.js";
import { matchesKeywordRules, normalizeForHash, normalizeNewsFingerprint } from "./utils/text.js";
import { selectImportantItems } from "./services/importance.js";

export async function runPipelineCycle(deps) {
  const { config, sources, store, summarizer, publisher, logger } = deps;
  const fetchResults = await Promise.all(sources.map(async (source) => {
    try {
      return { ok: true, source: source.name, items: await source.fetch({ timeoutMs: config.REQUEST_TIMEOUT_MS }) };
    } catch (error) {
      return { ok: false, source: source.name, error };
    }
  }));
  const items = [];
  let failedSources = 0;
  for (const result of fetchResults) {
    if (result.ok) {
      logger.info({ source: result.source, count: result.items.length }, "新闻源抓取完成");
      items.push(...result.items);
    } else {
      failedSources += 1;
      logger.error({ source: result.source, error: errorToString(result.error) }, "新闻源抓取失败");
    }
  }

  const now = Date.now();
  const maxAgeMs = config.MAX_NEWS_AGE_MINUTES * 60000;
  const eligible = items
    .filter((item) => {
      const publishedAt = new Date(item.publishedAt).getTime();
      const reliableTimestamp = item.sourceKind === "market" || item.sourceKind === "polymarket_move" || item.timestampReliable !== false;
      return reliableTimestamp && Number.isFinite(publishedAt) && now - publishedAt <= maxAgeMs && publishedAt <= now + 300000;
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
  let attemptedDeliveries = 0;
  let failedDeliveries = 0;
  for (const item of candidates) {
    const contentHash = sha256(normalizeNewsFingerprint(item.title));
    const similarSent = item.sourceKind === "market" ? undefined : store.findSimilarSent(item.title, {
      hours: config.SIMILAR_NEWS_WINDOW_HOURS
    });
    if (store.hasContentHash(contentHash) || similarSent) {
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
      const attachImage = store.shouldAttachImage(item, {
        interval: config.IMAGE_EVERY_N_MESSAGES,
        minScore: config.IMAGE_MIN_IMPORTANCE_SCORE
      });
      const publishedItem = { ...item, message, imageUrl: attachImage ? item.imageUrl : undefined };
      attemptedDeliveries += 1;
      await publisher.publish(publishedItem);
      if (config.DRY_RUN) store.markProcessed(item, "dry-run");
      else store.recordSent(publishedItem, contentHash, messageHash);
      sent += 1;
      logger.info({ source: item.source, score: item.importanceScore, message }, config.DRY_RUN ? "本地预览完成" : "已推送至 Discord");
    } catch (error) {
      failedDeliveries += 1;
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
    attemptedDeliveries,
    failedDeliveries,
    filteredJunk,
    filteredLowImportance,
    failedSources
  };
}

function errorToString(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
