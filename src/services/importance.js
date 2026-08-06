import { stripHtml } from "../utils/text.js";

const HARD_JUNK = [
  "广告", "促销", "优惠券", "抽奖", "福利", "招聘", "课程", "培训", "报名",
  "ama", "空投教程", "新手教程", "使用指南", "活动回顾", "峰会回顾", "社区活动",
  "盘点", "一文读懂", "深度解读", "专访", "观点：", "早报", "晚报", "日报", "周报",
  "今日推荐", "值得关注", "点击查看", "直播预告"
];

const POLITICS = [
  "总统", "总理", "议会", "国会", "大选", "选举", "竞选", "支持率", "访问", "会晤",
  "外交", "特朗普", "拜登", "普京", "泽连斯基", "马克龙", "内塔尼亚胡"
];

const MARKET_NEXUS = [
  "关税", "制裁", "出口管制", "贸易限制", "禁运", "央行", "利率", "降息", "加息",
  "财政", "预算", "债务上限", "监管", "反垄断", "证券", "银行", "金融", "芯片",
  "原油", "石油", "天然气", "黄金", "粮食", "供应链", "航运", "海峡", "停火",
  "空袭", "战争", "军事行动", "封锁"
];

const VERY_HIGH_IMPACT = [
  "熔断", "暂停交易", "停止交易", "交易中断", "紧急降息", "紧急加息", "意外降息",
  "意外加息", "违约", "破产", "申请破产", "倒闭", "被接管", "挤兑", "脱锚",
  "黑客攻击", "遭攻击", "被盗", "漏洞利用", "爆仓", "大规模清算", "战争爆发",
  "开战", "空袭", "封锁海峡", "停火协议"
];

const MACRO = [
  "美联储", "fed", "fomc", "欧洲央行", "ecb", "日本央行", "中国人民银行", "央行",
  "cpi", "pce", "非农", "失业率", "通胀", "gdp", "利率决议", "降息", "加息",
  "降准", "量化宽松", "国债收益率", "美元指数"
];

const MARKET_ASSETS = [
  "标普", "纳指", "道指", "美股", "港股", "a股", "沪指", "深成指", "科创板",
  "恒生指数", "日经", "kospi", "黄金", "白银", "原油", "铜价", "美元", "人民币",
  "比特币", "bitcoin", "btc", "以太坊", "ethereum", "eth", "稳定币", "加密货币"
];

const CORPORATE_ACTION = [
  "财报", "营收", "净利润", "亏损", "业绩指引", "下调指引", "上调指引", "裁员",
  "收购", "并购", "私有化", "上市", "退市", "停牌", "回购", "增发", "融资",
  "反垄断调查", "监管调查", "罚款", "召回"
];

const MAJOR_ENTITIES = [
  "苹果", "apple", "微软", "microsoft", "英伟达", "nvidia", "谷歌", "google", "alphabet",
  "亚马逊", "amazon", "meta", "特斯拉", "tesla", "台积电", "tsmc", "三星", "openai",
  "伯克希尔", "摩根大通", "高盛", "花旗", "美国银行", "coinbase", "binance", "币安"
];

const CRYPTO_HIGH_SIGNAL = [
  "现货etf", "etf获批", "监管批准", "暂停提现", "停止提现", "交易所被盗", "协议被攻击",
  "稳定币脱锚", "清算", "爆仓", "黑客", "漏洞", "法院裁定", "sec", "美国证交会"
];

const LOW_SIGNAL = [
  "预计", "或将", "可能", "有望", "据悉", "消息称", "知情人士", "分析师认为", "机构观点",
  "某鲸鱼", "鲸鱼", "某地址", "链上数据显示", "转入交易所", "转出交易所", "融资完成",
  "战略合作", "生态合作", "宣布合作", "即将上线", "正式上线"
];

const SOURCE_BASE = {
  cls: 38,
  rss: 32,
  polymarket: 12,
  gdelt: 20
};

