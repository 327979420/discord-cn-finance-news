// Writes the text of a digest card from the window's news items.
//
// ClaudeDigestWriter runs headless Claude Code (signed in with
// CLAUDE_CODE_OAUTH_TOKEN, the owner's subscription) with no tools: it only
// rewrites the numbered items it is given. It merges items about the same
// event, writes simplified Chinese, and drops headlines that carry no fact.
// checkDigest() then removes any line that cites an unknown item or contains a
// number none of its cited items contain. HeadlineDigestWriter is the fallback
// when Claude is not configured or fails: the best headlines, unedited.

import { spawn } from "node:child_process";
import { stripHtml, truncateChineseStyle } from "../utils/text.js";
import { localTimeLabel } from "./digest-schedule.js";

export const TOPICS = ["美股与科技", "宏观与政策", "亚太市场", "欧洲市场", "商品与外汇", "加密货币", "地缘与突发", "公司动态"];
export const MAX_LINE_CHARS = 80;
export const MAX_LINES = 9;
export const MAX_LINES_PER_TOPIC = 4;
const MAX_HEADLINE_CHARS = 30;
const CLAUDE_TIMEOUT_MS = 6 * 60 * 1000;

const SYSTEM = `你是中文财经简报编辑，为一个散户交易者的 Discord 群写定时简报卡。你只收到一组带编号的新闻条目（来源有繁体中文、简体中文和英文）和最新行情。卡片顶部的行情由代码排版，你只写文字部分。

规则：
- 一律用简体中文。繁体、英文都要改写成简体中文。
- 同一事件的多条（不同来源、不同角度）合并成一行，并在 sources 里列出所有用到的编号。
- 每行只讲一件事，最多 ${MAX_LINE_CHARS} 个字，先写主体和动作，再写关键数字（金额、涨跌幅、价位、概率）。能解释行情的原因要写进去（例如“财报好于预期但收跌近 3%，市场担心出口管制”）。
- 只写条目里明确写到的事实和数字，数字照抄，不换算、不估算、不补充背景知识。条目没有给出的数字一个都不要写。
- 删掉没有实际信息的条目：标题党（“这档”“原因曝光”“他说…”）、问句、预告、观点评论、八卦、广告、行情回顾里重复的涨跌。宁缺毋滥，没有值得写的就少写。
- 不写投资建议，不预测，不加“快讯”“突发”之类前缀，不用 Markdown、表情和链接。
- 总共最多 ${MAX_LINES} 行，每个主题最多 ${MAX_LINES_PER_TOPIC} 行，按重要性排序。主题只能从给定列表里选。
- headline：这段时间最重要的一件事，一句话，最多 ${MAX_HEADLINE_CHARS} 个字，同样只用条目里的事实。`;

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: TOPICS },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                sources: { type: "array", items: { type: "integer" } }
              },
              required: ["text", "sources"],
              additionalProperties: false
            }
          }
        },
        required: ["topic", "lines"],
        additionalProperties: false
      }
    }
  },
  required: ["headline", "sections"],
  additionalProperties: false
};

export function buildPrompt({ slot, items, marketText, timeZone }) {
  const lines = items.map((item, index) => {
    const description = cleanText(item.description);
    const extra = description && !description.startsWith(cleanText(item.title)) ? ` —— ${truncateChineseStyle(description, 160)}` : "";
    return `[${index + 1}] ${localTimeLabel(new Date(item.publishedAt), timeZone)} ${item.source}｜${cleanText(item.title)}${extra}`;
  });
  return [
    `简报：${slot.title}`,
    `可选主题：${TOPICS.join("、")}`,
    "",
    "最新行情（只作背景，不必复述）：",
    marketText || "（暂无）",
    "",
    "新闻条目：",
    ...lines
  ].join("\n");
}

function cleanText(value) {
  return stripHtml(String(value || "")).replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
}

// Numbers as written, with thousands separators removed: "3,812.09万" -> 3812.09.
export function numbersIn(text) {
  const normalized = String(text).normalize("NFKC").replace(/(\d),(?=\d{3})/g, "$1");
  return [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite);
}

// A number in the card must come from a cited item. Allow rounding (within 1%)
// and unit changes by powers of ten (1.2 billion -> 12亿, 3812万 -> 3812万).
export function numberSupported(value, sourceNumbers) {
  if (value === 0) return sourceNumbers.includes(0);
  return sourceNumbers.some((candidate) => {
    if (!candidate) return false;
    for (let power = -4; power <= 4; power += 1) {
      const scaled = candidate * 10 ** power;
      if (Math.abs(value - scaled) <= Math.max(Math.abs(scaled) * 0.01, 0.005)) return true;
    }
    return false;
  });
}

