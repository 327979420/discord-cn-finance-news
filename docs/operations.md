# Finance News Bot: setup and operations

## 1. 本地启动

要求 Node.js 22.13 以上，推荐 Node.js 24。这个仓库没有第三方运行依赖。

```bash
cp .env.example .env
```

在 `.env` 中填入：

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/你的Webhook
OPENAI_API_KEY=你的OpenAIKey
```

先测试 Discord：

```bash
npm run test:webhook
```

只运行一次并退出：

```bash
npm run run:once
```

持续运行：

```bash
npm run dev
```

健康检查：

```text
http://localhost:3000/healthz
```

## 2. Discord Webhook 怎么创建

进入目标频道：

```text
编辑频道 → 整合 / Integrations → Webhooks → New Webhook → Copy Webhook URL
```

把网址放进 `.env`。Webhook 是密钥，不要发到群里，也不要提交到 GitHub。

## 3. 新闻源配置

编辑 `config/sources.json`。

### 财联社电报

```json
{
  "name": "财联社电报",
  "url": "https://rsshub.app/cls/telegraph",
  "language": "zh",
  "enabled": true
}
```

公共 RSSHub 实例可能限流或暂时不可用。正式长期运行建议自建 RSSHub，仓库已经提供：

```bash
docker compose -f infra/docker-compose.rsshub.yml up -d --build
```

该模式会自动使用 `http://rsshub:1200/cls/telegraph`。

### Polymarket

```json
"polymarket": {
  "enabled": true,
  "limit": 30,
  "minVolume": 0
}
```

Polymarket 原文通常是英文，只进简报卡（由 Claude 翻译），并且只保留和金融相关的市场（体育、娱乐盘口会被过滤）。旧的逐条模式下没有 `OPENAI_API_KEY` 时会跳过。

### GDELT

```json
"gdelt": {
  "enabled": true,
  "maxRecordsPerQuery": 15,
  "queries": [
    "Federal Reserve OR inflation OR tariff",
    "NVIDIA OR OpenAI OR DeepSeek",
    "Bitcoin OR Ethereum",
    "gold OR XAUUSD OR US dollar"
  ]
}
```

GDELT 只进简报卡（由 Claude 翻译）；它经常限流（429），失败只记警告，不会让运行失败。

## 4. 定时简报卡（默认模式）

`config/sources.json` 的 `digest.enabled` 为 true 时，机器人不再一条一条发快讯，而是每天按北京时间 07:30、12:00、17:00、21:15 各发一张 Discord 卡片：

- 顶部一行写这段时间最重要的一件事，下面是行情（各时段显示的地区不同，例如 21:15 不显示美股，因为那只是昨天的收盘）。超过异动阈值的涨跌加粗。
- 正文按主题（美股与科技、宏观与政策、加密货币等）列出，每行一件事，同一事件的多条来源合并成一行，后面附来源链接。
- 由 headless Claude Code 整理：繁体和英文改写成简体，删掉标题党和没有事实的条目。Claude 只能用给它的条目；代码会删掉引用不存在条目、或写了条目里没有的数字的行（日志里有「简报行未通过检查」）。
- Claude 未配置或失败时，卡片改用原始标题（页脚写「原始标题，未经整理」），没用上的条目留给下一张卡。

两张卡之间的运行只做两件事：把看到的新闻存进新闻池（Yahoo 的 RSS 只列最近约三小时，没有池子的话卡片会漏掉早些时候的新闻），以及单独推送真正的紧急事件（熔断、违约、开战、地震海啸等，或行情异动达到阈值 1.5 倍），每天最多 `MAX_BREAKING_PER_DAY` 条。其余一律等下一张卡。

需要两个仓库 Secret / 设置：

1. `CLAUDE_CODE_OAUTH_TOKEN`：在本机运行 `claude setup-token` 生成，`gh secret set CLAUDE_CODE_OAUTH_TOKEN -R 327979420/discord-cn-finance-news`。使用订阅额度，每天约 4 次调用。
2. 准点调度：GitHub 自带的定时任务一天只触发几次，所以由 `scheduler/` 里的 Cloudflare Worker 每 15 分钟触发一次工作流。部署方法写在 `scheduler/wrangler.jsonc` 顶部，需要一个只授权本仓库、Actions 读写的 fine-grained GitHub 令牌。

