// Pure logic for "pendientes disponibles en tus plataformas": which pending
// titles can be streamed on a platform you're paying for right now, and when
// their platform field should switch to it. `availableOn` is the list of app
// platform names a title streams on (included in the subscription, free or
// with ads — not rent/buy), as last seen on TMDB.

// App platform names from TMDB provider names. `normalize` maps a TMDB name
// to the app's name (or null when the app doesn't know it: then the TMDB name
// is kept, trimmed — some come with trailing spaces).
function streamingPlatformsFor(providerNames, normalize) {
  return [...new Set((providerNames || [])
    .map((n) => String(n).trim())
    .filter(Boolean)
    .map((n) => normalize(n) || n))];
}

// For every item ({ id, platform, availableOn }) streamable on at least one
// of `activePlatforms`: those platforms (in the order of activePlatforms) and
// `newPlatform`, the one to switch its platform field to — null when it's
// already set to one of them, or when the user undid that exact switch
// before (`ignoredSwitches` has `${id}:${platform}`).
function matchPendingToSubscriptions(items, activePlatforms, ignoredSwitches) {
  const ignored = ignoredSwitches || new Set();
  const matches = [];
  items.forEach((item) => {
    const available = new Set(item.availableOn || []);
    const onYours = activePlatforms.filter((p) => available.has(p));
    if (!onYours.length) return;
    const alreadyThere = onYours.includes(item.platform);
    const target = onYours.find((p) => !ignored.has(`${item.id}:${p}`)) || null;
    matches.push({
      movieId: item.id,
      platforms: onYours,
      newPlatform: alreadyThere ? null : target,
    });
  });
  return matches;
}

// Which matches deserve a system notification: one per title and platform,
// only the first time it shows up. Keys of titles that stopped being
// available are forgotten, so leaving and coming back to a platform notifies
// again.
function pickAvailabilityNotifications(matches, notifiedKeys) {
  const seen = new Set(notifiedKeys || []);
  const current = [];
  const toNotify = [];
  matches.forEach((m) => {
    const key = `${m.movieId}:${m.platforms[0]}`;
    current.push(key);
    if (!seen.has(key)) toNotify.push(m);
  });
  return { toNotify, notifiedKeys: current };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { streamingPlatformsFor, matchPendingToSubscriptions, pickAvailabilityNotifications };
}
