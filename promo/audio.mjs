// Synthesises the Reset promo soundtrack: a calm, original 96 BPM lo-fi piece
// plus UI sound effects placed from out/cues.json (written by render.mjs), so
// every flip, click and chime lands on the frame it belongs to.
// Instruments, reverb and mixdown are adapted from the Hastamev promo pipeline.
//   node audio.mjs  ->  out/audio.wav
import { readFileSync, writeFileSync } from "node:fs";

const SR = 48000, DUR = 40, N = SR * DUR;
const BEAT = 0.625, BAR = 2.5; // 96 BPM, 4/4
const music = [new Float32Array(N), new Float32Array(N)];
const sfx = [new Float32Array(N), new Float32Array(N)];
const send = [new Float32Array(N), new Float32Array(N)]; // reverb send

/* ---------- utilities ---------- */
let seed = 1234567;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;

/** Adds a mono generator into a bus with pan (-1..1) and optional reverb send. */
function add(bus, t0, len, gen, { gain = 1, pan = 0, rev = 0 } = {}) {
  const start = Math.round(t0 * SR), n = Math.round(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) {
    const k = start + i;
    if (k < 0 || k >= N) continue;
    const v = gen(i / SR, i);
    bus[0][k] += v * gl; bus[1][k] += v * gr;
    if (rev) { send[0][k] += v * gl * rev; send[1][k] += v * gr * rev; }
  }
}

class Biquad {
  constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, f, q) {
    const w = TAU * Math.min(f, SR * 0.45) / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w);
    let b0, b1, b2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
    if (type === "bp") { b0 = a; b1 = 0; b2 = -a; }
    else if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}

/* ============================================================
   Instruments
============================================================ */
function marimba(t, m, vel = 1, pan = 0) {
  const f = mtof(m);
  add(music, t, 0.9, (x) => {
    const a = Math.min(1, x / 0.002);
    return a * vel * (Math.sin(TAU * f * x) * Math.exp(-x * 7) + 0.3 * Math.sin(TAU * f * 3.99 * x) * Math.exp(-x * 28) + 0.12 * Math.sin(TAU * f * 9.2 * x) * Math.exp(-x * 60));
  }, { gain: 0.16, pan, rev: 0.25 });
}

/** Karplus-Strong pluck: a bright little ukulele. */
function pluck(t, m, vel = 1, pan = 0, len = 1.1) {
  const f = mtof(m), P = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(P);
  let prev = 0;
  for (let i = 0; i < P; i++) { const n = noise(); buf[i] = 0.6 * n + 0.4 * prev; prev = n; }
  let idx = 0;
  add(music, t, len, (x) => {
    const cur = buf[idx], nxt = buf[(idx + 1) % P];
    buf[idx] = 0.4985 * (cur + nxt);
    idx = (idx + 1) % P;
    return cur * vel * (x > len - 0.05 ? (len - x) / 0.05 : 1);
  }, { gain: 0.3, pan, rev: 0.3 });
}

function bass(t, m, len = 0.42, vel = 1) {
  const f = mtof(m);
  let ph = 0;
  add(music, t, len, (x) => {
    ph += f / SR;
    const env = Math.min(1, x / 0.006) * Math.exp(-x * 3.2) * (x > len - 0.03 ? (len - x) / 0.03 : 1);
    return Math.tanh(1.6 * (Math.sin(TAU * ph) + 0.35 * Math.sin(TAU * ph * 2))) * env * vel;
  }, { gain: 0.34 });
}

function kick(t, vel = 1) {
  let ph = 0;
  add(music, t, 0.45, (x) => {
    ph += (48 + 110 * Math.exp(-x * 32)) / SR;
    return (Math.sin(TAU * ph) * Math.exp(-x * 7.5) + (x < 0.004 ? noise() * 0.4 : 0)) * vel;
  }, { gain: 0.62 });
}

function clap(t, vel = 1) {
  const bp = new Biquad().set("bp", 1300, 0.9);
  add(music, t, 0.3, (x) => {
    const bursts = [0, 0.011, 0.022].reduce((s, o) => s + (x >= o && x < o + 0.009 ? Math.exp(-(x - o) * 200) : 0), 0);
    return bp.run(noise()) * (bursts + 0.7 * Math.exp(-Math.max(0, x - 0.022) * 22) * (x > 0.022 ? 1 : 0)) * vel;
  }, { gain: 0.45, pan: 0.1, rev: 0.35 });
}

