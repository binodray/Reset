import test from 'node:test';
import assert from 'node:assert/strict';
import { Timer, clockText, sanitizeSettings, defaults, breakMessages, selectedBreakMessage } from '../src/timer.js';
test('widget sizes restore from saved settings and invalid sizes use Medium', () => {
  assert.equal(sanitizeSettings({}).widgetSize, 'medium');
  for (const widgetSize of ['small', 'medium', 'large']) {
    assert.equal(sanitizeSettings(JSON.parse(JSON.stringify({ widgetSize }))).widgetSize, widgetSize);
  }
  assert.equal(sanitizeSettings({ widgetSize: 'huge' }).widgetSize, 'medium');
  assert.equal(sanitizeSettings({ widgetSize: '__proto__' }).widgetSize, 'medium');
});
function setup(overrides = {}) { let now = 0; const timer = new Timer({ ...defaults, ...overrides }, () => now); return { timer, advance(ms) { now += ms; return timer.tick(); } }; }
test('countdown rounds up and never runs faster than elapsed time', () => {
  const { timer, advance } = setup(); timer.start();
  assert.equal(advance(999).remaining, 1800); assert.equal(advance(1).remaining, 1799);
  assert.equal(advance(94_000).remaining, 1705);
});
test('pause freezes the timer and resume establishes a fresh deadline', () => {
  const { timer, advance } = setup(); timer.start(); advance(10_500); timer.pause();
  assert.equal(advance(300_000).remaining, 1790); timer.start(); assert.equal(advance(1000).remaining, 1789);
});
test('computer sleep leads to a complete, unstarted break reminder', () => {
  const { timer, advance } = setup(); timer.start();
  assert.equal(advance(4_000_000).phase, 'reminder'); assert.equal(timer.remaining, 300); assert.equal(timer.running, false);
  assert.equal(timer.completed, 1); assert.equal(timer.focusSeconds, 1800);
});
test('a repeated tick cannot repeatedly complete the same focus session', () => {
  const { timer, advance } = setup(); timer.start(); advance(1_800_000); advance(1_800_000); assert.equal(timer.completed, 1);
});
test('postponement returns to the reminder and preserves focus time', () => {
  const { timer, advance } = setup(); timer.start(); advance(1_800_000); timer.postpone();
  assert.equal(timer.phase, 'finishing'); assert.equal(timer.remaining, 300); assert.equal(timer.running, true);
  advance(300_000); assert.equal(timer.phase, 'reminder'); assert.equal(timer.focusSeconds, 2100); assert.equal(timer.completed, 1);
});
test('disabled postponement cannot extend the session', () => {
  const { timer } = setup({ postpone: false }); timer.remind(); timer.postpone(); assert.equal(timer.phase, 'reminder');
});
test('manual and automatic breaks start with the configured duration', () => {
  const { timer } = setup({ autoBreak: true, breakMinutes: 7 }); timer.remind();
  assert.equal(timer.phase, 'break'); assert.equal(timer.remaining, 420); assert.equal(timer.running, true);
});
test('break completion waits for the next focus and respects automatic start', () => {
  const { timer, advance } = setup({ autoWork: true }); timer.remind(); timer.start(); advance(300_000);
  assert.equal(timer.phase, 'complete'); assert.equal(timer.running, false);
  timer.nextFocus(); assert.equal(timer.phase, 'focus'); assert.equal(timer.running, true);
});
test('add five minutes works while paused and running without resetting progress', () => {
  const { timer, advance } = setup(); timer.start(); advance(60_000); timer.addFive();
  assert.equal(timer.remaining, 2040); assert.equal(advance(1000).remaining, 2039);
  timer.pause(); timer.addFive(); assert.equal(timer.remaining, 2339); assert.equal(timer.running, false);
});
test('restart and end cancel active deadlines', () => {
  const { timer, advance } = setup(); timer.start(); advance(20_000); timer.action('end');
  assert.equal(timer.remaining, 1800); assert.equal(advance(300_000).remaining, 1800); assert.equal(timer.running, false);
});
test('skip break returns to the chosen focus duration', () => {
  const { timer } = setup({ workMinutes: 45 }); timer.remind(); timer.action('skip');
  assert.equal(timer.phase, 'focus'); assert.equal(timer.remaining, 2700);
});
test('saved durations update idle, running, and paused focus without a reset', () => {
  const { timer, advance } = setup();
  timer.updateSettings({ ...timer.settings, workMinutes: 20 });
  assert.equal(timer.remaining, 1200); assert.equal(timer.sessionActive, false);
  timer.start(); advance(60_000);
  timer.updateSettings({ ...timer.settings, workMinutes: 10 });
  assert.equal(timer.remaining, 600); assert.equal(timer.total, 600); assert.equal(timer.running, true);
  assert.equal(timer.completed, 0); assert.equal(timer.focusSeconds, 60);
  assert.equal(advance(1000).remaining, 599);
  timer.updateSettings({ ...timer.settings, accent: 'blue', breakMinutes: 8 });
  assert.equal(timer.remaining, 599); assert.equal(timer.total, 600);
  timer.pause(); timer.updateSettings({ ...timer.settings, workMinutes: 25 });
  assert.equal(timer.remaining, 1500); assert.equal(timer.running, false); assert.equal(timer.sessionActive, true);
  assert.equal(advance(5000).remaining, 1500);
  timer.start(); assert.equal(advance(1000).remaining, 1499);
});
test('saved break durations update the reminder and break without altering postponement', () => {
  const { timer, advance } = setup(); timer.remind();
  timer.updateSettings({ ...timer.settings, breakMinutes: 7 });
  assert.equal(timer.phase, 'reminder'); assert.equal(timer.remaining, 420); assert.equal(timer.running, false);
  timer.postpone(); advance(1000);
  timer.updateSettings({ ...timer.settings, workMinutes: 20, breakMinutes: 10 });
  assert.equal(timer.phase, 'finishing'); assert.equal(timer.remaining, 299);
  advance(299_000); timer.start(); advance(10_000);
  timer.updateSettings({ ...timer.settings, breakMinutes: 6 });
  assert.equal(timer.remaining, 360); assert.equal(timer.total, 360); assert.equal(timer.running, true);
  assert.equal(advance(1000).remaining, 359);
  timer.pause(); timer.updateSettings({ ...timer.settings, breakMinutes: 8 });
  assert.equal(timer.remaining, 480); assert.equal(timer.running, false);
});
test('invalid or malformed preferences fall back to usable defaults', () => {
  const p = sanitizeSettings({ workMinutes: -5, breakMinutes: 1000, volume: 120, sound: 'false', theme: 'neon', autoBreak: true });
  assert.equal(p.workMinutes, 30); assert.equal(p.breakMinutes, 5); assert.equal(p.volume, 100);
  assert.equal(p.sound, true); assert.equal(p.theme, 'system'); assert.equal(p.autoBreak, true);
  assert.deepEqual(sanitizeSettings(null), defaults);
});
test('four-digit clock formatting handles boundaries', () => {
  assert.equal(clockText(0), '00:00'); assert.equal(clockText(59), '00:59'); assert.equal(clockText(60), '01:00');
  assert.equal(clockText(-1), '00:00'); assert.equal(clockText(60000), '99:59');
});
test('ten break messages rotate, while a chosen reminder remains selected', () => {
  assert.equal(breakMessages.length, 10);
  assert.equal(selectedBreakMessage(defaults, 25), breakMessages[1]);
  assert.equal(selectedBreakMessage(defaults, 250), breakMessages[0]);
  assert.equal(selectedBreakMessage({ ...defaults, messageChoice: '8' }, 100), breakMessages[8]);
});
test('custom messages and accent colors persist, with legacy settings defaulted', () => {
  const p = sanitizeSettings({ messageChoice: 'custom', customMessage: '  Just breathe.  ', accent: 'lavender' });
  assert.equal(selectedBreakMessage(p, 75), 'Just breathe.');
  assert.equal(p.accent, 'lavender');
  const restored = sanitizeSettings(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored, p);
  assert.equal(sanitizeSettings({ workMinutes: 25 }).messageChoice, 'rotate');
  assert.equal(sanitizeSettings({ workMinutes: 25 }).accent, 'sage');
});
test('empty custom messages and invalid choices fall back to built-in reminders', () => {
  const p = sanitizeSettings({ messageChoice: 'custom', customMessage: '   ', accent: 'invalid' });
  assert.equal(p.messageChoice, 'rotate'); assert.equal(p.accent, 'sage');
  assert.equal(sanitizeSettings({ messageChoice: '100' }).messageChoice, 'rotate');
  assert.equal([...sanitizeSettings({ customMessage: '🌿'.repeat(200) }).customMessage].length, 180);
});
