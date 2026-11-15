// Synth voices built from raw Web Audio nodes.
// One-shot voices (pluck, bell, drum, grain) respect the engine's voice budget;
// sustained voices (Pad, NoiseBed, Probe) are long-lived and parameter-driven.

import { mtof } from "../music.js";

function panner(ctx, pan, dest) {
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan || 0));
    p.connect(dest);
    return p;
  }
  return dest;
}

/** Soft plucked string: triangle + sine octave through a closing low-pass. */
export function pluck(engine, dest, time, { midi, vel = 0.6, pan = 0, dur = 1.2, bright = 0.5 }) {
  if (!engine.claimVoice(dur)) return;
  const ctx = engine.ctx;
  const f = mtof(midi);
  const out = panner(ctx, pan, dest);
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(f * (3 + bright * 10), time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 1.5), time + dur);
  lp.Q.value = 0.8;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.22 * vel, time + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  const o1 = ctx.createOscillator(); o1.type = "triangle"; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
  const g2 = ctx.createGain(); g2.gain.value = 0.3;
  o1.connect(lp); o2.connect(g2).connect(lp);
  lp.connect(g).connect(out);
  o1.start(time); o2.start(time);
  o1.stop(time + dur + 0.05); o2.stop(time + dur + 0.05);
}

/** FM bell: inharmonic, glassy. Used for rare / highlighted events. */
export function bell(engine, dest, time, { midi, vel = 0.5, pan = 0, dur = 2.5, ratio = 3.5, index = 4 }) {
  if (!engine.claimVoice(dur)) return;
  const ctx = engine.ctx;
  const f = mtof(midi);
  const out = panner(ctx, pan, dest);
  const car = ctx.createOscillator(); car.frequency.value = f;
  const mod = ctx.createOscillator(); mod.frequency.value = f * ratio;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * index, time);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, time + dur * 0.6);
  mod.connect(mg).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.16 * vel, time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  car.connect(g).connect(out);
  car.start(time); mod.start(time);
  car.stop(time + dur + 0.05); mod.stop(time + dur + 0.05);
}

/** Drum: pitched sine thump with a filtered noise transient. */
export function drum(engine, dest, time, { freq = 80, vel = 0.7, pan = 0, decay = 0.35, noise = 0.3, tone = 2000 }) {
  if (!engine.claimVoice(decay + 0.1)) return;
  const ctx = engine.ctx;
  const out = panner(ctx, pan, dest);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq * 2.2, time);
  o.frequency.exponentialRampToValueAtTime(freq, time + 0.04);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.5 * vel, time + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  o.connect(g).connect(out);
  o.start(time); o.stop(time + decay + 0.05);
  if (noise > 0) {
    const n = ctx.createBufferSource();
    n.buffer = engine.noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = tone; bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, time);
    ng.gain.exponentialRampToValueAtTime(0.35 * vel * noise, time + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(0.25, decay * 0.6));
    n.connect(bp).connect(ng).connect(out);
    n.start(time, Math.random() * 1.5); n.stop(time + 0.3);
  }
}

/** Tiny noise grain: crackle of smoke, rain, sparkle. */
export function grain(engine, dest, time, { vel = 0.4, pan = 0, freq = 3000, q = 1.5, dur = 0.03 }) {
  if (!engine.claimVoice(dur + 0.05)) return;
  const ctx = engine.ctx;
  const out = panner(ctx, pan, dest);
  const n = ctx.createBufferSource();
  n.buffer = engine.noise;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.3 * vel, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  n.connect(bp).connect(g).connect(out);
  n.start(time, Math.random() * 1.8); n.stop(time + dur + 0.02);
}