function hat(t, vel = 1, open = false) {
  const hp = new Biquad().set("hp", 7500, 0.7);
  add(music, t, open ? 0.2 : 0.06, (x) => hp.run(noise()) * Math.exp(-x * (open ? 18 : 70)) * vel, { gain: 0.16, pan: -0.25 });
}

function shaker(t, vel = 1) {
  const hp = new Biquad().set("hp", 5200, 0.8);
  add(music, t, 0.1, (x) => hp.run(noise()) * Math.min(1, x / 0.018) * Math.exp(-x * 40) * vel, { gain: 0.1, pan: 0.35 });
}

function bell(t, m, vel = 1, pan = 0, len = 2.2, bus = music) {
  const f = mtof(m);
  add(bus, t, len, (x) => {
    const idx = 2.2 * Math.exp(-x * 4) + 0.4;
    return Math.sin(TAU * f * x + idx * Math.sin(TAU * f * 3.5 * x)) * Math.exp(-x * 2.6) * Math.min(1, x / 0.002) * vel;
  }, { gain: 0.13, pan, rev: 0.45 });
}

/** Soft pad: detuned saws through a gentle low-pass, slow attack. */
function pad(t, notes, len, vel = 1) {
  for (const [i, m] of notes.entries()) {
    const f = mtof(m), lp1 = new Biquad().set("lp", 1400, 0.6), lp2 = new Biquad().set("lp", 1400, 0.6);
    const ph = [rnd(), rnd(), rnd()];
    const det = [1, 1.004, 0.9962];
    add(music, t, len + 0.6, (x) => {
      let s = 0;
      for (let k = 0; k < 3; k++) { ph[k] = (ph[k] + f * det[k] / SR) % 1; s += ph[k] * 2 - 1; }
      const env = Math.min(1, x / 0.45) * (x > len ? Math.max(0, 1 - (x - len) / 0.6) : 1);
      return lp2.run(lp1.run(s / 3)) * env * vel;
    }, { gain: 0.07, pan: (i - 1) * 0.5, rev: 0.5 });
  }
}

/* ============================================================
   The song: 16 bars of 2.5 s = 40 s, following the video's beats
     bars 0-1   intro: pad and bells while the logo resets
     bars 2-5   focus + flow: soft groove
     bars 6-9   break: drums fall away, slow breathing pad
     bars 10-13 make it yours: groove returns with plucks
     bars 14-15 outro: final chord and bell
============================================================ */
const CH = {
  Cmaj7: { root: 36, tones: [60, 64, 67, 71], arp: [64, 67, 71, 74] },
  Am7: { root: 45, tones: [57, 60, 64, 67], arp: [60, 64, 67, 72] },
  Fmaj7: { root: 41, tones: [57, 60, 64, 65], arp: [60, 65, 69, 72] },
  G6: { root: 43, tones: [55, 59, 62, 64], arp: [59, 62, 64, 67] },
};
const PROG = ["Cmaj7", "Am7", "Fmaj7", "G6"];
const S16 = BAR / 16;
const MELODY = { // [16th step, midi, steps]
  Cmaj7: [[0, 76, 4], [6, 74, 2], [8, 72, 4], [12, 71, 4]],
  Am7: [[0, 72, 4], [6, 76, 2], [8, 79, 6]],
  Fmaj7: [[0, 77, 4], [6, 76, 2], [8, 72, 4], [12, 74, 4]],
  G6: [[0, 71, 6], [8, 74, 4], [12, 76, 4]],
};

