// Data behind the dashboard charts ("Resumen"): what each bar/column shows,
// without any DOM. Rendering lives in renderer/features/charts.js.

// Top `n` entries of a { label: count } map, largest first, with the rest
// summed into an 'Otros' entry.
function topNWithOther(counts, n = 6) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, n);
  const restSum = entries.slice(n).reduce((s, [, v]) => s + v, 0);
  if (restSum > 0) top.push(['Otros', restSum]);
  return top;
}

function countGenres(titles) {
  const counts = {};
  titles.forEach((m) => (m.genres || []).forEach((g) => { counts[g] = (counts[g] || 0) + 1; }));
  return counts;
}

function countPlatforms(titles) {
  const counts = {};
  titles.forEach((m) => { if (m.platform) counts[m.platform] = (counts[m.platform] || 0) + 1; });
  return counts;
}

// How many titles got each whole rating from 1 to 10 (index 0 = rating 1).
function ratingBuckets(rated) {
  const counts = new Array(10).fill(0);
  rated.forEach((m) => {
    const r = Math.round(m.rating);
    if (r >= 1 && r <= 10) counts[r - 1] += 1;
  });
  return counts;
}

// Titles watched in each of the last `months` months (oldest first), with
// the month index (0-11) for its label.
function monthlyActivity(watched, now, months = 6) {
  const result = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result.push({ month: d.getMonth(), count: watched.filter((m) => (m.dateWatched || '').startsWith(key)).length });
  }
  return result;
}

// Titles watched per year: at least the last 5 years, at most the last 10.
function watchedPerYear(watched, currentYear) {
  const years = watched.map((m) => (m.dateWatched || '').slice(0, 4)).filter(Boolean).map(Number);
  const minYear = years.length ? Math.min(...years, currentYear - 4) : currentYear - 4;
  const startYear = Math.max(minYear, currentYear - 9);
  const result = [];
  for (let y = startYear; y <= currentYear; y += 1) {
    result.push({ year: y, count: years.filter((wy) => wy === y).length });
  }
  return result;
}

// Watched titles by decade of release ("1990s"...), oldest first; titles
// without a plausible year are left out.
function releaseDecades(watched, currentYear) {
  const releaseYears = watched
    .map((m) => Number(m.year))
    .filter((y) => y && y > 1880 && y <= currentYear + 1);
  const decades = [...new Set(releaseYears.map((y) => Math.floor(y / 10) * 10))].sort((a, b) => a - b);
  return decades.map((d) => ({ decade: d, count: releaseYears.filter((y) => Math.floor(y / 10) * 10 === d).length }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { topNWithOther, countGenres, countPlatforms, ratingBuckets, monthlyActivity, watchedPerYear, releaseDecades };
}
