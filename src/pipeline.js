import { sha256 } from "./utils/hash.js";
import { matchesKeywordRules, normalizeForHash, normalizeNewsFingerprint } from "./utils/text.js";
import { selectImportantItems, isMajorEarningsResult } from "./services/importance.js";
import { newsWindowMinutes } from "./services/freshness.js";

export async function runPipelineCycle(deps) {
  const { config, sources, store, summarizer, publisher, logger } = deps;
  const cycleStartedAt = new Date().toISOString();
  const catchupSince = [store.lastSuccessfulCycleAt(), store.pendingNewsAt()].filter(Boolean).sort()[0];
  const windowMinutes = newsWindowMinutes(config, catchupSince, Date.parse(cycleStartedAt));
  if (windowMinutes > config.MAX_NEWS_AGE_MINUTES) {
    logger.warn({ windowMinutes, lastSuccessfulCycleAt: store.lastSuccessfulCycleAt() || null }, "调度延迟或首次启动，启用限时补查");
  }
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
  const maxAgeMs = windowMinutes * 60000;
  const excluded = { stale: 0, unreliableTimestamp: 0, futureTimestamp: 0, keyword: 0, processed: 0 };
  let duplicate = 0;
  const eligible = items
    .filter((item) => {
      const publishedAt = new Date(item.publishedAt).getTime();
      const reliableTimestamp = item.sourceKind === "market" || item.sourceKind === "polymarket_move" || item.timestampReliable !== false;
      if (!reliableTimestamp || !Number.isFinite(publishedAt)) { excluded.unreliableTimestamp += 1; return false; }
      if (publishedAt > now + 300000) { excluded.futureTimestamp += 1; return false; }
      if (now - publishedAt > maxAgeMs) { excluded.stale += 1; return false; }
      return true;
    })
    .filter((item) => {
      if (matchesKeywordRules(item.title, item.description, config.includeKeywords, config.excludeKeywords)) return true;
      excluded.keyword += 1;
      return false;
    })
    .filter((item) => {
      if (!store.isFinalized(item.id)) return true;
      excluded.processed += 1;
      return false;
    })
    // Remove already-delivered content before applying per-source and cycle quotas.
    .filter((item) => {
      const contentHash = sha256(normalizeNewsFingerprint(item.title));
      const similarSent = item.sourceKind === "market" ? undefined : store.findSimilarSent(item.title, {
        hours: config.SIMILAR_NEWS_WINDOW_HOURS,
        preserveNumbers: isMajorEarningsResult(item.title, item.description)
      });
      if (!store.hasContentHash(contentHash) && !similarSent) return true;
      if (!config.DRY_RUN) store.markProcessed(item, "duplicate");
      duplicate += 1;
      return false;
    });

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
    if (!config.DRY_RUN) store.markProcessed(item, `filtered:${importance.reason}`);
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
  let skippedNoAi = 0;
  let attemptedDeliveries = 0;
  let failedDeliveries = 0;
  let failedItems = 0;
  for (const item of candidates) {
    const contentHash = sha256(normalizeNewsFingerprint(item.title));
    const similarSent = item.sourceKind === "market" ? undefined : store.findSimilarSent(item.title, {
      hours: config.SIMILAR_NEWS_WINDOW_HOURS,
      preserveNumbers: isMajorEarningsResult(item.title, item.description)
    });
    if (store.hasContentHash(contentHash) || similarSent) {
      if (!config.DRY_RUN) store.markProcessed(item, "duplicate");
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
        if (!config.DRY_RUN) store.markProcessed(item, "duplicate");
        duplicate += 1;
        continue;
      }
      const attachImage = store.shouldAttachImage(item, {
        interval: config.IMAGE_EVERY_N_MESSAGES,
        minScore: config.IMAGE_MIN_IMPORTANCE_SCORE
      });
      const publishedItem = { ...item, message, imageUrl: attachImage ? item.imageUrl : undefined };
      attemptedDeliveries += 1;
      try {
        await publisher.publish(publishedItem);
      } catch (error) {
        failedDeliveries += 1;
        throw error;
      }
      if (!config.DRY_RUN) store.recordSent(publishedItem, contentHash, messageHash);
      sent += 1;
      logger.info({ source: item.source, score: item.importanceScore, newsMessage: message }, config.DRY_RUN ? "本地预览完成" : "已推送至 Discord");
    } catch (error) {
      failedItems += 1;
      logger.error({ source: item.source, title: item.title, score: item.importanceScore, error: errorToString(error) }, "处理新闻失败，将在下轮重试");
    }
  }
  const pending = evaluated.filter(({ item, importance }) => importance.shouldSend && !store.isFinalized(item.id));
  if (!config.DRY_RUN && failedSources === 0 && failedItems === 0) {
    store.recordSuccessfulCycle(cycleStartedAt);
    store.recordPendingNews(pending.map(({ item }) => item.publishedAt).sort()[0]);
  }
  return {
    windowMinutes,
    excluded,
    fetched: items.length,
    eligible: eligible.length,
    candidates: candidates.length,
    sent,
    duplicate,
    skippedNoAi,
    attemptedDeliveries,
    failedDeliveries,
    failedItems,
    pending: pending.length,
    filteredJunk,
    filteredLowImportance,
    failedSources
  };
}

function errorToString(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
