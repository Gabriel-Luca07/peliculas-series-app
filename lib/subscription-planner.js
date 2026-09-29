// "¿Qué plataforma me compensa contratar?": how long the pending titles on a
// platform would take to watch at your real pace, and what that would cost.
// Titles are the app's movie objects (runtime in minutes, dateWatched); `sub`
// is the platform's subscription entry ({ active, startDate, price, cycleDays }).

// Days where a whole backlog was logged at once (same dateWatched for many
// titles) count at most this much, so they don't inflate the real pace.
const DAILY_PACE_CAP_MINUTES = 4 * 60;
// Pace used when there isn't enough history to measure one.
const DEFAULT_WEEKLY_PACE_HOURS = 3;

// Hours watched per week over the span of `watchedList` (titles with
// dateWatched and runtime), never over less than one week. Null when empty.
function weeklyPaceHours(watchedList) {
  if (!watchedList.length) return null;
  const minutesByDay = {};
  watchedList.forEach((m) => {
    minutesByDay[m.dateWatched] = (minutesByDay[m.dateWatched] || 0) + m.runtime;
  });
  const days = Object.keys(minutesByDay).sort();
  const cappedTotalMinutes = Object.values(minutesByDay)
    .reduce((s, minutes) => s + Math.min(minutes, DAILY_PACE_CAP_MINUTES), 0);
  const spanDays = Math.max((new Date(days[days.length - 1]) - new Date(days[0])) / 86400000, 7);
  return (cappedTotalMinutes / 60) / (spanDays / 7);
}

// The pace to plan with: your pace on this platform since you activated it
// (when it's active and measurable), else your general pace, else a default.
function planningPace(watched, platform, activeSince) {
  const timed = watched.filter((m) => m.dateWatched && m.runtime);
  if (activeSince) {
    const onPlatform = weeklyPaceHours(timed.filter((m) => m.platform === platform && m.dateWatched >= activeSince));
    if (onPlatform && onPlatform > 0.1) return { hours: onPlatform, source: 'platform' };
  }
  const general = weeklyPaceHours(timed);
  if (general && general > 0.1) return { hours: general, source: 'general' };
  return { hours: DEFAULT_WEEKLY_PACE_HOURS, source: 'default' };
}

// Plan for one platform. `pending` are the pending titles on it. Returns null
// when there's nothing pending there; weeksNeeded etc. are null when none of
// them has a runtime to measure.
function planPlatform(platform, pending, watched, sub) {
  if (!pending.length) return null;
  const withRuntime = pending.filter((m) => m.runtime);
  const totalMinutes = withRuntime.reduce((s, m) => s + m.runtime, 0);
  const base = {
    platform,
    active: !!sub.active,
    pendingCount: pending.length,
    missingCount: pending.length - withRuntime.length,
    totalMinutes,
  };
  if (!totalMinutes) return { ...base, weeksNeeded: null, daysNeeded: null, pace: null, estimatedCost: null };

  const pace = planningPace(watched, platform, sub.active ? sub.startDate : null);
  const weeksNeeded = Math.max(Math.ceil((totalMinutes / 60) / pace.hours), 1);
  const daysNeeded = weeksNeeded * 7;
  const cycleDays = sub.cycleDays || 30;
  const isMonthly = cycleDays <= 31;
  const monthsNeeded = isMonthly ? Math.max(Math.ceil(daysNeeded / 30), 1) : null;
  let estimatedCost = null;
  if (sub.price != null) {
    estimatedCost = isMonthly ? monthsNeeded * sub.price : (sub.price / cycleDays) * daysNeeded;
  }
  return { ...base, pace, weeksNeeded, daysNeeded, cycleDays, isMonthly, monthsNeeded, estimatedCost };
}

// Plans that can be compared (they have a duration), cheapest first; those
// without a price go after, fastest first.
function rankPlans(plans) {
  return plans
    .filter((p) => p && p.weeksNeeded)
    .sort((a, b) => {
      if (a.estimatedCost != null && b.estimatedCost != null) return a.estimatedCost - b.estimatedCost;
      if (a.estimatedCost != null) return -1;
      if (b.estimatedCost != null) return 1;
      return a.weeksNeeded - b.weeksNeeded;
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DAILY_PACE_CAP_MINUTES, weeklyPaceHours, planningPace, planPlatform, rankPlans };
}
