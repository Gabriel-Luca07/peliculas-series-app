const test = require('node:test');
const assert = require('node:assert/strict');
const { localDateStringAt, todayLocalDateString, addDaysToDateString, daysElapsedSince } = require('../lib/date-utils');

test('todayLocalDateString returns a YYYY-MM-DD string', () => {
  assert.match(todayLocalDateString(), /^\d{4}-\d{2}-\d{2}$/);
});

test('localDateStringAt matches the local (not UTC) calendar date for a given instant', () => {
  // Built independently from Date's own local getters, so this test is correct
  // regardless of which timezone it happens to run in — it's checking that
  // localDateStringAt tracks LOCAL time, not asserting one specific timezone.
  const ms = Date.now();
  const d = new Date(ms);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(localDateStringAt(ms), expected);
});

test('addDaysToDateString adds days, rolling over months and years correctly', () => {
  assert.equal(addDaysToDateString('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysToDateString('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDateString('2026-06-15', 30), '2026-07-15');
  assert.equal(addDaysToDateString('2027-02-01', -1), '2027-01-31'); // 2027 is not a leap year
});

test('addDaysToDateString handles leap years', () => {
  assert.equal(addDaysToDateString('2028-02-28', 1), '2028-02-29'); // 2028 is a leap year
  assert.equal(addDaysToDateString('2028-02-29', 1), '2028-03-01');
});

test('daysElapsedSince is ~0 for today and grows for past dates', () => {
  const today = todayLocalDateString();
  assert.ok(daysElapsedSince(today) >= -1 && daysElapsedSince(today) <= 1);

  const tenDaysAgo = addDaysToDateString(today, -10);
  const elapsed = daysElapsedSince(tenDaysAgo);
  // Allow a small tolerance: daysElapsedSince parses the date string as UTC
  // midnight while today/addDaysToDateString are local-calendar-based, so the
  // two can differ by up to a day depending on the machine's own timezone.
  assert.ok(elapsed >= 9 && elapsed <= 11, `expected ~10, got ${elapsed}`);
});
