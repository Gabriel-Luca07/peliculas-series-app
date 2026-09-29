// Filtering and sorting of the Pendientes and Vistas lists. `filters` holds
// the toolbar values: type, platform, genre, tag, search, sort (and ratingMin
// for Vistas); empty means "any". The platform filter can also be
// ON_MY_SUBSCRIPTIONS: titles streaming on one of `activePlatforms` (the
// subscriptions currently active), using each title's `availableOn`.

const ON_MY_SUBSCRIPTIONS = '__subs__';

function matchesListFilters(m, filters) {
  const { type, platform, genre, tag, search, activePlatforms } = filters;
  if (type && (m.type || 'pelicula') !== type) return false;
  if (platform === ON_MY_SUBSCRIPTIONS) {
    const available = m.availableOn || [];
    if (!(activePlatforms || []).some((p) => available.includes(p))) return false;
  } else if (platform && m.platform !== platform) {
    return false;
  }
  if (genre && !(m.genres || []).includes(genre)) return false;
  if (tag && !(m.tags || []).includes(tag)) return false;
  if (search && !m.title.toLowerCase().includes(search.trim().toLowerCase())) return false;
  return true;
}

function filterSortPendientes(list, filters) {
  const sort = filters.sort;
  return list
    .filter((m) => matchesListFilters(m, filters))
    .sort((a, b) => {
      if (sort === 'added-asc') return (a.dateAdded || '').localeCompare(b.dateAdded || '');
      if (sort === 'title-asc') return a.title.localeCompare(b.title, 'es');
      return (b.dateAdded || '').localeCompare(a.dateAdded || '');
    });
}

function filterSortVistas(list, filters) {
  const sort = filters.sort;
  const ratingMin = Number(filters.ratingMin) || 0;
  return list
    .filter((m) => matchesListFilters(m, filters))
    .filter((m) => !ratingMin || (m.rating || 0) >= ratingMin)
    .sort((a, b) => {
      if (sort === 'rating-desc') return (b.rating || 0) - (a.rating || 0);
      if (sort === 'rating-asc') return (a.rating || 0) - (b.rating || 0);
      if (sort === 'date-asc') return (a.dateWatched || '').localeCompare(b.dateWatched || '');
      return (b.dateWatched || '').localeCompare(a.dateWatched || '');
    });
}

// Tags typed as "a, b ,a" -> ['a', 'b'].
function parseTagsInput(value) {
  return [...new Set(String(value || '').split(',').map((t) => t.trim()).filter(Boolean))];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ON_MY_SUBSCRIPTIONS, matchesListFilters, filterSortPendientes, filterSortVistas, parseTagsInput };
}