for (let bar = 0; bar < 16; bar++) {
  const t0 = bar * BAR, name = PROG[bar % 4], ch = CH[name];
  const intro = bar < 2, groove = (bar >= 2 && bar < 6) || (bar >= 10 && bar < 14), breath = bar >= 6 && bar < 10, outro = bar >= 14;

  pad(t0, ch.tones, BAR - 0.05, breath ? 1.15 : intro || outro ? 0.95 : 0.8);

  if (intro) {
    if (bar === 0) bell(0.35, 84, 0.7, 0.1, 2.4);
    bell(t0 + BAR * 0.5, ch.arp[3] + 12, 0.45, -0.3, 2);
    bass(t0, ch.root + 12, BAR - 0.1, 0.5);
    if (bar === 1) for (let i = 8; i < 16; i++) shaker(t0 + i * S16, i % 2 ? 0.35 : 0.7);
    continue;
  }

  // soft marimba arpeggio, quieter while breathing
  const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let i = 0; i < 8; i++) {
    if (breath && i % 2) continue;
    marimba(t0 + i * BEAT / 2, ch.arp[pattern[i]] - (i % 2 ? 0 : 12), (i % 2 ? 0.45 : 0.65) * (breath ? 0.7 : 1), i % 2 ? 0.35 : -0.35);
  }

  if (groove) {
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * BEAT;
      if (b === 0) kick(tb, 0.75);
      if (b === 2) kick(tb + S16 * 2, 0.55);
      if (b === 1 || b === 3) clap(tb, 0.45);
      hat(tb + BEAT / 2, 0.55, b === 3);
      hat(tb, 0.25);
    }
    for (let i = 0; i < 16; i++) shaker(t0 + i * S16, i % 4 === 2 ? 0.7 : 0.3);
    bass(t0, ch.root, 0.9, 0.85); bass(t0 + BEAT * 2.5, ch.root + 7, 0.5, 0.6); bass(t0 + BEAT * 3.5, ch.root + 12, 0.3, 0.5);
    if (bar >= 10) for (const [st, m, len] of MELODY[name]) pluck(t0 + st * S16, m, 0.65, 0.25, len * S16 + 0.25);
    else if (bar >= 4) for (const [st, m] of MELODY[name]) marimba(t0 + st * S16, m, 0.5, 0.2);
  }
  if (breath) {
    bass(t0, ch.root + 12, BAR - 0.1, 0.45);
    bell(t0 + BEAT * 2, ch.arp[2] + 12, 0.35, (bar % 2 ? 0.4 : -0.4), 2.4);
  }
  if (outro) {
    bass(t0, ch.root, BAR - 0.1, 0.6);
    if (bar === 14) { bell(t0 + 0.05, 79, 0.6, -0.2, 3); bell(t0 + 0.4, 84, 0.55, 0.2, 3.2); }
    if (bar === 15) pad(t0, [48, 55, 60, 64, 67], 2.4, 0.8);
  }
}

/* ============================================================
   Sound effects
============================================================ */
const cues = JSON.parse(readFileSync(new URL("./out/cues.json", import.meta.url)));

function pop(t, v = 1) {
  const f = mtof(79);
  let ph = 0;
  add(sfx, t, 0.22, (x) => {
    ph += f * (1 + 0.6 * Math.exp(-x * 90)) / SR;
    return Math.sin(TAU * ph) * Math.exp(-x * 24) * Math.min(1, x / 0.0015) + (x < 0.003 ? noise() * 0.25 : 0);
  }, { gain: 0.16 * v, pan: (rnd() - 0.5) * 0.4, rev: 0.15 });
}

function whoosh(t, d = 0.5, hi = 1, g = 1) {
  const bp = new Biquad();
  add(sfx, t - 0.05, d + 0.1, (x, i) => {
    const p = x / (d + 0.1);
    if (i % 32 === 0) bp.set("bp", (300 + 2400 * Math.sin(Math.PI * p) ** 1.5) * hi, 0.9);
    return bp.run(noise()) * Math.sin(Math.PI * p) ** 2;
  }, { gain: 0.3 * g, rev: 0.25 });
  const bp2 = new Biquad();
  add(sfx, t + 0.04, d, (x, i) => {
    const p = x / d;
    if (i % 32 === 0) bp2.set("bp", (350 + 2000 * Math.sin(Math.PI * p) ** 1.5) * hi, 1.1);
    return bp2.run(noise()) * Math.sin(Math.PI * p) ** 2;
  }, { gain: 0.18 * g, pan: 0.7 });
}

