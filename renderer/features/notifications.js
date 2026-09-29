// Delivering Windows notifications: right away (clicking one opens its view,
// and the title's card when it's about a single title), or queued for a
// single daily digest at the hour chosen in Ajustes → Comportamiento. The
// digest logic is in lib/notify-logic.js. Plain global-scope script — see
// updater.js for the load-order note.

/* ---------- Notifications ---------- */

const DIGEST_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_DIGEST_HOUR = 20;

function notifyMode() {
  return localStorage.getItem(pk('pref-notify-mode')) || 'instant';
}

function digestHour() {
  const hour = Number(localStorage.getItem(pk('pref-notify-hour')));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_HOUR;
}

function readDigest() {
  return readStoredJson('notify-digest', emptyDigest());
}

// `lines` are the notice's lines; `movieId` only when it's about one title.
function deliverNotification({ title, lines, view, movieId }) {
  if (notifyMode() === 'digest') {
    writeStoredJson('notify-digest', queueForDigest(readDigest(), lines, view));
    flushDigestIfDue();
    return;
  }
  window.api.notify(title, notificationBody(lines), view, movieId || null);
}

function flushDigestIfDue() {
  const state = readDigest();
  const today = todayLocalDateString();
  if (!digestDue(state, today, new Date().getHours(), digestHour())) return;
  const { notification, state: next } = buildDigest(state, today);
  writeStoredJson('notify-digest', next);
  window.api.notify(notification.title, notification.body, notification.view, null);
}

// Sends whatever was waiting for the digest right away (used when switching
// back to instant notifications), without counting as today's digest.
function flushDigestNow() {
  const state = readDigest();
  if (!state.items.length) return;
  const { notification } = buildDigest(state, todayLocalDateString());
  writeStoredJson('notify-digest', { items: [], lastSent: state.lastSent });
  window.api.notify(notification.title, notification.body, notification.view, null);
}

function startDigestTimer() {
  flushDigestIfDue();
  setInterval(flushDigestIfDue, DIGEST_CHECK_INTERVAL_MS);
}

// A clicked notification: its view, and the title's card if it named one
// that's still in the list.
function openNotificationTarget(target) {
  const { view, movieId } = typeof target === 'string' ? { view: target } : (target || {});
  if (view) switchView(view);
  if (movieId && movies.some((m) => m.id === movieId)) openModal(movieId);
}
