import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { defaults, Timer } from '../src/timer.js';

test('native corner dragging sends ordered latest-size updates and commits or cancels once', async () => {
  const dom = new JSDOM(await readFile(new URL('../src/index.html', import.meta.url), 'utf8'), { url: 'http://tauri.localhost' });
  const { window } = dom;
  for (const key of ['window', 'document', 'localStorage', 'HTMLElement']) globalThis[key] = window[key];
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => ms > 1000 ? 0 : realTimeout(fn, ms);
  const wait = (ms = 50) => new Promise((resolve) => realTimeout(resolve, ms));
  const calls = []; let preferences = { ...defaults }, lastScale;
  window.__TAURI__ = {
    event: { listen: async () => () => {} },
    core: { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'initialize') return { preferences, timer: new Timer(preferences).snapshot() };
      if (command === 'resize_widget') { await wait(10); lastScale = args.scale; }
      if (command === 'finish_widget_resize') {
        if (!args.cancelled) preferences = { ...preferences, widgetSize: 'custom', widgetScale: lastScale };
        return preferences;
      }
    } },
  };
  window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  window.HTMLElement.prototype.setPointerCapture = function () { this.captured = true; };
  window.HTMLElement.prototype.hasPointerCapture = function () { return this.captured; };
  window.HTMLElement.prototype.releasePointerCapture = function () { this.captured = false; this.dispatchEvent(new window.Event('lostpointercapture')); };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 432, height: 416, right: 432, bottom: 416 });
  try {
    await import('../src/app.js'); await wait();
    const handle = document.querySelector('[data-corner="se"]');
    const pointer = (type, x, y) => {
      const event = new window.MouseEvent(type, { button: 0, screenX: x, screenY: y, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 7 }); handle.dispatchEvent(event);
    };
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 43.2, 41.6); pointer('pointermove', 86.4, 83.2); pointer('pointerup', 129.6, 124.8);
    await wait();
    const resizes = calls.filter((call) => call.command === 'resize_widget');
    assert.equal(resizes.length, 2); assert.equal(resizes[0].args.scale, 1);
    assert.ok(Math.abs(resizes[1].args.scale - 1.3) < .003);
    assert.equal(calls.filter((call) => call.command === 'finish_widget_resize').length, 1);
    assert.equal(preferences.widgetSize, 'custom'); assert.ok(Math.abs(preferences.widgetScale - 1.3) < .003);
    assert.equal(document.querySelector('#surface').classList.contains('resizing'), false);
    pointer('pointerdown', 0, 0); pointer('pointermove', 300, 300);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait();
    assert.equal(calls.filter((call) => call.command === 'finish_widget_resize').at(-1).args.cancelled, true);
    assert.ok(Math.abs(preferences.widgetScale - 1.3) < .003);
    assert.equal(handle.captured, false);
    const header = document.querySelector('#drag-handle');
    const move = (type, x, y) => {
      const event = new window.MouseEvent(type, { button: 0, screenX: x, screenY: y, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 8 }); header.dispatchEvent(event);
    };
    move('pointerdown', 10, 10); move('pointermove', 50, 30); move('pointerup', 110, 70); await wait();
    assert.deepEqual(calls.filter((call) => call.command === 'move_widget').at(-1).args, { dx: 100, dy: 60 });
    assert.equal(calls.filter((call) => call.command === 'finish_widget_move').length, 1);
    assert.equal(document.querySelector('#surface').classList.contains('dragging'), false);
    move('pointerdown', 10, 10); move('pointermove', 50, 30);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait();
    assert.equal(calls.filter((call) => call.command === 'finish_widget_move').at(-1).args.cancelled, true);
    document.querySelector('#settings-button').click(); await wait();
    assert.equal(document.body.classList.contains('settings-open'), true);
    assert.equal(document.querySelector('#settings-overlay').hidden, false);
    assert.equal(document.querySelector('#surface').classList.contains('expanded'), false);
    assert.deepEqual(calls.filter((call) => call.command === 'window_mode').at(-1).args, { expanded: true, settingsMode: true });
    document.querySelector('#close-settings').click(); await wait();
    assert.equal(document.body.classList.contains('settings-open'), false);
    assert.equal(document.querySelector('#settings-overlay').hidden, true);
    assert.equal(calls.at(-1).command, 'finish_window_mode');
  } finally { globalThis.setTimeout = realTimeout; dom.window.close(); }
});
