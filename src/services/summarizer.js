import { fetchWithTimeout } from "../utils/http.js";
import { containsChinese, stripHtml, truncateChineseStyle } from "../utils/text.js";

export class Summarizer {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.defaultPrefix = options.defaultPrefix;
    this.maxChineseChars = options.maxChineseChars;
    this.timeoutMs = options.timeoutMs;
  }

  async summarize(item) {
    const prefix = item.sourceKind === "polymarket" ? "新Polymarket" : this.defaultPrefix;
    const title = cleanNewsText(item.title);
    const description = cleanNewsText(item.description);

    if (!this.apiKey) {
      const body = selectUsefulText(title, description, this.maxChineseChars);
      if (!containsChinese(body)) return undefined;
      return formatMessage(prefix, body, this.maxChineseChars);
    }

    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: 160,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: "你是中文金融快讯编辑。只提取一条最有用的事实，写成一句自然、简洁、可独立阅读的中文短讯。不得补充原文没有的事实，不做投资建议，不写市场影响，不写来源，不放链接，不用Markdown，不换行。保留关键数字、公司、人名和政策动作。"
            }]
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: `要求：正文最多${this.maxChineseChars}个中文字符左右；只写一个事实；不要添加“突发”或“快讯”前缀。\n来源类型：${item.sourceKind}\n标题：${title}\n摘要：${description}`
            }]
          }
        ]
      })
    }, this.timeoutMs);

    const data = await response.json();
    if (!response.ok) throw new Error(`OpenAI 摘要失败：${response.status} ${JSON.stringify(data)}`);
    const output = extractOutputText(data).trim().replace(/^[-—•\s]+/, "");
    return output ? formatMessage(prefix, output, this.maxChineseChars) : undefined;
  }
}

export function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const texts = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if ((content.type === "output_text" || content.type === "text") && typeof content.text === "string") texts.push(content.text);
    }
  }
  return texts.join("\n");
}

export function selectUsefulText(title, description, maxChars) {
  const cleanTitle = cleanNewsText(title);
  const cleanDescription = cleanNewsText(description);
  let candidate = cleanTitle || cleanDescription;

  // 新闻标题通常已经是最浓缩的信息。只有标题过短时才补一小段摘要。
  if (cleanTitle && cleanTitle.length < 12 && cleanDescription && !cleanDescription.startsWith(cleanTitle)) {
    candidate = `${cleanTitle}：${firstSentence(cleanDescription)}`;
  }

  return truncateChineseStyle(firstSentence(candidate), maxChars);
}

function cleanNewsText(value) {
  return stripHtml(String(value || ""))
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^(?:【[^】]{1,24}】|\[[^\]]{1,24}\])\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.match(/[^。！？!?]+[。！？!?]?/g) || [cleaned];
  let result = "";
  for (const part of parts) {
    result += part.trim();
    if (result.length >= 16 || /[。！？!?]$/.test(result)) break;
  }
  return result.trim();
}

function formatMessage(prefix, body, maxChars) {
  const cleaned = cleanNewsText(body)
    .replace(/^(突发|快讯|新Polymarket)[：:，,\s]*/i, "")
    .trim();
  const shortened = truncateChineseStyle(cleaned, maxChars);
  const punctuation = /[。！？!?]$/.test(shortened) ? "" : "。";
  return `${prefix}：${shortened}${punctuation}`;
}