手动出一张卡试试：Actions → Chinese Finance News Broadcast → Run workflow，勾选 `force_digest`（再勾 `dry_run` 就只在日志里预览）。

## 5. 关键参数

| 参数 | 默认值 | 作用 |
|---|---:|---|
| `POLL_INTERVAL_SECONDS` | 120 | 每两分钟检查一次 |
| `MAX_NEWS_AGE_MINUTES` | 180 | 只处理三小时内新闻 |
| `MAX_CATCHUP_AGE_MINUTES` | 720 | 调度延迟或首次启动时最多补查12小时，仍去重和限量 |
| `MAX_ITEMS_PER_CYCLE` | 8 | 每轮最多发送8条 |
| `DEFAULT_PREFIX` | 快讯 | 普通消息前缀 |
| `INCLUDE_SOURCE_URL` | false | 是否在正文显示原文链接 |
| `INCLUDE_KEYWORDS` | 空 | 留空不过滤 |
| `EXCLUDE_KEYWORDS` | 广告等 | 排除垃圾内容 |
| `DRY_RUN` | false | true时只在终端预览 |

## 6. Docker 启动

```bash
cp .env.example .env
# 填好 .env
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f news-bot
```

SQLite 文件通过 Docker Volume 保存，重启容器不会重复播报历史新闻。

## 7. 当前去重逻辑

机器人会同时记录：

- 新闻源自己的 item ID
- 标题与摘要的标准化 Hash
- 最终中文消息的 Hash

因此同一条新闻被重复抓取时，一般不会再次发送。跨语言、完全不同措辞的同一事件，后续可以再加入语义去重。

## 8. 运行维护

Cloudflare Worker 每 15 分钟触发一次工作流（GitHub 自带定时任务只作后备）。任务会先运行语法与单元测试，再抓取和发送新闻；如果所有新闻源均失败，或所有 Discord 发送均失败，任务会明确标记为失败。

GitHub 的 `schedule` 可能延迟或丢弃，不能当作准点调度服务。机器人记录上次成功检查时间；延迟后自动扩大补查窗口（加5分钟重叠，最多12小时），正常节奏下 Actions 仍使用45分钟窗口。源只返回有限条最新新闻，补查不能找回已从 Feed 消失的历史新闻。需要稳定的实时监控时，使用上面的 Docker 常驻服务。

财报评分同时识别简体和繁体，以及「輝達」「台積電」等公司名称。大型公司已公布且含数字的财报结果会获得正常发送优先级，每轮在原有总数和来源配额内保留一个财报名额；前瞻和观点不会获得该优先级。当前是新闻源驱动，并非覆盖所有公司的财报日历或财务数据接口。

Actions 摘要会列出过期、不可靠时间、关键词、已处理记录等排除数量，以及候选数、重复数、发送数和错误数。来源或新闻处理有任何失败时，运行会标记失败；已成功发送的去重状态仍会保存，避免下次重复发送。没有候选但抓取正常时，运行保持成功。

未配置 `OPENAI_API_KEY` 时，会明确提示 GDELT/Polymarket 未启用；这不会阻断中文源。预览不记录发送、不把候选标成已处理，也不推进补查时间。

SQLite 会保留最近 30 天的处理记录和最近 180 天的已发送记录，避免状态文件无限增长。Actions 的运行摘要和日志会显示具体失败的来源。

公开仓库使用标准 `ubuntu-latest` runner 时，GitHub Actions 分钟免费。私有仓库用尽额度、付款失败或 spending limit 过低时，任务可能在任何代码运行前失败。

## 9. 当前边界

暂时不做：

- X 网页抓取
- 私人 Discord 群 self-bot 抓取
- 自动投资建议
- 多服务器后台管理

先确保“财联社 → 中文短讯 → Discord”长期稳定，再扩展到其他来源。

## 安全与版权

- 不要提交 `.env`、Webhook URL 或 API Key。
- 新闻正文只做短摘要，保留原始 URL 能力，避免整篇转载。
- RSSHub 路由属于非官方聚合链路，网站改版后可能暂时失效。
