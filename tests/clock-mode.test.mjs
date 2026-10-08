import test from 'node:test';
import assert from 'node:assert/strict';
import { Timer, defaults, wallClockText } from '../src/timer.js';
test('idle clock returns after ending, while an immediately paused or extended timer stays active', () => {
  const timer = new Timer(defaults, () => 0);
  assert.equal(timer.snapshot().sessionActive, false);
  timer.start(); timer.pause(); assert.equal(timer.snapshot().sessionActive, true);
  timer.action('end'); assert.equal(timer.snapshot().sessionActive, false);
  timer.addFive(); assert.equal(timer.snapshot().sessionActive, true);
  timer.reset(); assert.equal(timer.snapshot().sessionActive, false);
});
test('wall clock uses local hours and minutes, with optional seconds including midnight', () => {
  assert.equal(wallClockText(new Date(2026, 9, 7, 13, 4, 9)), '13:04');
  assert.equal(wallClockText(new Date(2026, 9, 7, 13, 4, 9), true), '13:04:09');
  assert.equal(wallClockText(new Date(2026, 9, 7, 0, 0, 0), true), '00:00:00');
});
