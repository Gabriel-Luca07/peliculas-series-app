const test = require('node:test');
const assert = require('node:assert/strict');
const { nextCardIndex } = require('../lib/grid-nav');

// 3 columns, 7 cards: rows [0 1 2] [3 4 5] [6]
const GRID = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ left: (i % 3) * 200, top: Math.floor(i / 3) * 300 + (i === 4 ? 3 : 0) }));

test('left/right follow the order and stop at the ends', () => {
  assert.equal(nextCardIndex(GRID, 1, 'ArrowRight'), 2);
  assert.equal(nextCardIndex(GRID, 2, 'ArrowRight'), 3);
  assert.equal(nextCardIndex(GRID, 6, 'ArrowRight'), 6);
  assert.equal(nextCardIndex(GRID, 0, 'ArrowLeft'), 0);
});

test('up/down keep the column', () => {
  assert.equal(nextCardIndex(GRID, 1, 'ArrowDown'), 4);
  assert.equal(nextCardIndex(GRID, 4, 'ArrowUp'), 1);
  assert.equal(nextCardIndex(GRID, 3, 'ArrowDown'), 6);
});

test('down into a shorter last row goes to the closest card', () => {
  assert.equal(nextCardIndex(GRID, 5, 'ArrowDown'), 6);
});

test('no row beyond: stays', () => {
  assert.equal(nextCardIndex(GRID, 6, 'ArrowDown'), 6);
  assert.equal(nextCardIndex(GRID, 0, 'ArrowUp'), 0);
});

test('Home/End and empty grid', () => {
  assert.equal(nextCardIndex(GRID, 4, 'Home'), 0);
  assert.equal(nextCardIndex(GRID, 4, 'End'), 6);
  assert.equal(nextCardIndex([], 0, 'ArrowDown'), -1);
  assert.equal(nextCardIndex(GRID, 4, 'x'), 4);
});
