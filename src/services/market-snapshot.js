// Turns the latest Yahoo quotes into the few compact rows at the top of a
// digest card, e.g. "美股  标普 -0.83% · 纳指 +0.12% · 道指 **-1.21%**".
// Which regions show, and in what order, depends on the slot: at 21:15 Beijing
// the US rows would only repeat yesterday's close, so that slot leaves them out.

const ROW_LABEL = { us: "美股", asia: "亚太", europe: "欧洲", stocks: "个股", cross: "资产" };
const STOCK_MOVER_MIN_PCT = 2;
const MAX_STOCK_MOVERS = 5;

export function formatPct(value) {
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}%`;
}

function quoteText(quote) {
  const pct = formatPct(quote.changePct);
  const strong = quote.dayThreshold > 0 && Math.abs(quote.changePct) >= quote.dayThreshold;
  return `${quote.short || quote.name} ${strong ? `**${pct}**` : pct}`;
}

export function regionOf(quote) {
  if (quote.region) return quote.region;
  if (quote.group === "stock" || quote.type === "stock") return "stocks";
  if (quote.group === "cross-asset") return "cross";
  return undefined;
}

// [{ label, text }] for the regions this slot shows, skipping empty ones.
export function snapshotRows(quotes, regions) {
  const rows = [];
  for (const region of regions) {
    let picked = quotes.filter((quote) => regionOf(quote) === region && Number.isFinite(quote.changePct));
    if (region === "stocks") {
      picked = picked
        .filter((quote) => Math.abs(quote.changePct) >= STOCK_MOVER_MIN_PCT)
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, MAX_STOCK_MOVERS);
    }
    if (picked.length) rows.push({ label: ROW_LABEL[region] || region, text: picked.map(quoteText).join(" · ") });
  }
  return rows;
}

// Plain lines handed to Claude so it can tie a story to the move it explains.
export function snapshotForPrompt(quotes) {
  return quotes
    .filter((quote) => Number.isFinite(quote.changePct))
    .map((quote) => `${quote.name}${quote.type === "stock" ? `（${quote.symbol}）` : ""} ${formatPct(quote.changePct)}，最新 ${quote.price}`)
    .join("\n");
}
