// Minimal Markdown to HTML for the release notes shown in the app: headings
// (#, ##, ###), bullet lists (- or *), paragraphs, **bold**, `code` and
// [links](https://...). Everything is escaped first, so notes can't inject
// HTML; links only allow http(s) and open in the browser (main.js sends any
// new window there).

function escapeMd(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function inlineMd(text) {
  return escapeMd(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let inList = false;

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inlineMd(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (inList) out.push('</ul>');
    inList = false;
  };

  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (!line.trim()) {
      flushParagraph();
      closeList();
    } else if (heading) {
      flushParagraph();
      closeList();
      // Notes start at "##": keep them below the modal's own title.
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      if (!inList) out.push('<ul>');
      inList = true;
      out.push(`<li>${inlineMd(bullet[1])}</li>`);
    } else if (inList && /^\s+\S/.test(raw)) {
      // Continuation of the previous bullet.
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inlineMd(line.trim())}</li>`);
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  });
  flushParagraph();
  closeList();
  return out.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { markdownToHtml };
}
