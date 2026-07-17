// Profile field validation/sanitization (main.js-only, split out for testability).

function isValidProfileColor(color) {
  return typeof color === 'string' && (/^series-[1-8]$/.test(color) || /^#[0-9a-fA-F]{6}$/.test(color));
}

function sanitizeProfileInitial(initial) {
  return (initial || '').trim().slice(0, 2) || null;
}

module.exports = { isValidProfileColor, sanitizeProfileInitial };