/** Sustained detuned pad. Chord, brightness, detune and level glide smoothly. */
export class Pad {
  constructor(engine, dest, { voices = 3, type = "sawtooth", level = 0.12, cutoff = 900 } = {}) {
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass"; this.lp.frequency.value = cutoff; this.lp.Q.value = 0.7;
    this.lp.connect(this.out).connect(dest);
    this.level = level;
    this.oscs = [];
    for (let i = 0; i < voices; i++) {
      const pair = [];
      for (const det of [-1, 1]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = 220;
        o.detune.value = det * 6;
        const g = ctx.createGain(); g.gain.value = 0.5 / voices;
        o.connect(g).connect(this.lp);
        o.start();
        pair.push(o);
      }
      this.oscs.push(pair);
    }
    // slow breathing LFO on the filter
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 0.07;
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = cutoff * 0.25;
    this.lfo.connect(this.lfoGain).connect(this.lp.frequency);
    this.lfo.start();
    this.out.gain.setTargetAtTime(level, ctx.currentTime, 1.2);
  }

  setChord(midis, time, glide = 0.6) {
    this.oscs.forEach((pair, i) => {
      const f = mtof(midis[i % midis.length] + 12 * Math.floor(i / midis.length));
      for (const o of pair) o.frequency.setTargetAtTime(f, time, glide);
    });
  }

  setDetune(cents, time) {
    this.oscs.forEach((pair) => {
      pair[0].detune.setTargetAtTime(-cents, time, 0.8);
      pair[1].detune.setTargetAtTime(cents, time, 0.8);
    });
  }

  setCutoff(hz, time, glide = 0.4) { this.lp.frequency.setTargetAtTime(hz, time, glide); }
  setLevel(level, time, glide = 0.5) { this.out.gain.setTargetAtTime(level, time, glide); }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.3);
    setTimeout(() => {
      this.oscs.flat().forEach((o) => o.stop());
      this.lfo.stop();
      this.out.disconnect();
    }, 2000);
  }
}

/** Looping filtered noise: wind, surf, haze, rumble. */
export class NoiseBed {
  constructor(engine, dest, { type = "bandpass", freq = 800, q = 0.7, level = 0, lfoRate = 0.1 } = {}) {
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.src = ctx.createBufferSource();
    this.src.buffer = engine.noise;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type; this.filter.frequency.value = freq; this.filter.Q.value = q;
    this.out = ctx.createGain(); this.out.gain.value = level;
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.src.connect(this.filter).connect(this.out);
    if (this.pan) this.out.connect(this.pan).connect(dest); else this.out.connect(dest);
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = lfoRate;
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = freq * 0.4;
    this.lfo.connect(this.lfoGain).connect(this.filter.frequency);
    this.src.start(); this.lfo.start();
  }

  setLevel(v, time, glide = 0.4) { this.out.gain.setTargetAtTime(v, time, glide); }
  setFreq(hz, time, glide = 0.4) { this.filter.frequency.setTargetAtTime(hz, time, glide); }
  setPan(p, time) { if (this.pan) this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), time, 0.5); }

  stop() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(() => { this.src.stop(); this.lfo.stop(); this.out.disconnect(); }, 2000);
  }
}

/** Continuous probe tone for Explore mode: pitch = value, pan = position. */
export class Probe {
  constructor(engine, dest) {
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.o1 = ctx.createOscillator(); this.o1.type = "sine";
    this.o2 = ctx.createOscillator(); this.o2.type = "triangle";
    this.g2 = ctx.createGain(); this.g2.gain.value = 0.25;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.o1.connect(this.out);
    this.o2.connect(this.g2).connect(this.out);
    if (this.pan) this.out.connect(this.pan).connect(dest); else this.out.connect(dest);
    this.o1.start(); this.o2.start();
  }

  set({ midi, level = 0.18, pan = 0, timbre = 0.25 }) {
    const t = this.ctx.currentTime;
    const f = mtof(midi);
    this.o1.frequency.setTargetAtTime(f, t, 0.03);
    this.o2.frequency.setTargetAtTime(f * 2, t, 0.03);
    this.g2.gain.setTargetAtTime(timbre, t, 0.05);
    this.out.gain.setTargetAtTime(level, t, 0.04);
    if (this.pan) this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.03);
  }

  silence() { this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }

  stop() {
    this.silence();
    setTimeout(() => { this.o1.stop(); this.o2.stop(); this.out.disconnect(); }, 400);
  }
}
