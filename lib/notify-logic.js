// Windows notifications: the body text, and the optional daily digest (all
// of the day's notices in a single notification at a set hour instead of
// one each time). Digest state: { items: [{ line, view }], lastSent }.

// At most three lines plus "...y N más".
function notificationBody(lines) {
  return lines.length > 3 ? `${lines.slice(0, 3).join('\n')}\n...y ${lines.length - 3} más` : lines.join('\n');
}

function emptyDigest() {
  return { items: [], lastSent: null };
}

function queueForDigest(state, lines, view) {
  const current = state && Array.isArray(state.items) ? state : emptyDigest();
  return { ...current, items: [...current.items, ...lines.map((line) => ({ line, view }))] };
}

// Whether to send the digest now: there's something queued, it's the set
// hour or later, and it hasn't gone out today yet.
function digestDue(state, today, currentHour, digestHour) {
  return !!state && Array.isArray(state.items) && state.items.length > 0
    && currentHour >= digestHour && state.lastSent !== today;
}

// The digest notification and the state after sending it. It opens the view
// all its items share, or Novedades when they're mixed.
function buildDigest(state, today) {
  const lines = state.items.map((i) => i.line);
  const views = [...new Set(state.items.map((i) => i.view))];
  return {
    notification: {
      title: lines.length === 1 ? 'Tu resumen de hoy: 1 novedad' : `Tu resumen de hoy: ${lines.length} novedades`,
      body: notificationBody(lines),
      view: views.length === 1 ? views[0] : 'novedades',
    },
    state: { items: [], lastSent: today },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { notificationBody, emptyDigest, queueForDigest, digestDue, buildDigest };
}
