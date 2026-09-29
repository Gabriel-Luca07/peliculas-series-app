// Keyboard use and screen-reader support: cards reachable with Tab and the
// arrow keys (lib/grid-nav.js), shortcuts, names for icon-only buttons, form
// labels tied to their fields, dialogs announced as such with focus kept
// inside them and given back when they close. Plain global-scope script —
// see updater.js for the load-order note.

/* ---------- Accessibility ---------- */

const CARD_GRIDS = ['#list-pendientes', '#list-viendo', '#list-vistas'];

function isTypingTarget(el) {
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function openOverlay() {
  return document.querySelector('.overlay:not(.hidden)');
}

// Icon-only buttons (and ones whose text isn't descriptive) get their
// tooltip as accessible name.
function labelIconButtons(root) {
  const buttons = root.matches && root.matches('button[title]') ? [root] : [];
  if (root.querySelectorAll) buttons.push(...root.querySelectorAll('button[title]'));
  buttons.forEach((btn) => {
    if (!btn.hasAttribute('aria-label') && !btn.textContent.trim()) btn.setAttribute('aria-label', btn.getAttribute('title'));
  });
}

// <label>Texto</label><select id="x"> side by side: tie them together.
function associateLabels() {
  $$('label:not([for])').forEach((label) => {
    if (label.querySelector('input, select, textarea')) return;
    const next = label.nextElementSibling;
    if (next && ['INPUT', 'SELECT', 'TEXTAREA'].includes(next.tagName) && next.id) label.htmlFor = next.id;
  });
}

function markDialogs() {
  $$('.overlay > .modal').forEach((modal, i) => {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = modal.querySelector('h2');
    if (heading) {
      if (!heading.id) heading.id = `dialog-title-${i}`;
      modal.setAttribute('aria-labelledby', heading.id);
    }
  });
}

function initAccessibility() {
  associateLabels();
  markDialogs();
  labelIconButtons(document.body);
  // Lists and panels are re-rendered all the time: label what they add.
  new MutationObserver((mutations) => {
    mutations.forEach((m) => m.addedNodes.forEach((node) => {
      if (node.nodeType === 1) labelIconButtons(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });
}

/* ---------- Focus in dialogs ---------- */

const overlayOpeners = new WeakMap();

// Called by showOverlay/hideOverlay (ui-chrome.js).
function rememberOverlayOpener(overlayEl) {
  if (document.activeElement && document.activeElement !== document.body) {
    overlayOpeners.set(overlayEl, document.activeElement);
  }
  // Put focus inside unless the caller already did (e.g. the search box).
  requestAnimationFrame(() => {
    if (!overlayEl.contains(document.activeElement)) {
      const first = focusableIn(overlayEl)[0];
      if (first) first.focus();
    }
  });
}

function restoreOverlayOpener(overlayEl) {
  const opener = overlayOpeners.get(overlayEl);
  overlayOpeners.delete(overlayEl);
  if (opener && document.contains(opener) && !openOverlay()) opener.focus();
  // Focus left in the now hidden dialog would swallow the shortcuts (it
  // counts as typing in its search box) until the browser moves it out.
  else if (overlayEl.contains(document.activeElement)) document.activeElement.blur();
}

function focusableIn(el) {
  return [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null && !x.closest('.hidden'));
}

function trapTab(e, overlayEl) {
  const items = focusableIn(overlayEl);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------- Cards ---------- */

function cardsOf(grid) {
  return [...grid.querySelectorAll(':scope > .card')];
}

function moveCardFocus(card, key) {
  const cards = cardsOf(card.parentElement);
  const rects = cards.map((c) => ({ left: c.offsetLeft, top: c.offsetTop }));
  const next = cards[nextCardIndex(rects, cards.indexOf(card), key)];
  if (next) {
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }
}

// Keys on a focused card: Enter/Space opens it (or selects it while
// selecting), arrows move around the grid, and single letters run its quick
// actions. Returns whether the key was one of those.
function onCardKeydown(e, card) {
  const quick = (sel) => {
    const btn = card.querySelector(sel);
    if (btn) btn.click();
    return !!btn;
  };
  let handled = true;
  if (e.key === 'Enter' || e.key === ' ') card.click();
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) moveCardFocus(card, e.key);
  else if (e.key === 'v' || e.key === 'V') handled = quick('.quick-watch');
  else if (e.key === 'e' || e.key === 'E' || e.key === '+') handled = quick('.quick-episode');
  else if (e.key === 'r' || e.key === 'R') handled = quick('.quick-rewatch');
  else handled = false;
  if (handled) e.preventDefault();
  return handled;
}

/* ---------- Shortcuts ---------- */

function focusViewSearch() {
  const view = document.querySelector('.view.active');
  const input = view && view.querySelector('.search-box input');
  if (input) {
    input.focus();
    input.select();
  }
}

function bindAccessibilityEvents() {
  document.addEventListener('keydown', (e) => {
    const overlay = openOverlay();
    if (overlay) {
      if (e.key === 'Tab') trapTab(e, overlay);
      return;
    }
    const card = e.target.closest && e.target.closest(CARD_GRIDS.map((g) => `${g} > .card`).join(', '));
    // Other keys (N, /) still work as shortcuts from a card.
    if (card && e.target === card && !e.ctrlKey && !e.metaKey && !e.altKey && onCardKeydown(e, card)) return;
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey) return;
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const nav = $$('.nav-item')[Number(e.key) - 1];
      if (nav) {
        e.preventDefault();
        switchView(nav.dataset.view);
        nav.focus();
      }
    } else if (!e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      openModal(null);
    } else if (!e.altKey && e.key === '/') {
      e.preventDefault();
      focusViewSearch();
    }
  });
}
