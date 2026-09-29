const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeIcsText, foldIcsLine, buildCalendar, episodeEvent, seasonEvent, sequelEvent, renewalEvent, upcomingOnly,
} = require('../lib/calendar-ics');

test('escapeIcsText escapes the characters iCalendar reserves', () => {
  assert.equal(escapeIcsText('a, b; c\\d\ne'), 'a\\, b\\; c\\\\d\\ne');
});

test('foldIcsLine folds at 75 bytes without splitting characters', () => {
  const short = 'SUMMARY:hola';
  assert.equal(foldIcsLine(short), short);
  const long = `SUMMARY:${'ñ'.repeat(60)}`; // 8 + 120 bytes
  const folded = foldIcsLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  parts.forEach((p) => assert.ok(Buffer.byteLength(p) <= 75, p));
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), long);
});

test('buildCalendar: all-day events sorted by date with CRLF endings', () => {
  const text = buildCalendar([
    { uid: 'b', date: '2026-10-05', title: 'Segundo', description: 'x' },
    { uid: 'a', date: '2026-10-01', title: 'Primero, con coma' },
  ], new Date('2026-09-29T10:20:30.456Z'));
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'only CRLF line endings');
  assert.ok(text.indexOf('UID:a@') < text.indexOf('UID:b@'));
  assert.ok(text.includes('DTSTAMP:20260929T102030Z'));
  assert.ok(text.includes('DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261002'));
  assert.ok(text.includes('SUMMARY:Primero\\, con coma'));
  assert.equal(text.match(/BEGIN:VEVENT/g).length, 2);
});

test('an event across the end of the year ends the next day', () => {
  const text = buildCalendar([{ uid: 'x', date: '2026-12-31', title: 'Nochevieja' }], new Date());
  assert.ok(text.includes('DTEND;VALUE=DATE:20270101'));
});

test('event builders', async (t) => {
  await t.test('episode', () => {
    assert.deepEqual(episodeEvent(1, 'Dark', { airDate: '2026-10-01', seasonNumber: 2, episodeNumber: 3, name: 'Tres' }), {
      uid: 'ep-1-2-3', date: '2026-10-01', title: 'Dark · T2 E3', description: 'Episodio: Tres',
    });
    assert.equal(episodeEvent(1, 'Dark', { airDate: null, seasonNumber: 2, episodeNumber: 3 }), null);
    assert.equal(episodeEvent(1, 'Dark', null), null);
  });
  await t.test('season, sequel and renewal', () => {
    assert.equal(seasonEvent(1, 'Dark', { seasonNumber: 4, airDate: '2027-01-01' }).title, 'Dark: estreno de la temporada 4');
    assert.equal(seasonEvent(1, 'Dark', { seasonNumber: 4, airDate: null }), null);
    assert.equal(sequelEvent({ tmdbId: 9, title: 'Dune 3', releaseDate: '2026-12-18', sequelOf: 'Dune' }).description, 'Continuación de Dune.');
    const renewal = renewalEvent('HBO Max', '2026-10-27', 9.99);
    assert.equal(renewal.title, 'Se renueva HBO Max (9.99 €)');
    assert.equal(renewal.uid, 'renewal-hbo-max-2026-10-27');
    assert.equal(renewalEvent('Netflix', '2026-10-01', null).title, 'Se renueva Netflix');
  });
});

test('upcomingOnly drops past, empty and repeated events', () => {
  const events = [
    { uid: 'a', date: '2026-09-28' },
    { uid: 'b', date: '2026-09-29' },
    null,
    { uid: 'b', date: '2026-09-29' },
    { uid: 'c', date: '2026-10-01' },
  ];
  assert.deepEqual(upcomingOnly(events, '2026-09-29').map((e) => e.uid), ['b', 'c']);
});
