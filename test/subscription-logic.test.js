const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dateRangesOverlap,
  findOverlappingHistoryEntry,
  reconcileSubscriptionEntry,
  subscriptionDaysRemaining,
  getHistoryEntryStatus,
} = require('../lib/subscription-logic');
const { todayLocalDateString, addDaysToDateString } = require('../lib/date-utils');

test('dateRangesOverlap', async (t) => {
  await t.test('overlapping ranges', () => {
    assert.equal(dateRangesOverlap('2025-01-01', '2026-01-01', '2025-06-01', '2025-07-01'), true);
  });
  await t.test('non-overlapping ranges', () => {
    assert.equal(dateRangesOverlap('2025-01-01', '2025-02-01', '2025-06-01', '2025-07-01'), false);
  });
  await t.test('adjacent ranges (one ends exactly where the other starts) do not overlap', () => {
    assert.equal(dateRangesOverlap('2025-01-01', '2025-02-01', '2025-02-01', '2025-03-01'), false);
  });
});

test('findOverlappingHistoryEntry', async (t) => {
  const history = [
    { id: 'a', platform: 'HBO Max', startDate: '2025-01-01', cycleDays: 365 },
    { id: 'b', platform: 'Netflix', startDate: '2025-06-01', cycleDays: 30 },
  ];

  await t.test('blocks a date range that falls inside an existing period for the same platform', () => {
    const conflict = findOverlappingHistoryEntry(history, 'HBO Max', '2025-06-01', 30, null);
    assert.equal(conflict.id, 'a');
  });

  await t.test('allows a date range after the existing period ends', () => {
    const conflict = findOverlappingHistoryEntry(history, 'HBO Max', '2026-02-01', 30, null);
    assert.equal(conflict, undefined);
  });

  await t.test('ignores a different platform even with the same dates', () => {
    const conflict = findOverlappingHistoryEntry(history, 'Disney+', '2025-06-01', 30, null);
    assert.equal(conflict, undefined);
  });

  await t.test('excludeId lets an entry ignore its own linked record when re-checking after an edit', () => {
    const conflict = findOverlappingHistoryEntry(history, 'HBO Max', '2025-06-01', 30, 'a');
    assert.equal(conflict, undefined);
  });
});

test('reconcileSubscriptionEntry', async (t) => {
  await t.test('does nothing when the subscription is not yet due for renewal', () => {
    const entry = { platform: 'Netflix', active: true, startDate: todayLocalDateString(), cycleDays: 30, willRenew: true, historyId: 'x', price: 10 };
    const history = [{ id: 'x', platform: 'Netflix', startDate: entry.startDate, cycleDays: 30, cancelledAt: null }];
    const changed = reconcileSubscriptionEntry(entry, history);
    assert.equal(changed, false);
    assert.equal(history.length, 1);
    assert.equal(entry.startDate, todayLocalDateString());
  });

  await t.test('backfills a missing historyId for an active subscription (data from before "Historial de gasto" existed)', () => {
    const entry = { platform: 'Filmin', active: true, startDate: todayLocalDateString(), cycleDays: 30, willRenew: true, historyId: null, price: 8 };
    const history = [];
    const changed = reconcileSubscriptionEntry(entry, history);
    assert.equal(changed, true);
    assert.equal(history.length, 1);
    assert.equal(entry.historyId, history[0].id);
    assert.equal(history[0].cancelledAt, null);
  });

  await t.test('auto-renews once when exactly one cycle has elapsed and willRenew is true', () => {
    const startDate = addDaysToDateString(todayLocalDateString(), -35);
    const entry = { platform: 'Prime Video', active: true, startDate, cycleDays: 30, willRenew: true, historyId: 'old', price: 5 };
    const history = [{ id: 'old', platform: 'Prime Video', startDate, cycleDays: 30, cancelledAt: null }];
    const changed = reconcileSubscriptionEntry(entry, history);
    assert.equal(changed, true);
    assert.equal(entry.active, true);
    assert.equal(history.length, 2);
    assert.equal(entry.startDate, addDaysToDateString(startDate, 30));
    assert.equal(entry.historyId, history[0].id);
    assert.notEqual(entry.historyId, 'old');
  });

  await t.test('catches up on multiple missed cycles (e.g. app closed for months) with one history entry per cycle', () => {
    const startDate = addDaysToDateString(todayLocalDateString(), -100); // ~3 monthly cycles
    const entry = { platform: 'Apple TV+', active: true, startDate, cycleDays: 30, willRenew: true, historyId: 'old', price: 10 };
    const history = [{ id: 'old', platform: 'Apple TV+', startDate, cycleDays: 30, cancelledAt: null }];
    reconcileSubscriptionEntry(entry, history);
    assert.equal(entry.active, true);
    assert.equal(history.length, 4); // original + 3 catch-up renewals
    // still within a cycle of "today"
    const elapsedFromFinal = Math.floor((Date.now() - new Date(entry.startDate).getTime()) / 86400000);
    assert.ok(elapsedFromFinal < 30);
  });

  await t.test('deactivates (without creating a new charge) once the cycle ends for a cancelled subscription', () => {
    const startDate = addDaysToDateString(todayLocalDateString(), -35);
    const entry = { platform: 'Disney+', active: true, startDate, cycleDays: 30, willRenew: false, historyId: 'old', price: 12 };
    const history = [{ id: 'old', platform: 'Disney+', startDate, cycleDays: 30, cancelledAt: '2026-01-01' }];
    const changed = reconcileSubscriptionEntry(entry, history);
    assert.equal(changed, true);
    assert.equal(entry.active, false);
    assert.equal(entry.startDate, null);
    assert.equal(entry.historyId, null);
    assert.equal(entry.willRenew, true); // reset back to the default for next time it's activated
    assert.equal(history.length, 1); // no new charge was created
  });
});

test('subscriptionDaysRemaining', async (t) => {
  await t.test('returns null for an inactive subscription', () => {
    assert.equal(subscriptionDaysRemaining({ active: false, startDate: null, cycleDays: 30 }), null);
  });

  await t.test('returns the full cycle right after activating', () => {
    const sub = { active: true, startDate: todayLocalDateString(), cycleDays: 30 };
    assert.equal(subscriptionDaysRemaining(sub), 30);
  });

  await t.test('clamps at 0 instead of going negative once overdue', () => {
    const sub = { active: true, startDate: addDaysToDateString(todayLocalDateString(), -45), cycleDays: 30 };
    assert.equal(subscriptionDaysRemaining(sub), 0);
  });
});

test('getHistoryEntryStatus', async (t) => {
  await t.test('finished: no current subscription links to this history entry anymore', () => {
    const entry = { id: 'a', startDate: '2025-01-01', cycleDays: 30 };
    const status = getHistoryEntryStatus(entry, []);
    assert.equal(status.kind, 'finished');
  });

  await t.test('active: ongoing and never cancelled', () => {
    const entry = { id: 'a', startDate: '2025-01-01', cycleDays: 30, cancelledAt: null };
    const subscriptions = [{ historyId: 'a', active: true }];
    assert.equal(getHistoryEntryStatus(entry, subscriptions).kind, 'active');
  });

  await t.test('cancelled-active: ongoing but already cancelled (still has access)', () => {
    const entry = { id: 'a', startDate: '2025-01-01', cycleDays: 30, cancelledAt: '2025-01-15' };
    const subscriptions = [{ historyId: 'a', active: true }];
    assert.equal(getHistoryEntryStatus(entry, subscriptions).kind, 'cancelled-active');
  });
});
