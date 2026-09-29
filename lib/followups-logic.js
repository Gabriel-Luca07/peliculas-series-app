// Pure logic for the "Novedades" view: new seasons of watched series and
// sequels of watched movies. Dates are TMDB-style 'YYYY-MM-DD' strings, which
// compare correctly as plain strings.

// 'released' (already out), 'upcoming' (has a future date) or 'announced'
// (exists on TMDB but has no date yet).
function releaseState(date, today) {
  if (!date) return 'announced';
  return date <= today ? 'released' : 'upcoming';
}

// Seasons of a watched series that the user most likely hasn't seen. A season
// counts as new when its number is above the season count stored on the title
// AND (when we know when it was watched) it didn't air before that date — the
// stored count is often the one from when the title was added as pending, so
// the watch date catches seasons that were already out when it was finished.
// Returns [] when there's nothing to compare against.
function findNewSeasons(item, seasons, today) {
  const knownSeasons = Number(item.seasons) || 0;
  const watchedOn = item.dateWatched || null;
  if (!knownSeasons && !watchedOn) return [];
  return (seasons || [])
    .filter((s) => s.seasonNumber > 0)
    .filter((s) => s.seasonNumber > knownSeasons)
    .filter((s) => !watchedOn || !s.airDate || s.airDate > watchedOn)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map((s) => ({ ...s, state: releaseState(s.airDate, today) }));
}

// Parts of a collection (saga) that come after the earliest part the user has
// watched and that aren't in their list yet. Prequels of what they watched are
// ignored. Each result carries `sequelOf`: the most recent watched part
// released before it.
function findSequels(watchedParts, parts, knownTmdbIds, today) {
  const dated = watchedParts.filter((w) => w.releaseDate);
  if (!dated.length) return [];
  const sortedWatched = [...dated].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  const earliest = sortedWatched[0].releaseDate;
  return (parts || [])
    .filter((p) => !knownTmdbIds.has(p.tmdbId))
    .filter((p) => !p.releaseDate || p.releaseDate > earliest)
    .map((p) => {
      const before = sortedWatched.filter((w) => !p.releaseDate || w.releaseDate < p.releaseDate);
      return {
        ...p,
        state: releaseState(p.releaseDate, today),
        sequelOf: before.length ? before[before.length - 1].title : sortedWatched[0].title,
      };
    });
}

const STATE_ORDER = { released: 0, upcoming: 1, announced: 2 };

// Already-out first (most recent first), then upcoming (soonest first), then
// announced without a date.
function sortByRelease(items, dateOf) {
  return [...items].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState) return byState;
    const da = dateOf(a) || '';
    const db = dateOf(b) || '';
    return a.state === 'released' ? db.localeCompare(da) : da.localeCompare(db);
  });
}

// Which items deserve a system notification. Each item is notified once per
// state (so a sequel announced with a date notifies, and again when it's
// actually out). Undated announcements never notify. `notifiedKeys` is null
// the very first time: then everything is just recorded as already seen, so
// installing the update doesn't fire a pile of notifications at once.
function pickNotifications(items, notifiedKeys) {
  const keys = items
    .filter((i) => i.state !== 'announced')
    .map((i) => ({ item: i, key: `${i.key}:${i.state}` }));
  const seen = new Set(notifiedKeys || []);
  const fresh = notifiedKeys ? keys.filter((k) => !seen.has(k.key)) : [];
  keys.forEach((k) => seen.add(k.key));
  return { toNotify: fresh.map((k) => k.item), notifiedKeys: [...seen] };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { releaseState, findNewSeasons, findSequels, sortByRelease, pickNotifications };
}