function charLength(text) {
  return [...String(text)].length;
}

// Keeps only the lines that pass; returns them with what was dropped and why.
export function checkDigest(draft, items, extraNumbers = []) {
  const dropped = [];
  const sections = [];
  let total = 0;
  const allNumbers = [...items.flatMap((item) => numbersIn(`${item.title} ${item.description || ""}`)), ...extraNumbers];
  for (const topic of TOPICS) {
    const lines = [];
    for (const section of draft.sections || []) {
      if (section.topic !== topic) continue;
      for (const line of section.lines || []) {
        const text = String(line.text || "").replace(/\s+/g, " ").trim();
        const ids = [...new Set((line.sources || []).filter((id) => Number.isInteger(id)))];
        const cited = ids.map((id) => items[id - 1]).filter(Boolean);
        let reason;
        if (!text) reason = "empty";
        else if (!ids.length || cited.length !== ids.length) reason = "unknown-source";
        else if (charLength(text) > MAX_LINE_CHARS + 10) reason = "too-long";
        else {
          const sourceNumbers = cited.flatMap((item) => numbersIn(`${item.title} ${item.description || ""}`));
          const unsupported = numbersIn(text).filter((value) => !numberSupported(value, sourceNumbers));
          if (unsupported.length) reason = `unsupported-number:${unsupported.join(",")}`;
        }
        if (!reason && (lines.length >= MAX_LINES_PER_TOPIC || total >= MAX_LINES)) reason = "over-limit";
        if (reason) {
          dropped.push({ text, sources: ids, reason });
          continue;
        }
        lines.push({ text, items: cited });
        total += 1;
      }
    }
    if (lines.length) sections.push({ topic, lines });
  }
  let headline = String(draft.headline || "").replace(/\s+/g, " ").trim();
  if (headline && (charLength(headline) > MAX_HEADLINE_CHARS + 10 || numbersIn(headline).some((value) => !numberSupported(value, allNumbers)))) {
    dropped.push({ text: headline, reason: "headline-unsupported" });
    headline = "";
  }
  return { headline, sections, dropped };
}

export class ClaudeDigestWriter {
  constructor(options = {}) {
    this.model = options.model || "sonnet";
    this.bin = options.bin || process.env.CLAUDE_BIN || "claude";
    this.timeoutMs = options.timeoutMs || CLAUDE_TIMEOUT_MS;
    this.name = "claude";
  }

  async write({ slot, items, marketText, marketNumbers, timeZone }) {
    const prompt = buildPrompt({ slot, items, marketText, timeZone });
    const stdout = await this.run(prompt);
    const draft = parseResult(stdout);
    return { ...checkDigest(draft, items, marketNumbers), writer: this.name };
  }

  run(prompt) {
    const args = [
      "-p",
      "--model", this.model,
      "--output-format", "json",
      "--max-turns", "4",
      "--no-session-persistence",
      "--system-prompt", SYSTEM,
      "--tools", "",
      "--json-schema", JSON.stringify(SCHEMA)
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), this.timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (!stdout.trim()) reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 500)}`));
        else resolve(stdout);
      });
      child.stdin.end(prompt);
    });
  }
}

export function parseResult(stdout) {
  const result = JSON.parse(stdout);
  if (result.is_error) throw new Error(`Claude Code failed: ${String(result.result || result.subtype).slice(0, 300)}`);
  const draft = result.structured_output ?? jsonFromText(result.result);
  if (!draft || !Array.isArray(draft.sections)) throw new Error("Claude Code returned no sections");
  return draft;
}

// Fallback when no structured output came back: the first JSON object in the reply text.
function jsonFromText(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`Claude Code returned no JSON: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

// Headline-only card: the highest-scoring simplified-Chinese items first.
export class HeadlineDigestWriter {
  constructor() {
    this.name = "headlines";
  }

  async write({ items }) {
    const ranked = [...items]
      .filter((item) => item.language === "zh")
      // Raw Yahoo Taiwan headlines (preserveTitle) are often teasers; use them last.
      .sort((a, b) => Number(a.preserveTitle === true) - Number(b.preserveTitle === true)
        || (b.importanceScore || 0) - (a.importanceScore || 0))
      .slice(0, 6);
    const lines = ranked.map((item) => ({ text: truncateChineseStyle(cleanText(item.title), MAX_LINE_CHARS), items: [item] }));
    return { headline: "", sections: lines.length ? [{ topic: "要闻", lines }] : [], dropped: [], writer: this.name };
  }
}
