import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { FlipCard, flipDuration } from '../src/flip-card.js';

function setup() {
  const dom = new JSDOM('<main></main>'), animations = [];
  dom.window.HTMLElement.prototype.animate = function (keyframes, timing) {
    let resolve, reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const animation = { element: this, keyframes, timing, startTime: null, finished,
      finish: resolve, cancel() { reject(new Error('cancelled')); } };
    animations.push(animation); return animation;
  };
  const card = new FlipCard(dom.window.document);
  dom.window.document.querySelector('main').append(card.element);
  return { dom, card, animations };
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('old lower digit remains until the incoming lower flap finishes', async () => {
  const { card, animations } = setup(); card.set('9'); card.set('8', { startTime: 1000 });
  assert.equal(card.upperText.textContent, '8'); assert.equal(card.lowerText.textContent, '9');
  assert.equal(card.element.querySelector('.flap-upper span').textContent, '9');
  assert.equal(card.element.querySelector('.flap-lower span').textContent, '8');
  animations[0].finish(); await settled(); assert.equal(card.lowerText.textContent, '9');
  animations[1].finish(); await settled(); assert.equal(card.lowerText.textContent, '8');
  assert.equal(card.element.querySelector('.flap-lower'), null);
});

test('upper and lower leaves meet at the same midpoint with no delay or gap', () => {
  const { card, animations } = setup(); card.set('0'); card.set('9', { startTime: 1200 });
  assert.equal(animations[0].startTime, animations[1].startTime);
  assert.equal(animations[0].timing.duration, flipDuration);
  assert.equal(animations[1].timing.duration, flipDuration);
  assert.equal(animations[0].keyframes[1].offset, .5);
  assert.equal(animations[1].keyframes[1].offset, .5);
  assert.equal(animations[1].keyframes[0].transform, animations[1].keyframes[1].transform);
  assert.equal(animations[0].timing.delay, undefined);
  assert.equal(animations[1].timing.delay, undefined);
});

test('all changed digits share a timestamp at a minute boundary', () => {
  const { dom, animations } = setup();
  const cards = Array.from({ length: 4 }, () => new FlipCard(dom.window.document));
  '0500'.split('').forEach((digit, index) => cards[index].set(digit));
  '0459'.split('').forEach((digit, index) => cards[index].set(digit, { startTime: 4200 }));
  assert.equal(animations.length, 6);
  assert.ok(animations.every((animation) => animation.startTime === 4200));
});

test('rapid ticks retain the active leaves and queue only the latest digit', async () => {
  const { card, animations } = setup(); card.set('9'); card.set('8');
  const originalLeaf = card.element.querySelector('.flap-upper');
  card.set('7'); card.set('6');
  assert.equal(card.element.querySelector('.flap-upper'), originalLeaf);
  assert.equal(card.lowerText.textContent, '9'); assert.equal(animations.length, 2);
  animations[0].finish(); animations[1].finish(); await settled();
  assert.equal(card.lowerText.textContent, '8');
  assert.equal(card.element.querySelector('.flap-upper span').textContent, '8');
  assert.equal(card.element.querySelector('.flap-lower span').textContent, '6');
  animations[2].finish(); animations[3].finish(); await settled();
  assert.equal(card.lowerText.textContent, '6'); assert.equal(card.value, '6');
});

test('identical timer refreshes do not restart the active flip', () => {
  const { card, animations } = setup(); card.set('9'); card.set('8'); card.set('8'); card.set('8');
  assert.equal(animations.length, 2); assert.equal(card.lowerText.textContent, '9');
});

test('turning motion off settles atomically and ignores stale completions', async () => {
  const { card } = setup(); card.set('9'); card.set('8'); card.set('7', { animate: false });
  await settled();
  assert.equal(card.upperText.textContent, '7'); assert.equal(card.lowerText.textContent, '7');
  assert.equal(card.element.querySelector('.flap-upper'), null); assert.equal(card.pending, null);
});
