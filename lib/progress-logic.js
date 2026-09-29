// Pure logic for series progress in the "Viendo" tab. `seasons` is the TMDB
// season list ({ seasonNumber, airDate, episodeCount }) when known, or
// null/[] for titles without TMDB data — then everything degrades to a plain
// episode counter like before. currentEpisode is the last episode watched.

function episodeCountFor(seasons, seasonNumber) {
  const season = (seasons || []).find((s) => s.seasonNumber === seasonNumber);
  return season && season.episodeCount ? season.episodeCount : null;
}

// Result of pressing "+1 episode":
// - event 'episode': just the next episode.
// - event 'season-finished': that was the season's last episode and the next
//   season is already out, so progress moves to it (no episode watched yet).
// - event 'caught-up': last episode of the last season that's out.
function advanceEpisode(progress, seasons, today) {
  const season = Number(progress.currentSeason) || 1;
  const episode = (Number(progress.currentEpisode) || 0) + 1;
  const count = episodeCountFor(seasons, season);
  if (!count || episode < count) {
    // Without TMDB data and no season set, keep it a bare episode counter.
    const knownSeason = Number(progress.currentSeason) || (count ? season : null);
    return { currentSeason: knownSeason, currentEpisode: episode, event: 'episode' };
  }
  const next = (seasons || []).find((s) => s.seasonNumber === season + 1);
  if (next && next.airDate && next.airDate <= today) {
    return { currentSeason: season + 1, currentEpisode: null, event: 'season-finished', finishedSeason: season };
  }
  return { currentSeason: season, currentEpisode: count, event: 'caught-up' };
}

// Badge text on a card: "Viendo T2 · E5/9" (the "/9" only when TMDB told us
// how many episodes the season has).
function formatProgress(currentSeason, currentEpisode, episodeCount) {
  if (!currentSeason && !currentEpisode) return 'Viendo';
  const seasonPart = currentSeason ? ` T${currentSeason}` : '';
  let episodePart = '';
  if (currentEpisode) {
    episodePart = `${currentSeason ? ' ·' : ''} E${currentEpisode}${episodeCount ? `/${episodeCount}` : ''}`;
  }
  return `Viendo${seasonPart}${episodePart}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { episodeCountFor, advanceEpisode, formatProgress };
}
