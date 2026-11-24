// Lays out a digest as one Discord embed: title with slot and date, the main
// story in bold, compact market rows, then one field per topic with each line
// followed by its source links. Layout lives here, not in the prompt, so every
// card looks the same whichever writer produced the text.

import { localDateLabel } from "./digest-schedule.js";

const COLOR = 0x3b82f6;
const FIELD_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;
const EMBED_BUDGET = 5600; // Discord allows 6000 characters per embed; leave room for title and footer

const SOURCE_LABEL = [
  [/^BlockBeats/i, "律动"],
  [/^方程式/, "方程式"],
  [/^Yahoo/i, "Yahoo"],
  [/^Polymarket/i, "Polymarket"],
  [/^GDELT · (.+)$/, (match) => match[1].replace(/^www\./, "")],
  [/^财联社|^CLS/i, "财联社"]
];

export function sourceLabel(source) {
  for (const [pattern, label] of SOURCE_LABEL) {
    const match = String(source).match(pattern);
    if (match) return typeof label === "function" ? label(match) : label;
  }
  return String(source);
}

// "[律动](url) · [Yahoo](url)", one link per source, plain text when there is no URL.
export function sourceLinks(items) {
  const seen = new Map();
  for (const item of items) {
    const label = sourceLabel(item.source);
    if (!seen.has(label) || (!seen.get(label) && item.url)) seen.set(label, item.url);
  }
  return [...seen].map(([label, url]) => (url ? `[${label}](${url})` : label)).join(" · ");
}

function escapeMarkdown(text) {
  return String(text).replace(/([*_`~|>\\[\]])/g, "\\$1");
}

// Splits a topic's lines over as many fields as the 1024-character limit needs.
function topicFields(name, lines) {
  const fields = [];
  let current = [];
  let length = 0;
  for (const line of lines) {
    if (current.length && length + line.length + 1 > FIELD_LIMIT) {
      fields.push(current);
      current = [];
      length = 0;
    }
    current.push(line.slice(0, FIELD_LIMIT));
    length += line.length + 1;
  }
  if (current.length) fields.push(current);
  return fields.map((chunk, index) => ({ name: index ? "\u200b" : name, value: chunk.join("\n"), inline: false }));
}

export function buildDigestEmbed({ slot, digest, marketRows, timeZone, now = new Date(), windowLabel }) {
  const description = [];
  if (digest.headline) description.push(`**${escapeMarkdown(digest.headline)}**`);
  if (marketRows.length) {
    if (description.length) description.push("");
    for (const row of marketRows) description.push(`\`${row.label}\` ${row.text}`);
  }
  const render = (withUrls) => digest.sections.flatMap((section) => topicFields(section.topic, section.lines.map((line) => {
    const links = withUrls ? sourceLinks(line.items.slice(0, 3)) : sourceLinks(line.items.slice(0, 3).map(({ url, ...item }) => item));
    return `• ${escapeMarkdown(line.text)}  ${links}`;
  })));
  // Yahoo article URLs are long; drop them if the card would pass Discord's 6000-character limit.
  let fields = render(true);
  const size = (list) => list.reduce((total, field) => total + field.name.length + field.value.length, 0) + description.join("\n").length;
  if (size(fields) > EMBED_BUDGET) fields = render(false);
  const footer = [
    windowLabel,
    digest.writer === "claude" ? "Claude 整理" : "原始标题，未经整理",
    "行情为最新报价"
  ].filter(Boolean).join(" · ");
  return {
    title: `${slot.title} · ${localDateLabel(slot.at || now, timeZone)}`,
    color: COLOR,
    ...(description.length ? { description: description.join("\n").slice(0, DESCRIPTION_LIMIT) } : {}),
    fields,
    footer: { text: footer },
    timestamp: now.toISOString()
  };
}

// Text version for dry runs and logs.
export function embedToText(embed) {
  const parts = [`== ${embed.title} ==`];
  if (embed.description) parts.push(embed.description);
  for (const field of embed.fields) parts.push(`\n【${field.name}】\n${field.value}`);
  parts.push(`\n(${embed.footer.text})`);
  return parts.join("\n");
}
