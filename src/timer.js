export const breakMessages = Object.freeze([
  'Relax your jaw. Let your shoulders drop.',
  'Look at something far away.',
  'Keep your teeth slightly apart.',
  'Stand up and walk around.',
  'Take a few slow breaths.',
  'Stretch your hands and uncurl your fingers.',
  'Step away from the screen for a moment.',
  'Take a sip of water.',
  'Rest your eyes and blink gently.',
  'Notice your posture. Settle into a comfortable position.',
]);

export const accents = Object.freeze(['sage', 'blue', 'lavender', 'peach', 'rose', 'teal']);
export const widgetSizes = Object.freeze({ mini: .6, small: .85, medium: 1, large: 1.2 });
export function widgetScaleFor(settings) { return settings.widgetSize === 'custom' ? settings.widgetScale : widgetSizes[settings.widgetSize]; }
export function widgetGeometry(scale) {
  const width = 432 * scale, tier = width < 300 ? 'mini' : width < 400 ? 'compact' : 'full';
  return { width, height: tier === 'mini' ? 154 : tier === 'compact' ? 286 : 416 * scale, tier };
}
export function cornerScale(scale, corner, dx, dy) {
  const x = corner.includes('w') ? -dx : dx, y = corner.includes('n') ? -dy : dy;
  return Math.max(.5, Math.min(1.6, scale + (432 * x + 416 * y) / (432 ** 2 + 416 ** 2)));
}
export const defaults = Object.freeze({
  workMinutes: 30, breakMinutes: 5, autoWork: false, autoBreak: false,
  sound: true, volume: 35, motion: 'full', postpone: true,
  theme: 'system', accent: 'sage', widgetSize: 'medium', widgetScale: 1, messageChoice: 'rotate', customMessage: '',
  startup: false, rememberPosition: true, tray: true, widget: true, showClockSeconds: false, windowMode: 'desktop',
  widgetMessages: true, idleMessage: '', focusMessage: '',
});

export function sanitizeSettings(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = raw[key];
    if (typeof defaults[key] === 'boolean' && typeof value === 'boolean') out[key] = value;
  }
  for (const [key, max] of [['workMinutes', 99], ['breakMinutes', 60]]) {
    if (Number.isInteger(raw[key]) && raw[key] >= 1 && raw[key] <= max) out[key] = raw[key];
  }
  if (Number.isFinite(raw.volume)) out.volume = Math.max(0, Math.min(100, raw.volume));
  if (['full', 'gentle', 'none'].includes(raw.motion)) out.motion = raw.motion;
  if (['system', 'light', 'dark'].includes(raw.theme)) out.theme = raw.theme;
  if (accents.includes(raw.accent)) out.accent = raw.accent;
  if (Object.hasOwn(widgetSizes, raw.widgetSize)) out.widgetSize = raw.widgetSize;
  if (Number.isFinite(raw.widgetScale) && raw.widgetScale >= .5 && raw.widgetScale <= 1.6) {
    out.widgetScale = raw.widgetScale;
    if (raw.widgetSize === 'custom') out.widgetSize = 'custom';
  }
  if (['desktop', 'top'].includes(raw.windowMode)) out.windowMode = raw.windowMode;
  if (typeof raw.customMessage === 'string') out.customMessage = [...raw.customMessage.trim()].slice(0, 180).join('');
  for (const key of ['idleMessage', 'focusMessage']) if (typeof raw[key] === 'string') out[key] = [...raw[key].trim()].slice(0, 160).join('');
  if (['rotate', 'custom', ...breakMessages.map((_, index) => String(index))].includes(raw.messageChoice)) out.messageChoice = raw.messageChoice;
  if (out.messageChoice === 'custom' && !out.customMessage) out.messageChoice = 'rotate';
  return out;
}

export function selectedBreakMessage(settings, elapsed = 0) {
  if (settings.messageChoice === 'custom' && settings.customMessage) return settings.customMessage;
  if (settings.messageChoice !== 'rotate') {
    const index = Number(settings.messageChoice);
    if (Number.isInteger(index) && breakMessages[index]) return breakMessages[index];
  }
  return breakMessages[Math.floor(Math.max(0, elapsed) / 25) % breakMessages.length];
}

