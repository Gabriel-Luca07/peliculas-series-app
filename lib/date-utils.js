// Shared date helpers used by both main.js (Node/Electron main process) and
// renderer.js (loaded as a plain <script> in index.html, so this file also
// works as a classic script — see the module.exports guard at the bottom).
//
// `new Date("YYYY-MM-DD").toISOString()` reads the UTC calendar date, which is
// wrong for "today" in any timezone ahead of UTC (e.g. Spain) for a window
// right after local midnight, and in any timezone behind UTC for a window
// before local midnight — the UTC day can be a day off from the user's actual
// local day. localDateStringAt/todayLocalDateString correct for that.

function localDateStringAt(ms) {
  const offsetMs = new Date(ms).getTimezoneOffset() * 60000;
  return new Date(ms - offsetMs).toISOString().slice(0, 10);
}

function todayLocalDateString() {
  return localDateStringAt(Date.now());
}

function addDaysToDateString(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysElapsedSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { localDateStringAt, todayLocalDateString, addDaysToDateString, daysElapsedSince };
}
