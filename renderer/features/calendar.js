// "Exportar al calendario": an .ics file with the upcoming dates the app
// knows about — next episodes of your series, new seasons and sequels
// announced with a date (Novedades), and renewals of the subscriptions that
// will renew. The file format lives in lib/calendar-ics.js. Plain
// global-scope script — see updater.js for the load-order note.

/* ---------- Calendar export ---------- */

function collectCalendarEvents() {
  const cache = tmdbCache();
  const today = todayLocalDateString();
  const events = [];

  movies.filter((m) => m.type === 'serie' && m.tmdbId).forEach((m) => {
    const entry = cache[`tv:${m.tmdbId}`];
    if (entry) events.push(episodeEvent(m.tmdbId, m.title, entry.nextEpisode));
  });

  const { series, sequels } = computeFollowups();
  series.forEach((s) => {
    const tmdbId = s.key.split(':')[1];
    s.newSeasons.forEach((season) => events.push(seasonEvent(tmdbId, s.title, season)));
  });
  sequels.forEach((p) => events.push(sequelEvent(p)));

  subscriptions.filter((s) => s.active && s.willRenew !== false).forEach((s) => {
    const remaining = subscriptionDaysRemaining(s);
    if (remaining == null) return;
    events.push(renewalEvent(s.platform, shiftDateString(today, remaining), s.price));
  });

  return upcomingOnly(events, today);
}

async function exportCalendar() {
  if (settings.tmdbApiKey) {
    // Make sure every series has its next episode cached (fresh ones aren't
    // fetched again).
    await refreshTvDetails(movies.filter((m) => m.type === 'serie' && m.tmdbId));
  }
  const events = collectCalendarEvents();
  if (!events.length) {
    showToast('No hay ningún estreno ni renovación con fecha próxima que exportar', 'error');
    return;
  }
  const res = await window.api.saveCalendar(buildCalendar(events, new Date()));
  if (res.canceled) return;
  if (res.error) {
    showToast('No se pudo guardar el calendario', 'error');
    return;
  }
  showToast(`Calendario guardado con ${events.length} ${pluralize(events.length, 'fecha')}. Impórtalo en Google Calendar, Outlook o el calendario que uses.`, 'success', { duration: 6000 });
}

function bindCalendarEvents() {
  $('#btn-export-calendar').addEventListener('click', exportCalendar);
  $('#btn-export-calendar-followups').addEventListener('click', exportCalendar);
}
