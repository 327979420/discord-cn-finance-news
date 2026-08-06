import fs from "node:fs";
import path from "node:path";

export function loadConfig() {
  const configPath = process.env.CONFIG_PATH || "config/sources.json";
  const sources = readSources(configPath);
  const config = {
    DISCORD_WEBHOOK_URL: optionalUrl("DISCORD_WEBHOOK_URL"),
    DISCORD_USERNAME: process.env.DISCORD_USERNAME || "情报助手",
    DISCORD_AVATAR_URL: optionalUrl("DISCORD_AVATAR_URL"),
    OPENAI_API_KEY: cleanOptional(process.env.OPENAI_API_KEY),
    OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5-mini",
    CONFIG_PATH: configPath,
    DATABASE_PATH: process.env.DATABASE_PATH || "data/news.db",
    POLL_INTERVAL_SECONDS: integer("POLL_INTERVAL_SECONDS", 120, 30, 86400),
    MAX_NEWS_AGE_MINUTES: integer("MAX_NEWS_AGE_MINUTES", 180, 1, 10080),
    MAX_ITEMS_PER_CYCLE: integer("MAX_ITEMS_PER_CYCLE", 8, 1, 50),
    MAX_ITEMS_PER_SOURCE: integer("MAX_ITEMS_PER_SOURCE", 2, 1, 20),
    MIN_IMPORTANCE_SCORE: integer("MIN_IMPORTANCE_SCORE", 60, 0, 100),
    BREAKING_IMPORTANCE_SCORE: integer("BREAKING_IMPORTANCE_SCORE", 82, 0, 100),
    REQUEST_TIMEOUT_MS: integer("REQUEST_TIMEOUT_MS", 20000, 1000, 120000),
    DRY_RUN: boolean("DRY_RUN", false),
    RUN_ONCE: boolean("RUN_ONCE", false),
    PORT: integer("PORT", 3000, 1, 65535),
    DEFAULT_PREFIX: process.env.DEFAULT_PREFIX || "快讯",
    INCLUDE_SOURCE_URL: boolean("INCLUDE_SOURCE_URL", false),
    MAX_CHINESE_CHARS: integer("MAX_CHINESE_CHARS", 110, 30, 500),
    includeKeywords: splitKeywords(process.env.INCLUDE_KEYWORDS || ""),
    excludeKeywords: splitKeywords(process.env.EXCLUDE_KEYWORDS || "广告,促销,优惠券"),
    sources
  };

  if (config.BREAKING_IMPORTANCE_SCORE < config.MIN_IMPORTANCE_SCORE) {
    throw new Error("BREAKING_IMPORTANCE_SCORE 不能低于 MIN_IMPORTANCE_SCORE");
  }
  if (!config.DRY_RUN && !config.DISCORD_WEBHOOK_URL) {
    throw new Error("缺少 DISCORD_WEBHOOK_URL。先复制 .env.example 为 .env 并填入 Webhook；只预览可设置 DRY_RUN=true。");
  }
  return config;
}

function readSources(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const cls = {
    enabled: raw.cls?.enabled === true,
    limit: boundedNumber(raw.cls?.limit, 50, 1, 100, "cls.limit")
  };
  const rss = Array.isArray(raw.rss)
    ? raw.rss.map((source, index) => ({
        name: requiredString(source?.name, `rss[${index}].name`),
        url: requiredUrl(source?.url, `rss[${index}].url`),
        language: cleanOptional(source?.language),
        preserveTitle: source?.preserveTitle === true,
        forceSourceUrl: source?.forceSourceUrl === true,
        enabled: source?.enabled !== false
      }))
    : [];
  const polymarket = {
    enabled: raw.polymarket?.enabled === true,
    limit: boundedNumber(raw.polymarket?.limit, 30, 1, 100, "polymarket.limit"),
    minVolume: boundedNumber(raw.polymarket?.minVolume, 0, 0, Number.MAX_SAFE_INTEGER, "polymarket.minVolume")
  };
  const gdelt = {
    enabled: raw.gdelt?.enabled === true,
    maxRecordsPerQuery: boundedNumber(raw.gdelt?.maxRecordsPerQuery, 15, 1, 250, "gdelt.maxRecordsPerQuery"),
    queries: Array.isArray(raw.gdelt?.queries) ? raw.gdelt.queries.map(String).map((value) => value.trim()).filter(Boolean) : []
  };
  return { cls, rss, polymarket, gdelt };
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

function requiredUrl(value, label) {
  const text = requiredString(value, label);
  try {
    return new URL(text).toString();
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
}

function optionalUrl(name) {
  const value = cleanOptional(process.env[name]);
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} 不是有效 URL`);
  }
}

function cleanOptional(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function integer(name, fallback, min, max) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} 必须是 ${min}-${max} 的整数`);
  return value;
}

function boolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} 只能是 true 或 false`);
}

function boundedNumber(value, fallback, min, max, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} 超出范围`);
  return number;
}

function splitKeywords(input) {
  return input.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}
