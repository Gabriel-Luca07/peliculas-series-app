// Combining changes made on two computers that share the data folder (e.g.
// through OneDrive). When this app saves a list that another computer has
// changed on disk since this one last read it, the three versions are merged
// title by title (by `id`):
//   base   what this app last read or wrote
//   mine   what it wants to save now
//   theirs what's on disk now
// A title changed on only one side keeps that change; changed on both, this
// computer's version wins (it's the most recent edit); added on either side,
// it's kept; deleted on one side and untouched on the other, it's deleted.

function syncItemsById(list) {
  const map = new Map();
  (list || []).forEach((item) => { if (item && item.id != null) map.set(item.id, item); });
  return map;
}

const sameSyncItem = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeById(base, mine, theirs) {
  const baseMap = syncItemsById(base);
  const mineMap = syncItemsById(mine);
  const theirsMap = syncItemsById(theirs);
  const result = [];
  const seen = new Set();

  const decide = (id) => {
    const b = baseMap.get(id);
    const m = mineMap.get(id);
    const t = theirsMap.get(id);
    if (m && t) {
      if (!b) return m; // added on both sides with the sameSyncItem id: keep mine
      if (sameSyncItem(m, b)) return t; // only theirs changed (or nothing did)
      return m; // mine changed (and maybe theirs too): mine wins
    }
    if (m && !t) {
      // Missing on disk: either they deleted it or I just added it.
      if (!b) return m;
      return sameSyncItem(m, b) ? null : m; // deleted there; keep it only if I changed it
    }
    if (!m && t) {
      if (!b) return t; // added there
      return sameSyncItem(t, b) ? null : t; // I deleted it; keep it only if they changed it
    }
    return null;
  };

  // Keep this computer's order, then add what only the other one has.
  [...mineMap.keys(), ...theirsMap.keys()].forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const item = decide(id);
    if (item) result.push(item);
  });
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mergeById };
}
