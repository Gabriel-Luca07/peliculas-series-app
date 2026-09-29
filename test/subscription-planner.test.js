const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyPaceHours, planningPace, planPlatform, rankPlans } = require('../lib/subscription-planner');

test('weeklyPaceHours', async (t) => {
  await t.test('hours per week over the span, never less than a week', () => {
    // 6h over two weeks
    const list = [
      { dateWatched: '2026-01-01', runtime: 180 },
      { dateWatched: '2026-01-15', runtime: 180 },
    ];
    assert.equal(weeklyPaceHours(list), 3);
    assert.equal(weeklyPaceHours([{ dateWatched: '2026-01-01', runtime: 120 }]), 2);
  });

  await t.test('a day with a whole backlog logged counts 4h at most', () => {
    const list = Array.from({ length: 10 }, () => ({ dateWatched: '2026-01-01', runtime: 120 }));
    assert.equal(weeklyPaceHours(list), 4);
  });

  await t.test('null without history', () => {
    assert.equal(weeklyPaceHours([]), null);
  });
});

test('planningPace prefers the pace on the platform since activation', () => {
  const watched = [
    { dateWatched: '2026-01-01', runtime: 60, platform: 'HBO Max' },
    { dateWatched: '2026-03-01', runtime: 600, platform: 'HBO Max' },
    { dateWatched: '2026-03-08', runtime: 600, platform: 'HBO Max' },
    { dateWatched: '2026-03-02', runtime: 60, platform: 'Netflix' },
  ];
  const onPlatform = planningPace(watched, 'HBO Max', '2026-03-01');
  assert.equal(onPlatform.source, 'platform');
  assert.equal(onPlatform.hours, 8);
  assert.equal(planningPace(watched, 'HBO Max', null).source, 'general');
  assert.deepEqual(planningPace([], 'HBO Max', null), { hours: 3, source: 'default' });
});

test('planPlatform', async (t) => {
  const pending = [{ runtime: 600 }, { runtime: 300 }, { runtime: null }];

  await t.test('monthly: weeks at the default pace and whole months of cost', () => {
    const plan = planPlatform('Netflix', pending, [], { active: false, price: 10, cycleDays: 30 });
    assert.equal(plan.pendingCount, 3);
    assert.equal(plan.missingCount, 1);
    assert.equal(plan.totalMinutes, 900);
    assert.equal(plan.weeksNeeded, 5); // 15h at 3h/week
    assert.equal(plan.monthsNeeded, 2); // 35 days
    assert.equal(plan.estimatedCost, 20);
  });

  await t.test('annual: prorated cost', () => {
    const plan = planPlatform('Netflix', pending, [], { active: false, price: 365, cycleDays: 365 });
    assert.equal(plan.isMonthly, false);
    assert.equal(plan.estimatedCost, 35);
  });

  await t.test('nothing pending, or nothing measurable', () => {
    assert.equal(planPlatform('Netflix', [], [], {}), null);
    const plan = planPlatform('Netflix', [{ runtime: null }], [], { price: 5 });
    assert.equal(plan.weeksNeeded, null);
  });
});

test('rankPlans: cheapest first, unpriced after by speed, unmeasurable out', () => {
  const ranked = rankPlans([
    { platform: 'A', weeksNeeded: 2, estimatedCost: null },
    { platform: 'B', weeksNeeded: 5, estimatedCost: 20 },
    { platform: 'C', weeksNeeded: 1, estimatedCost: 8 },
    { platform: 'D', weeksNeeded: 1, estimatedCost: null },
    { platform: 'E', weeksNeeded: null },
    null,
  ]);
  assert.deepEqual(ranked.map((p) => p.platform), ['C', 'B', 'D', 'A']);
});
