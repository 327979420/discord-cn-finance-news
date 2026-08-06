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
    const originalText = stripHtml([item.title, item.description].filter(Boolean).join("。"));
    const prefix = item.sourceKind === "polymarket" ? "新Polymarket" : this.defaultPrefix;
    if (!this.apiKey) {
      if (!containsChinese(originalText)) return undefined;
      return formatMessage(prefix, originalText, this.maxChineseChars);
    }

    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: 220,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "你是中文金融快讯编辑。把输入改写成一条自然、简洁、可独立阅读的中文短讯。不得补充原文没有的事实，不做投资建议，不写市场影响，不写来源，不用Markdown，不换行。保留关键数字、公司、人名和政策动作。" }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: `要求：正文最多${this.maxChineseChars}个中文字符左右；不要自己添加“突发”或“快讯”前缀。\n来源类型：${item.sourceKind}\n标题：${item.title}\n摘要：${item.description || ""}` }]
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

function formatMessage(prefix, body, maxChars) {
  const cleaned = body.replace(/^(突发|快讯|新Polymarket)[：:，,\s]*/i, "").replace(/\s+/g, " ").trim();
  const shortened = truncateChineseStyle(cleaned, maxChars);
  const punctuation = /[。！？!?]$/.test(shortened) ? "" : "。";
  return `${prefix}：${shortened}${punctuation}`;
}
