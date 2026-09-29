// Arrow-key navigation over a grid of cards laid out by CSS (the number of
// columns depends on the window width). Works from each card's position:
// rects are { left, top } in the same order as the cards in the page.

// Cards of the same row are within this many pixels vertically.
const SAME_ROW_TOLERANCE = 8;

// Index of the card to move to from `current` with `key` (ArrowLeft,
// ArrowRight, ArrowUp, ArrowDown, Home, End), or `current` when there's
// nowhere to go.
function nextCardIndex(rects, current, key) {
  if (!rects.length) return -1;
  const last = rects.length - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (key === 'ArrowLeft') return Math.max(current - 1, 0);
  if (key === 'ArrowRight') return Math.min(current + 1, last);
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return current;

  const from = rects[current];
  const down = key === 'ArrowDown';
  const candidates = rects
    .map((r, i) => ({ ...r, i }))
    .filter((r) => (down ? r.top > from.top + SAME_ROW_TOLERANCE : r.top < from.top - SAME_ROW_TOLERANCE));
  if (!candidates.length) return current;
  // The nearest row in that direction...
  const rowTop = down
    ? Math.min(...candidates.map((r) => r.top))
    : Math.max(...candidates.map((r) => r.top));
  const row = candidates.filter((r) => Math.abs(r.top - rowTop) <= SAME_ROW_TOLERANCE);
  // ...and in it, the card closest to the same column.
  row.sort((a, b) => Math.abs(a.left - from.left) - Math.abs(b.left - from.left));
  return row[0].i;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nextCardIndex };
}
