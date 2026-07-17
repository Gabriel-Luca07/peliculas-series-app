const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidProfileColor, sanitizeProfileInitial } = require('../lib/profile-utils');

test('isValidProfileColor', async (t) => {
  await t.test('accepts the built-in series-N palette (1 through 8)', () => {
    for (let i = 1; i <= 8; i += 1) assert.equal(isValidProfileColor(`series-${i}`), true);
  });

  await t.test('rejects series-0 and series-9 (out of the defined 1-8 range)', () => {
    assert.equal(isValidProfileColor('series-0'), false);
    assert.equal(isValidProfileColor('series-9'), false);
  });

  await t.test('accepts a 6-digit hex color', () => {
    assert.equal(isValidProfileColor('#14b8a6'), true);
    assert.equal(isValidProfileColor('#FFFFFF'), true);
  });

  await t.test('rejects a malformed hex color', () => {
    assert.equal(isValidProfileColor('#fff'), false);
    assert.equal(isValidProfileColor('#gggggg'), false);
  });

  await t.test('rejects an HTML/script injection attempt written into profiles.json by hand', () => {
    assert.equal(isValidProfileColor('"><img src=x onerror=alert(1)>'), false);
    assert.equal(isValidProfileColor('javascript:alert(1)'), false);
  });

  await t.test('rejects non-string values', () => {
    assert.equal(isValidProfileColor(null), false);
    assert.equal(isValidProfileColor(undefined), false);
    assert.equal(isValidProfileColor(42), false);
  });
});

test('sanitizeProfileInitial', async (t) => {
  await t.test('trims whitespace', () => {
    assert.equal(sanitizeProfileInitial('  RG  '), 'RG');
  });

  await t.test('truncates to 2 characters', () => {
    assert.equal(sanitizeProfileInitial('RAUL'), 'RA');
  });

  await t.test('returns null for empty, whitespace-only, or missing input', () => {
    assert.equal(sanitizeProfileInitial(''), null);
    assert.equal(sanitizeProfileInitial('   '), null);
    assert.equal(sanitizeProfileInitial(undefined), null);
    assert.equal(sanitizeProfileInitial(null), null);
  });
});
