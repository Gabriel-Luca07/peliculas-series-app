// Shared HTML-escaping helper (renderer-only, but split out for testability).

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml };
}
