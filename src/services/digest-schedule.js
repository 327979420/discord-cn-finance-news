// Decides when a digest card is due. Slots are wall-clock times in the digest
// timezone (Beijing by default). A run posts the latest slot that has passed,
// once, as long as it is not more than maxLateMinutes old. A slot missed by
// more than that is skipped: its news simply goes into the next card, because
// every card covers everything since the previous card.

export function localParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return parts;
}

// Offset of timeZone from UTC at the given moment, in minutes.
function offsetMinutes(date, timeZone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// The UTC instant of HH:MM on the local calendar day that contains `date`, shifted by dayOffset days.
function slotInstant(date, time, timeZone, dayOffset) {
  const p = localParts(date, timeZone);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + dayOffset, hour, minute);
  return new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60000);
}

// The most recent slot at or before `now`, with its key (local date + time).
export function latestSlot(digest, now = new Date()) {
  let best;
  for (const dayOffset of [0, -1]) {
    for (const slot of digest.slots) {
      const at = slotInstant(now, slot.time, digest.timezone, dayOffset);
      if (at.getTime() > now.getTime()) continue;
      if (!best || at > best.at) {
        const local = localParts(at, digest.timezone);
        best = { ...slot, at, key: `${local.year}-${local.month}-${local.day} ${slot.time}` };
      }
    }
  }
  return best;
}

// { due: true, slot } when this run should post a card; otherwise why not.
export function digestDue(digest, lastSlotKey, now = new Date()) {
  const slot = latestSlot(digest, now);
  if (!slot) return { due: false, reason: "no-slot" };
  if (lastSlotKey && lastSlotKey >= slot.key) return { due: false, reason: "already-posted", slot };
  const lateMinutes = (now.getTime() - slot.at.getTime()) / 60000;
  if (lateMinutes > digest.maxLateMinutes) return { due: false, reason: "missed", slot };
  return { due: true, slot };
}

// "11月19日" for the card title.
export function localDateLabel(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${Number(p.month)}月${Number(p.day)}日`;
}

export function localTimeLabel(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}
