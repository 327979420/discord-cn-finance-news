// Keep the ordinary freshness limit, but catch up after delayed scheduled runs.
export function newsWindowMinutes(config, lastSuccessfulCycleAt, now = Date.now()) {
  const normal = config.MAX_NEWS_AGE_MINUTES;
  const cap = Math.max(normal, config.MAX_CATCHUP_AGE_MINUTES ?? 720);
  const previous = Date.parse(lastSuccessfulCycleAt);
  if (!Number.isFinite(previous)) return cap;
  return Math.min(cap, Math.max(normal, Math.ceil(Math.max(0, now - previous) / 60000) + 5));
}

export function cycleIsHealthy(result, sourceCount) {
  return Boolean(result && sourceCount > 0 && result.failedSources === 0 && result.failedItems === 0);
}