export function scoreImportance(item, options = {}) {
  const text = normalize(`${item.title || ""} ${item.description || ""}`);
  const minScore = options.minScore ?? 60;
  const breakingScore = options.breakingScore ?? 82;

  if (!text) return rejected(0, "empty");
  if (hasAny(text, HARD_JUNK)) return rejected(0, "junk");

  const political = hasAny(text, POLITICS);
  const marketNexus = hasAny(text, MARKET_NEXUS);
  if (political && !marketNexus) return rejected(10, "generic-politics");

  if (item.sourceKind === "polymarket" && !isFinanciallyRelevant(text)) {
    return rejected(10, "irrelevant-polymarket");
  }

  let score = SOURCE_BASE[item.sourceKind] ?? 25;
  const reasons = [];

  score += add(text, VERY_HIGH_IMPACT, 30, reasons, "major-event");
  score += add(text, MACRO, 24, reasons, "macro");
  score += add(text, MARKET_ASSETS, 15, reasons, "market");
  score += add(text, CORPORATE_ACTION, 14, reasons, "corporate");
  score += add(text, MAJOR_ENTITIES, 10, reasons, "major-entity");
  score += add(text, CRYPTO_HIGH_SIGNAL, 20, reasons, "crypto-high-signal");

  const move = largestPercentageMove(text);
  if (move >= 8) {
    score += 28;
    reasons.push("move>=8%");
  } else if (move >= 5) {
    score += 22;
    reasons.push("move>=5%");
  } else if (move >= 3) {
    score += 12;
    reasons.push("move>=3%");
  }

  if (hasLargeMoneyFigure(text)) {
    score += 8;
    reasons.push("large-value");
  }

  if (political && marketNexus) {
    score += 5;
    reasons.push("market-moving-policy");
  }

  const lowSignalHits = countHits(text, LOW_SIGNAL);
  if (lowSignalHits) {
    score -= Math.min(24, lowSignalHits * 8);
    reasons.push("low-signal");
  }

  if (looksLikeQuestionOrFeature(item.title)) {
    score -= 18;
    reasons.push("feature-style");
  }

  if (text.length > 500) score -= 5;
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    shouldSend: score >= minScore,
    isBreaking: score >= breakingScore,
    reason: score >= minScore ? "accepted" : "low-importance",
    reasons
  };
}

export function selectImportantItems(items, options = {}) {
  const maxItems = options.maxItems ?? 5;
  const maxPerSource = options.maxPerSource ?? 2;
  const evaluated = items.map((item) => ({ item, importance: scoreImportance(item, options) }));
  const accepted = evaluated
    .filter(({ importance }) => importance.shouldSend)
    .sort((a, b) => b.importance.score - a.importance.score || new Date(b.item.publishedAt) - new Date(a.item.publishedAt));

  const selected = [];
  const sourceCounts = new Map();
  for (const entry of accepted) {
    const count = sourceCounts.get(entry.item.source) || 0;
    if (count >= maxPerSource) continue;
    selected.push({
      ...entry.item,
      importanceScore: entry.importance.score,
      alertPrefix: entry.item.sourceKind === "polymarket"
        ? "新Polymarket"
        : entry.importance.isBreaking ? "突发" : "快讯"
    });
    sourceCounts.set(entry.item.source, count + 1);
    if (selected.length >= maxItems) break;
  }

  selected.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  return { selected, evaluated };
}

function isFinanciallyRelevant(text) {
  return hasAny(text, [...MACRO, ...MARKET_ASSETS, ...CORPORATE_ACTION, ...MAJOR_ENTITIES, ...CRYPTO_HIGH_SIGNAL, ...MARKET_NEXUS]);
}

function add(text, terms, points, reasons, reason) {
  if (!hasAny(text, terms)) return 0;
  reasons.push(reason);
  return points;
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function countHits(text, terms) {
  return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
}

function largestPercentageMove(text) {
  const values = [...text.matchAll(/(?:涨|跌|上涨|下跌|暴涨|暴跌|升|降|回落|攀升)?\s*(\d+(?:\.\d+)?)\s*%/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function hasLargeMoneyFigure(text) {
  return /(?:\d+(?:\.\d+)?\s*(?:亿|十亿|百亿|千亿)\s*(?:美元|人民币|港元|欧元)?|\$\s*\d+(?:\.\d+)?\s*(?:billion|bn))/i.test(text);
}

function looksLikeQuestionOrFeature(title) {
  const text = normalize(title || "");
  return /[？?]/.test(text) || hasAny(text, ["为何", "如何", "怎么看", "意味着什么", "背后", "全解析", "深度"]);
}

function normalize(value) {
  return stripHtml(String(value || "")).replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function rejected(score, reason) {
  return { score, shouldSend: false, isBreaking: false, reason, reasons: [reason] };
}
