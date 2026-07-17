// Subscription lifecycle logic shared by main.js (the authoritative source —
// reconciles/persists) and renderer.js (display-only helpers). Loaded as a
// classic <script> in the renderer (after date-utils.js, so those functions
// are already global) and required as a CommonJS module from main.js/tests.

const dateUtils = (typeof module !== 'undefined' && module.exports)
  ? require('./date-utils')
  : { todayLocalDateString, addDaysToDateString, daysElapsedSince, localDateStringAt };

const randomUUID = (typeof module !== 'undefined' && module.exports)
  ? require('crypto').randomUUID
  : () => crypto.randomUUID();

const MAX_AUTO_RENEWALS_PER_LOAD = 500;

function dateRangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

// A platform can't really be billed twice for the same real-world period, so
// activating (or editing the date/cycle of) a subscription is blocked if the
// resulting period would overlap an existing history record for that same
// platform — e.g. paying for HBO annually Jan 2025 - Jan 2026, then trying to
// also add a monthly HBO period starting in the middle of that. `excludeId` lets
// the entry's own currently-linked history record be excluded when re-checking
// after an edit (it's being moved, not conflicting with itself).
function findOverlappingHistoryEntry(history, platform, startDate, cycleDays, excludeId) {
  const endDate = dateUtils.addDaysToDateString(startDate, cycleDays);
  return history.find((h) => (
    h.platform === platform
    && h.id !== excludeId
    && dateRangesOverlap(startDate, endDate, h.startDate, dateUtils.addDaysToDateString(h.startDate, h.cycleDays || 30))
  ));
}

// Rolls a single subscription entry through any elapsed cycles (creating one new
// history entry per cycle, same as real recurring billing) and/or backfills a
// missing historyId, mutating `entry` and `history` in place. Returns true if
// anything changed, so callers know whether a write is needed.
function reconcileSubscriptionEntry(entry, history) {
  let changed = false;
  // Backfill first, before the roll-forward loop below: subscriptions activated
  // before "Historial de gasto" existed (or otherwise missing their link) would
  // never show up there. If this ran after the loop instead, one that already ran
  // past its cycle by the time this runs would get expired (its historyId wiped)
  // before ever being backfilled, and its whole billing period would vanish
  // without a trace instead of just aging into "finished".
  if (entry.active && entry.startDate && !entry.historyId) {
    const historyEntry = {
      id: randomUUID(),
      platform: entry.platform,
      price: entry.price,
      cycleDays: entry.cycleDays || 30,
      startDate: entry.startDate,
      cancelledAt: entry.willRenew === false ? dateUtils.todayLocalDateString() : null,
    };
    history.unshift(historyEntry);
    entry.historyId = historyEntry.id;
    changed = true;
  }
  // A subscription you never cancelled keeps getting charged in real life, so
  // as long as willRenew isn't explicitly false, each elapsed cycle rolls it
  // forward into a brand new history entry (a new charge) instead of just going
  // back to "Sin activar" — this also catches up on however many cycles passed
  // since it was last checked. Only a cancelled one (willRenew === false)
  // actually deactivates once its paid-for cycle ends.
  const cycle = entry.cycleDays || 30;
  let renewals = 0;
  while (entry.active && entry.startDate && dateUtils.daysElapsedSince(entry.startDate) >= cycle && renewals < MAX_AUTO_RENEWALS_PER_LOAD) {
    renewals += 1;
    if (entry.willRenew === false) {
      entry.active = false;
      entry.startDate = null;
      entry.willRenew = true;
      entry.historyId = null;
      changed = true;
      break;
    }
    const newStartDate = dateUtils.addDaysToDateString(entry.startDate, cycle);
    const historyEntry = {
      id: randomUUID(),
      platform: entry.platform,
      price: entry.price,
      cycleDays: cycle,
      startDate: newStartDate,
      cancelledAt: null,
    };
    history.unshift(historyEntry);
    entry.startDate = newStartDate;
    entry.historyId = historyEntry.id;
    changed = true;
  }
  return changed;
}

// Display-only helper (renderer): how many days are left in the current cycle.
function subscriptionDaysRemaining(sub) {
  if (!sub.active || !sub.startDate) return null;
  const cycle = sub.cycleDays || 30;
  const elapsedDays = dateUtils.daysElapsedSince(sub.startDate);
  if (!Number.isFinite(elapsedDays)) return null;
  return Math.min(Math.max(cycle - elapsedDays, 0), cycle);
}

// Display-only helper (renderer): is a history entry still the ongoing period
// for its platform, and was it already cancelled (still with access) or not.
function getHistoryEntryStatus(entry, subscriptions) {
  const isOngoing = subscriptions.some((s) => s.historyId === entry.id && s.active);
  const plannedEnd = dateUtils.addDaysToDateString(entry.startDate, entry.cycleDays || 30);
  if (!isOngoing) return { kind: 'finished', plannedEnd };
  return entry.cancelledAt ? { kind: 'cancelled-active', plannedEnd } : { kind: 'active', plannedEnd };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_AUTO_RENEWALS_PER_LOAD,
    dateRangesOverlap,
    findOverlappingHistoryEntry,
    reconcileSubscriptionEntry,
    subscriptionDaysRemaining,
    getHistoryEntryStatus,
  };
}
