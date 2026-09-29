// iCalendar (.ics) export of upcoming releases: episodes of your series, new
// seasons and sequels announced with a date, and subscription renewals. All
// events are all-day; each has a fixed UID so importing the file again
// refers to the same events.

const ICS_UID_DOMAIN = 'peliculas-y-series';

function escapeIcsText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 bytes are folded (CRLF + space), without splitting a
// UTF-8 character.
function foldIcsLine(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function icsDate(date) {
  return date.replace(/-/g, '');
}

function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function icsTimestamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// events: [{ uid, date: 'YYYY-MM-DD', title, description? }]. Returns the
// file contents (CRLF line endings, as the format requires), events sorted
// by date.
function buildCalendar(events, now) {
  const stamp = icsTimestamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Peliculas y Series//Estrenos//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Estrenos (Películas y Series)',
  ];
  [...events].sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@${ICS_UID_DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

// Event builders. Each returns null when there's no date to put it on.

function episodeEvent(tmdbId, seriesTitle, ep) {
  if (!ep || !ep.airDate || !ep.seasonNumber || !ep.episodeNumber) return null;
  return {
    uid: `ep-${tmdbId}-${ep.seasonNumber}-${ep.episodeNumber}`,
    date: ep.airDate,
    title: `${seriesTitle} · T${ep.seasonNumber} E${ep.episodeNumber}`,
    description: ep.name ? `Episodio: ${ep.name}` : '',
  };
}

function seasonEvent(tmdbId, seriesTitle, season) {
  if (!season || !season.airDate) return null;
  return {
    uid: `season-${tmdbId}-${season.seasonNumber}`,
    date: season.airDate,
    title: `${seriesTitle}: estreno de la temporada ${season.seasonNumber}`,
    description: 'Temporada nueva de una serie que has visto.',
  };
}

function sequelEvent(part) {
  if (!part || !part.releaseDate) return null;
  return {
    uid: `movie-${part.tmdbId}`,
    date: part.releaseDate,
    title: `Estreno: ${part.title}`,
    description: part.sequelOf ? `Continuación de ${part.sequelOf}.` : '',
  };
}

function renewalEvent(platform, date, price) {
  if (!date) return null;
  return {
    uid: `renewal-${platform.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}`,
    date,
    title: `Se renueva ${platform}${price != null ? ` (${Number(price).toFixed(2)} €)` : ''}`,
    description: 'Cancélala antes en la app (y en la plataforma) si no quieres que se renueve.',
  };
}

// Keeps events from `today` on, one per UID.
function upcomingOnly(events, today) {
  const seen = new Set();
  return events.filter((e) => {
    if (!e || e.date < today || seen.has(e.uid)) return false;
    seen.add(e.uid);
    return true;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeIcsText, foldIcsLine, buildCalendar, episodeEvent, seasonEvent, sequelEvent, renewalEvent, upcomingOnly,
  };
}
