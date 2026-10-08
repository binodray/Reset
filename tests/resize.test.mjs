import test from 'node:test';
import assert from 'node:assert/strict';
import { cornerScale, sanitizeSettings, widgetScaleFor, widgetGeometry } from '../src/timer.js';

test('corner dragging preserves proportions and limits while each direction grows outward', () => {
  for (const [corner, x, y] of [['se', 1, 1], ['sw', -1, 1], ['ne', 1, -1], ['nw', -1, -1]]) {
    assert.ok(Math.abs(cornerScale(1, corner, x * 86.4, y * 83.2) - 1.2) < 1e-10);
    assert.equal(cornerScale(1, corner, x * 10000, y * 10000), 1.6);
    assert.equal(cornerScale(1, corner, -x * 10000, -y * 10000), .5);
    assert.equal(cornerScale(1, corner, 0, 0), 1);
  }
});
test('small cards collapse details into compact and clock-only layouts', () => {
  assert.deepEqual(widgetGeometry(.6), { width: 259.2, height: 154, tier: 'mini' });
  assert.deepEqual(widgetGeometry(.85), { width: 367.2, height: 286, tier: 'compact' });
  assert.deepEqual(widgetGeometry(1), { width: 432, height: 416, tier: 'full' });
  assert.equal(sanitizeSettings({ windowMode: 'top' }).windowMode, 'top');
  assert.equal(sanitizeSettings({ windowMode: 'invalid' }).windowMode, 'desktop');
});
test('custom sizes restore across restart and invalid stored scales safely fall back', () => {
  for (const scale of [.7, .93, 1.33, 1.6]) {
    const restored = sanitizeSettings(JSON.parse(JSON.stringify({ widgetSize: 'custom', widgetScale: scale })));
    assert.equal(restored.widgetSize, 'custom'); assert.equal(widgetScaleFor(restored), scale);
  }
  for (const scale of [null, '1.2', NaN, Infinity, -.3, 2]) {
    assert.equal(widgetScaleFor(sanitizeSettings({ widgetSize: 'custom', widgetScale: scale })), 1);
  }
  assert.equal(widgetScaleFor(sanitizeSettings({ widgetSize: 'small', widgetScale: 1.5 })), .85);
});
