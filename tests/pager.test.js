const test = require('node:test');
const assert = require('node:assert/strict');
const { pageCount, clampPage, pageSlice, pageFromAction, clip, linkText } = require('../src/music/pager');

test('pageCount always returns at least one page', () => {
  assert.equal(pageCount(0, 10), 1);
  assert.equal(pageCount(10, 10), 1);
  assert.equal(pageCount(11, 10), 2);
  assert.equal(pageCount(250, 10), 25);
});

test('clampPage keeps the page inside the available range', () => {
  assert.equal(clampPage(-3, 25, 10), 0);
  assert.equal(clampPage(99, 25, 10), 2);
  assert.equal(clampPage(NaN, 25, 10), 0);
  assert.equal(clampPage(1.9, 25, 10), 1);
});

test('pageSlice returns the right items and global start offset', () => {
  const items = Array.from({ length: 23 }, (_, n) => n + 1);
  const last = pageSlice(items, 2, 10);
  assert.deepEqual(last.items, [21, 22, 23]);
  assert.equal(last.start, 20);
  assert.equal(last.pages, 3);
  assert.deepEqual(pageSlice(items, 99, 10).items, [21, 22, 23]);
  assert.deepEqual(pageSlice([], 0, 10), { page: 0, pages: 1, start: 0, items: [] });
});

test('pageFromAction handles first/prev/next/last and clamps at the edges', () => {
  assert.equal(pageFromAction('next', 0, 3), 1);
  assert.equal(pageFromAction('next', 2, 3), 2);
  assert.equal(pageFromAction('prev', 0, 3), 0);
  assert.equal(pageFromAction('prev', 2, 3), 1);
  assert.equal(pageFromAction('first', 2, 3), 0);
  assert.equal(pageFromAction('last', 0, 3), 2);
  assert.equal(pageFromAction('bogus', 1, 3), 1);
});

test('clip and linkText shorten text and neutralise markdown link brackets', () => {
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('abc', 4), 'abc');
  assert.equal(linkText('Song [Official] (HD)', 50), 'Song (Official) (HD)');
});
