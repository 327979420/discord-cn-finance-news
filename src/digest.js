// One digest run: fetch every source, take the news published since the
// previous card that has not been sent yet, let the writer turn it into a few
// merged lines, and post one embed with the market rows on top.

import { sha256 } from "./utils/hash.js";
import { matchesKeywordRules, normalizeNewsFingerprint } from "./utils/text.js";
import { selectImportantItems, isMajorEarningsResult, isFinanciallyRelevantText } from "./services/importance.js";
import { snapshotRows, snapshotForPrompt } from "./services/market-snapshot.js";
import { buildDigestEmbed, embedToText } from "./services/digest-card.js";
import { localTimeLabel } from "./services/digest-schedule.js";

const contentHashFor = (item) => sha256(normalizeNewsFingerprint(item.title));

export async function runDigestCycle(deps) {
  const { config, sources, store, writer, fallbackWriter, publisher, logger, slot } = deps;
  const now = deps.now || new Date();
  const digest = config.sources.digest;

  const fetchResults = await Promise.all(sources.map(async (source) => {
    try {
      return { ok: true, source, items: await source.fetch({ timeoutMs: config.REQUEST_TIMEOUT_MS }) };
    } catch (error) {
      return { ok: false, source, error };
    }
  }));
  const items = [];
  let failedSources = 0;
  for (const result of fetchResults) {
    if (result.ok) {
      logger.info({ source: result.source.name, count: result.items.length }, "新闻源抓取完成");
      items.push(...result.items);
    } else if (result.source.optional) {
      logger.warn({ source: result.source.name, error: errorText(result.error) }, "可选新闻源抓取失败，本卡不含该来源");
    } else {
      failedSources += 1;
      logger.error({ source: result.source.name, error: errorText(result.error) }, "新闻源抓取失败");
    }
  }

  const quotes = sources.flatMap((source) => source.lastQuotes || []);
  const marketRows = snapshotRows(quotes, slot.regions);

  const windowStart = Math.max(
    Date.parse(store.getState("last_digest_at") || "") || 0,
    now.getTime() - digest.maxWindowHours * 3600000
  );
  const seen = new Set(items.map((item) => item.id));
  const pooled = store.poolSince(new Date(windowStart).toISOString()).filter((item) => !seen.has(item.id));
  const eligible = [...items, ...pooled].filter((item) => {
    if (item.sourceKind === "market") return false; // shown in the market rows instead
    if (String(item.sourceKind).startsWith("polymarket") && !isFinanciallyRelevantText(`${item.title} ${item.description || ""}`)) return false;
    const publishedAt = Date.parse(item.publishedAt);
    if (item.timestampReliable === false || !Number.isFinite(publishedAt)) return false;
    if (publishedAt > now.getTime() + 300000 || publishedAt < windowStart) return false;
    if (!matchesKeywordRules(item.title, item.description, config.includeKeywords, config.excludeKeywords)) return false;
    if (store.isFinalized(item.id)) return false;
    if (store.hasContentHash(contentHashFor(item))) return false;
    return !store.findSimilarSent(item.title, {
      hours: config.SIMILAR_NEWS_WINDOW_HOURS,
      preserveNumbers: isMajorEarningsResult(item.title, item.description)
    });
  });

  const { selected } = selectImportantItems(eligible, {
    minScore: digest.minCandidateScore,
    breakingScore: 101,
    maxItems: digest.maxCandidates,
    // Polymarket alone can return hundreds of markets; keep room for the news sources.
    maxPerSource: Math.ceil(digest.maxCandidates / 3)
  });
  const candidates = selected.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  logger.info({ slot: slot.key, fetched: items.length, pooled: pooled.length, eligible: eligible.length, candidates: candidates.length, quotes: quotes.length }, "简报候选完成");

  let written;
  let writerError;
  if (candidates.length) {
    const input = {
      slot,
      items: candidates,
      marketText: snapshotForPrompt(quotes),
      marketNumbers: quotes.flatMap((quote) => [quote.price, Math.abs(quote.changePct)]).filter(Number.isFinite),
      timeZone: digest.timezone
    };
    try {
      written = await writer.write(input);
      if (!written.sections.length) throw new Error("no line passed the checks");
    } catch (error) {
      writerError = errorText(error);
      logger.error({ writer: writer.name, error: writerError }, "简报撰写失败，改用原始标题");
      written = await fallbackWriter.write(input);
    }
    for (const drop of written.dropped || []) logger.warn(drop, "简报行未通过检查，已删除");
  } else {
    written = { headline: "", sections: [], dropped: [], writer: "none" };
  }

  const result = {
    mode: "digest",
    slot: slot.key,
    writer: written.writer,
    writerError,
    fetched: items.length,
    candidates: candidates.length,
    lines: written.sections.reduce((total, section) => total + section.lines.length, 0),
    dropped: (written.dropped || []).length,
    failedSources,
    failedItems: 0,
    posted: false
  };

  if (!result.lines && !marketRows.length) {
    logger.warn({ slot: slot.key }, "本时段没有可发内容，跳过");
  } else {
    const windowLabel = `${localTimeLabel(new Date(windowStart), digest.timezone)}–${localTimeLabel(now, digest.timezone)} 北京时间`;
    const embed = buildDigestEmbed({ slot, digest: written, marketRows, timeZone: digest.timezone, now, windowLabel });
    try {
      await publisher.publishEmbed(embed, embedToText(embed));
      result.posted = true;
    } catch (error) {
      result.failedItems = 1;
      logger.error({ error: errorText(error) }, "简报发送失败，将在下轮重试");
      return result;
    }
  }

  if (!config.DRY_RUN) {
    const used = [...new Set(written.sections.flatMap((section) => section.lines.flatMap((line) => line.items)))];
    const usedIds = new Set(used.map((item) => item.id));
    // A headline-only fallback leaves the unused items open, for the next card's editor.
    const omitted = written.writer === "claude" ? candidates.filter((item) => !usedIds.has(item.id)) : [];
    store.recordDigest(used, omitted, slot.key, contentHashFor);
    store.setState("last_digest_slot", slot.key);
    store.setState("last_digest_at", now.toISOString());
    if (failedSources === 0) store.recordSuccessfulCycle(now.toISOString());
  }
  return result;
}

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
