# Finance News Discord Bot

**A quick financial-market briefing, delivered directly to Discord.**

Keeping up with markets should not mean checking several news sites all day. This tool brings financial headlines and market alerts into one stream of short Chinese messages for me and my Discord group.

## A message from the feed

> 快讯：Binance以每股80.84美元收购Circle价值1亿美元股份，双方达成新五年合作协议。

Delivered on 22 September 2026 from BlockBeats. This is an archived output example, not a fresh news update. [Delivery run](https://github.com/327979420/discord-cn-finance-news/actions/runs/35722636955).

## From sources to briefing

**Collect → Filter → Deduplicate → Summarise → Deliver to Discord**

The pipeline screens for relevance and freshness, filters repeated items and similar headlines, then sends compact Chinese updates. Each message focuses on one event, with an occasional image when useful.

Duplicate checks use source IDs, content and message hashes, and headline similarity. They reduce repetition but may miss the same event described very differently.

## Sources

Yahoo Taiwan financial RSS and BlockBeats provide news; Yahoo public market pages supply price-move alerts. GDELT adds keyword-based international coverage, and Polymarket adds probability-move context. RSS/RSSHub feeds, including CLS, can be enabled in [source configuration](config/sources.json).

English-source summaries and Polymarket alerts require an OpenAI key. Chinese sources can still provide short updates without it. Source availability can vary.

## Run locally

Requires Node.js 22.13+; Node.js 24 is recommended. No runtime packages to install.

```bash
cp .env.example .env
DRY_RUN=true npm run run:once
```

Set `DISCORD_WEBHOOK_URL` and, for AI summaries, `OPENAI_API_KEY` in `.env`. Preview first, then use `npm start` for ongoing delivery. Keep credentials private.

GitHub Actions is configured to check every ten minutes, subject to runner delays. Run `npm run check` for validation.

[Setup, Docker, retention, and advanced configuration](docs/operations.md)

Built for quick market awareness, not investment advice.
