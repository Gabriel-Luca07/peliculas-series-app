const test = require('node:test');
const assert = require('node:assert/strict');
const {
  streamingPlatformsFor, matchPendingToSubscriptions, pickAvailabilityNotifications,
} = require('../lib/availability-logic');

test('streamingPlatformsFor maps known providers and keeps unknown ones', () => {
  const normalize = (n) => ({ 'Amazon Prime Video': 'Prime Video', Netflix: 'Netflix' }[n] || null);
  assert.deepEqual(
    streamingPlatformsFor(['Netflix', 'Amazon Prime Video', 'Pluto TV ', 'Netflix', ' '], normalize),
    ['Netflix', 'Prime Video', 'Pluto TV'],
  );
  assert.deepEqual(streamingPlatformsFor(undefined, normalize), []);
});

test('matchPendingToSubscriptions', async (t) => {
  const active = ['Netflix', 'Disney+'];

  await t.test('switches the platform to the first active one it streams on', () => {
    const res = matchPendingToSubscriptions([{ id: 'a', platform: 'Cine', availableOn: ['Disney+', 'Netflix'] }], active);
    assert.deepEqual(res, [{ movieId: 'a', platforms: ['Netflix', 'Disney+'], newPlatform: 'Netflix' }]);
  });

  await t.test('no switch when it is already set to one of them', () => {
    const res = matchPendingToSubscriptions([{ id: 'a', platform: 'Disney+', availableOn: ['Disney+', 'Netflix'] }], active);
    assert.equal(res[0].newPlatform, null);
  });

  await t.test('titles not on any active subscription are left out', () => {
    assert.deepEqual(matchPendingToSubscriptions([{ id: 'a', platform: '', availableOn: ['HBO Max'] }], active), []);
    assert.deepEqual(matchPendingToSubscriptions([{ id: 'b', platform: '' }], active), []);
  });

  await t.test('respects a switch the user undid', () => {
    const items = [{ id: 'a', platform: 'Cine', availableOn: ['Netflix', 'Disney+'] }];
    assert.equal(matchPendingToSubscriptions(items, active, new Set(['a:Netflix']))[0].newPlatform, 'Disney+');
    assert.equal(matchPendingToSubscriptions(items, active, new Set(['a:Netflix', 'a:Disney+']))[0].newPlatform, null);
  });
});

test('pickAvailabilityNotifications', async (t) => {
  const matches = [
    { movieId: 'a', platforms: ['Netflix'] },
    { movieId: 'b', platforms: ['Disney+'] },
  ];

  await t.test('notifies what was not notified before', () => {
    const res = pickAvailabilityNotifications(matches, ['a:Netflix']);
    assert.deepEqual(res.toNotify.map((m) => m.movieId), ['b']);
    assert.deepEqual(res.notifiedKeys, ['a:Netflix', 'b:Disney+']);
  });

  await t.test('forgets titles that stopped being available', () => {
    const res = pickAvailabilityNotifications([matches[1]], ['a:Netflix', 'b:Disney+']);
    assert.deepEqual(res.toNotify, []);
    assert.deepEqual(res.notifiedKeys, ['b:Disney+']);
  });
});