function click(t) {
  for (const [o, g] of [[0, 1], [0.06, 0.55]]) {
    const hp = new Biquad().set("hp", 2500, 0.7);
    add(sfx, t + o, 0.025, (x) => (hp.run(noise()) * 0.6 + Math.sin(TAU * 3200 * x) * 0.4) * Math.exp(-x * 300) * g, { gain: 0.26, rev: 0.1 });
  }
}

/** Split-flap: a papery snap followed by a soft card landing. */
function flip(t, v = 1) {
  const bp = new Biquad().set("bp", 3400, 1.4), lp = new Biquad().set("lp", 900, 0.7);
  add(sfx, t, 0.03, (x) => bp.run(noise()) * Math.exp(-x * 260), { gain: 0.16 * v, pan: -0.1, rev: 0.05 });
  add(sfx, t + 0.11, 0.06, (x) => (lp.run(noise()) * 0.7 + Math.sin(TAU * 180 * x) * 0.5) * Math.exp(-x * 90), { gain: 0.2 * v, pan: 0.1 });
}

/** The app's break chime: a soft triad of bells. */
function chime(t) {
  [[0, 79], [0.12, 84], [0.24, 88]].forEach(([o, m], i) => bell(t + o, m, 0.75, (i - 1) * 0.4, 3, sfx));
}

for (const c of cues) {
  const v = c.v ?? 1;
  switch (c.type) {
    case "pop": pop(c.t, v); break;
    case "tap": pop(c.t, 0.45 * v); break;
    case "whoosh": whoosh(c.t, 0.55); break;
    case "swish": whoosh(c.t, 0.35, 2.2, 0.45 * v); break;
    case "draw": whoosh(c.t, 0.85, 1.6, 0.4); break;
    case "stretch": whoosh(c.t, 0.4, 0.8, 0.6); break;
    case "click": click(c.t); break;
    case "flip": flip(c.t, v); break;
    case "chime": chime(c.t); break;
  }
}

/* ============================================================
   Mix: reverb on the send bus, glue, limit, write
============================================================ */
function reverb(inp, offs) {
  const out = new Float32Array(N);
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ buf: new Float32Array(d + offs), i: 0, s: 0 }));
  const aps = [556, 441, 341].map((d) => ({ buf: new Float32Array(d + offs), i: 0 }));
  for (let k = 0; k < N; k++) {
    const x = inp[k] * 0.3;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.s = o * 0.72 + c.s * 0.28;           // damping
      c.buf[c.i] = x + c.s * 0.8;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const a of aps) {
      const b = a.buf[a.i], v = -y + b;
      a.buf[a.i] = y + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      y = v;
    }
    out[k] = y;
  }
  return out;
}
const wet = [reverb(send[0], 0), reverb(send[1], 23)];

const mix = [new Float32Array(N), new Float32Array(N)];
for (let ch = 0; ch < 2; ch++) {
  for (let k = 0; k < N; k++) {
    const t = k / SR;
    const fadeIn = Math.min(1, t / 0.03), fadeOut = t > 38.6 ? Math.max(0, (40 - t) / 1.4) ** 1.5 : 1;
    mix[ch][k] = (music[ch][k] * 0.9 + sfx[ch][k] + wet[ch][k] * 0.55) * fadeIn * fadeOut;
  }
}
// gentle glue compression + soft limiting
let peak = 0;
for (let ch = 0; ch < 2; ch++) for (let k = 0; k < N; k++) {
  mix[ch][k] = Math.tanh(mix[ch][k] * 1.25) / 1.25;
  peak = Math.max(peak, Math.abs(mix[ch][k]));
}
const norm = 0.89 / peak;

const data = Buffer.alloc(44 + N * 4);
data.write("RIFF", 0); data.writeUInt32LE(36 + N * 4, 4); data.write("WAVE", 8);
data.write("fmt ", 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write("data", 36); data.writeUInt32LE(N * 4, 40);
for (let k = 0; k < N; k++) for (let ch = 0; ch < 2; ch++) {
  const v = Math.max(-1, Math.min(1, mix[ch][k] * norm + (rnd() - rnd()) / 32768));
  data.writeInt16LE(Math.round(v * 32767), 44 + k * 4 + ch * 2);
}
writeFileSync(new URL("./out/audio.wav", import.meta.url), data);
console.log("audio written, peak", peak.toFixed(3));
