# Discord 中文金融快讯机器人

自动抓取金融与突发新闻，去重后压缩成中文短讯，推送到指定 Discord 频道。

第一版以截图中的“情报助手”形式为蓝本：**一条消息只讲一件事、正文很短、不做复杂分级、可选配图。**

## 当前支持

- 财联社电报等任意 RSS / RSSHub Feed
- Polymarket 新事件
- GDELT 国际新闻关键词搜索
- OpenAI 中文翻译与压缩
- Discord Incoming Webhook
- SQLite 去重
- 图片 Embed
- Docker 部署
- `/healthz` 健康检查

## 消息示例

```text
快讯：美联储官员表示，在通胀持续回落前仍需保持谨慎。
```

```text
新Polymarket：市场上线“美联储会在9月降息吗？”预测事件。
```

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

Polymarket 原文通常是英文，没有 `OPENAI_API_KEY` 时会跳过，不会把英文直接发到中文频道。

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

第一版默认关闭 GDELT，等财联社链路稳定后再打开，避免频道一下子太吵。

## 4. 关键参数

| 参数 | 默认值 | 作用 |
|---|---:|---|
| `POLL_INTERVAL_SECONDS` | 120 | 每两分钟检查一次 |
| `MAX_NEWS_AGE_MINUTES` | 180 | 只处理三小时内新闻 |
| `MAX_ITEMS_PER_CYCLE` | 8 | 每轮最多发送8条 |
| `DEFAULT_PREFIX` | 快讯 | 普通消息前缀 |
| `INCLUDE_SOURCE_URL` | false | 是否在正文显示原文链接 |
| `INCLUDE_KEYWORDS` | 空 | 留空不过滤 |
| `EXCLUDE_KEYWORDS` | 广告等 | 排除垃圾内容 |
| `DRY_RUN` | false | true时只在终端预览 |

## 5. Docker 启动

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

## 6. 当前去重逻辑

机器人会同时记录：

- 新闻源自己的 item ID
- 标题与摘要的标准化 Hash
- 最终中文消息的 Hash

因此同一条新闻被重复抓取时，一般不会再次发送。跨语言、完全不同措辞的同一事件，后续可以再加入语义去重。

## 7. 第一版边界

暂时不做：

- 重要程度分级
- X 网页抓取
- 私人 Discord 群 self-bot 抓取
- 自动投资建议
- 多服务器后台管理

先确保“财联社 → 中文短讯 → Discord”长期稳定，再扩展到其他来源。

## 安全与版权

- 不要提交 `.env`、Webhook URL 或 API Key。
- 新闻正文只做短摘要，保留原始 URL 能力，避免整篇转载。
- RSSHub 路由属于非官方聚合链路，网站改版后可能暂时失效。
