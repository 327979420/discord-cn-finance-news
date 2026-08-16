const CJK_PATTERN = /[\u3400-\u9fff]/;

export function decodeXml(input = "") {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function stripHtml(input = "") {
  return decodeXml(input)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsChinese(input) {
  return CJK_PATTERN.test(input);
}

export function normalizeForHash(input) {
  return input.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "").trim();
}

export function normalizeNewsFingerprint(input) {
  return normalizeForHash(String(input || "")
    .replace(/^(?:突发|快讯|独家|更新|最新)[：:\s-]*/i, "")
    .replace(/^(?:【[^】]{1,24}】|\[[^\]]{1,24}\])\s*/g, "")
    .replace(/(?:据|来自)(?:路透|彭博|美联社|财联社|律动|blockbeats)[：:\s，,]*/gi, "")
    .replace(/\b(?:breaking|update|exclusive)\b/gi, ""));
}

export function newsTextSimilarity(left, right) {
  const a = normalizeNewsFingerprint(left);
  const b = normalizeNewsFingerprint(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.62 ? 1 : 0;
  }
  const aGrams = characterNgrams(a, 2);
  const bGrams = characterNgrams(b, 2);
  let intersection = 0;
  for (const gram of aGrams) if (bGrams.has(gram)) intersection += 1;
  const union = aGrams.size + bGrams.size - intersection;
  return union ? intersection / union : 0;
}

function characterNgrams(value, size) {
  const chars = [...value];
  if (chars.length <= size) return new Set([value]);
  const result = new Set();
  for (let index = 0; index <= chars.length - size; index += 1) result.add(chars.slice(index, index + size).join(""));
  return result;
}

export function truncateChineseStyle(input, maxChars) {
  const text = input.replace(/\s+/g, " ").trim();
  if ([...text].length <= maxChars) return text;
  return `${[...text].slice(0, Math.max(1, maxChars - 1)).join("")}…`;
}

export function extractFirstImageUrl(html = "") {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1];
}

export function matchesKeywordRules(title, description, includeKeywords, excludeKeywords) {
  const haystack = `${title} ${description || ""}`.toLowerCase();
  if (excludeKeywords.some((keyword) => haystack.includes(keyword))) return false;
  if (includeKeywords.length === 0) return true;
  return includeKeywords.some((keyword) => haystack.includes(keyword));
}

export function parseGdeltDate(value) {
  if (!value) return new Date().toISOString();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return safeIsoDate(value);
  const [, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
}

export function safeIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