export function clockText(seconds) {
  const value = Math.max(0, Math.min(5999, Math.ceil(seconds)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function widgetMessage(settings, snapshot) {
  const idle = snapshot.phase === 'focus' && !snapshot.sessionActive && !snapshot.running;
  return idle ? settings.idleMessage || 'Take a breath. Stretch a little. Make room for yourself.'
    : settings.focusMessage || 'One thing at a time. Give this moment your attention.';
}

// Browser preview mirrors the Rust-owned desktop timer. A deadline avoids drift
// when background tabs are throttled, or the computer goes to sleep.
export class Timer {
  constructor(settings = defaults, now = () => Date.now()) {
    this.settings = sanitizeSettings(settings);
    this.now = now;
    this.completed = 0;
    this.focusSeconds = 0; this.sessionActive = false;
    this.reset();
  }
  reset() {
    this.phase = 'focus'; this.running = false; this.deadline = null;
    this.remaining = this.settings.workMinutes * 60; this.total = this.remaining;
    this.focusSeconds = 0; this.sessionActive = false;
    return this.snapshot();
  }
  snapshot() {
    return { phase: this.phase, running: this.running, remaining: this.remaining,
      total: this.total, completed: this.completed, focusSeconds: this.focusSeconds, sessionActive: this.sessionActive };
  }
  updateSettings(next) {
    this.tick();
    const previous = this.settings;
    this.settings = sanitizeSettings(next);
    const focusChanged = this.phase === 'focus' && previous.workMinutes !== this.settings.workMinutes;
    const breakChanged = ['break', 'reminder'].includes(this.phase) && previous.breakMinutes !== this.settings.breakMinutes;
    if (focusChanged || breakChanged) {
      if (focusChanged) this.focusSeconds += Math.max(0, this.total - this.remaining);
      this.remaining = this.total = (focusChanged ? this.settings.workMinutes : this.settings.breakMinutes) * 60;
      if (this.running) this.deadline = this.now() + this.remaining * 1000;
    }
    return this.snapshot();
  }
  start() {
    if (this.phase === 'reminder') this.setPhase('break', this.settings.breakMinutes * 60);
    if (this.phase === 'complete') this.reset();
    this.sessionActive = true;
    if (!this.running) { this.running = true; this.deadline = this.now() + this.remaining * 1000; }
    return this.snapshot();
  }
  pause() {
    this.tick(); this.running = false; this.deadline = null; return this.snapshot();
  }
  setPhase(phase, seconds) {
    this.phase = phase; this.remaining = seconds; this.total = seconds;
    this.running = false; this.deadline = null;
  }
  remind() {
    if (this.phase === 'focus' || this.phase === 'finishing') {
      this.focusSeconds += this.total - this.remaining;
      if (this.phase === 'focus' && this.total > this.remaining) this.completed += 1;
    }
    this.setPhase('reminder', this.settings.breakMinutes * 60);
    if (this.settings.autoBreak) this.start();
    return this.snapshot();
  }
  postpone() {
    if (!this.settings.postpone || this.phase !== 'reminder') return this.snapshot();
    this.setPhase('finishing', 300); return this.start();
  }
  addFive() {
    if (!['focus', 'finishing', 'break'].includes(this.phase)) return this.snapshot();
    this.tick();
    if (!['focus', 'finishing', 'break'].includes(this.phase)) return this.snapshot();
    this.sessionActive = true;
    const added = Math.min(300, 5999 - this.remaining);
    this.remaining += added; this.total += added;
    if (this.running) this.deadline += added * 1000;
    return this.snapshot();
  }
  tick() {
    if (!this.running) return this.snapshot();
    this.remaining = Math.max(0, Math.ceil((this.deadline - this.now()) / 1000));
    if (this.remaining === 0) {
      if (this.phase === 'break') this.setPhase('complete', 0);
      else this.remind();
    }
    return this.snapshot();
  }
  nextFocus() { this.reset(); if (this.settings.autoWork) this.start(); return this.snapshot(); }
  action(action) {
    switch (action) {
      case 'start': return this.start();
      case 'pause': return this.pause();
      case 'restart': case 'end': return this.reset();
      case 'break': this.tick(); return this.remind();
      case 'postpone': return this.postpone();
      case 'add': return this.addFive();
      case 'skip': case 'next': return this.nextFocus();
      default: return this.snapshot();
    }
  }
}
export function wallClockText(date = new Date(), seconds = false) {
  return [date.getHours(), date.getMinutes(), ...(seconds ? [date.getSeconds()] : [])].map((value) => String(value).padStart(2, '0')).join(':');
}
