# Finance News Discord Bot

**A quick financial-market briefing, delivered directly to Discord.**

Keeping up with markets should not mean checking several news sites all day. This tool brings financial headlines and market alerts into one stream of short Chinese messages for me and my Discord group.

## A message from the feed

> 快讯：Binance以每股80.84美元收购Circle价值1亿美元股份，双方达成新五年合作协议。

Delivered on 22 September 2026 from BlockBeats. This is an archived output example, not a fresh news update. [Delivery run](https://github.com/327979420/discord-cn-finance-news/actions/runs/35722636955).

## From sources to briefing

**Collect → Filter → Deduplicate → Edit with Claude → One card per slot**

Four times a day (07:30, 12:00, 17:00 and 21:15 Beijing time) the bot posts one Discord card: the main story, a compact market row, then a few lines by topic, each merging every source on the same event and linking to them. Headless Claude Code rewrites Traditional Chinese and English into simplified Chinese and drops teaser headlines; code removes any line whose numbers its sources do not contain. Between cards, only real emergencies (circuit breakers, defaults, war, large market moves) post on their own, at most three a day.

Duplicate checks use source IDs, content and message hashes, and headline similarity. They reduce repetition but may miss the same event described very differently.

## Sources

Yahoo Taiwan financial RSS and BlockBeats provide news; Yahoo public market pages supply price-move alerts. GDELT adds keyword-based international coverage, and Polymarket adds probability-move context. RSS/RSSHub feeds, including CLS, can be enabled in [source configuration](config/sources.json).

English sources go into the cards only, translated by Claude. Without a Claude token the cards still post, with unedited headlines. Source availability can vary.

## Run locally

Requires Node.js 22.13+; Node.js 24 is recommended. No runtime packages to install.

```bash
cp .env.example .env
DRY_RUN=true npm run run:once
```

Set `DISCORD_WEBHOOK_URL` and, for AI summaries, `OPENAI_API_KEY` in `.env`. Preview first, then use `npm start` for ongoing delivery. Keep credentials private.

A Cloudflare Worker (`scheduler/`) runs the GitHub Actions workflow every 15 minutes; GitHub's own schedule is only a backup. Run `npm run check` for validation.

[Setup, Docker, retention, and advanced configuration](docs/operations.md)

Built for quick market awareness, not investment advice.
