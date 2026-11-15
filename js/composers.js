// Earth Jukebox — Code written with Claude (Anthropic) as an AI coding assistant, under our direction. See AI_DISCLOSURE.md.
// Composers: the artistic rule-sets that turn analysed frames into music.
//
// Shared idea — the SCANNER. Every bar, a playhead sweeps the map from west to
// east in 16 steps. Step k reads column k of the current frame, so position in
// the bar = longitude and stereo pan = longitude. Listeners learn this once
// and can use it on every track. Each composer then adds its own layers.

import { pluck, bell, drum, grain, Pad, NoiseBed } from "./audio/voices.js";
import { SCALES, quantize, chord, clamp01, lerp } from "./music.js";

const COLS = 16;
const colPan = (c) => lerp(-0.85, 0.85, c / (COLS - 1));
const rowLat = (r, rows) => 1 - (r + 0.5) / rows; // 1 = top (north), 0 = bottom

function pannedDest(engine, layerId, pan = 0) {
  const ctx = engine.ctx;
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (p.pan) p.pan.value = pan;
  p.connect(engine.layer(layerId));
  return p;
}

class Composer {
  constructor(engine) {
    this.e = engine;
    this.sustained = [];
  }
  get layers() { return this.constructor.LAYERS; }
  L(id) { return this.e.layer(id); }
  keep(v) { this.sustained.push(v); return v; }
  start() {}
  step() {}
  stop() { this.sustained.forEach((v) => v.stop()); this.sustained = []; }
}

// ---------------------------------------------------------------------------
// Sea surface temperature — "Ocean Chorale"
// ---------------------------------------------------------------------------
export class OceanComposer extends Composer {
  static LAYERS = [
    { id: "warm", name: "Warmest water", desc: "Plucked strings: the warmest water in each slice of ocean. Higher = warmer." },
    { id: "cold", name: "Coldest water", desc: "Soft low notes: the coldest water in the same slice, so you hear the pole-to-equator contrast." },
    { id: "pad", name: "Ocean heat", desc: "A sustained chord that gets brighter as the average ocean temperature rises." },
    { id: "flow", name: "Currents in motion", desc: "Surf-like noise that swells when the currents are moving faster on screen." },
  ];
  constructor(engine, { root = 50, scale = SCALES.dorian } = {}) {
    super(engine);
    this.root = root; this.scale = scale;
  }
  start() {
    this.pad = this.keep(new Pad(this.e, this.L("pad"), { voices: 3, level: 0.07, cutoff: 700 }));
    this.pad.setChord(chord(this.root - 12, this.scale, 0, 3), this.e.now);
    this.flow = this.keep(new NoiseBed(this.e, this.L("flow"), { type: "bandpass", freq: 600, q: 0.6, lfoRate: 0.13 }));
  }
  step(i, time, dur, f, scan) {
    const c = i % COLS;
    let warm = -1, warmV = -1, cold = -1, coldV = 2, cover = 0;
    for (let r = 0; r < scan.rows; r++) {
      const k = r * scan.cols + c;
      if (scan.cover[k] < 0.12) continue;
      cover += scan.cover[k];
      if (scan.max[k] > warmV) { warmV = scan.max[k]; warm = r; }
      if (scan.mean[k] < coldV) { coldV = scan.mean[k]; cold = r; }
    }
    cover /= scan.rows;
    if (warm >= 0) {
      pluck(this.e, this.L("warm"), time, {
        midi: quantize(warmV, this.root, this.scale, 3), vel: 0.35 + 0.6 * clamp01(cover * 2.5),
        pan: colPan(c), dur: 1.4, bright: warmV,
      });
    }
    if (cold >= 0 && i % 2 === 1) {
      pluck(this.e, this.L("cold"), time, {
        midi: quantize(coldV, this.root - 12, this.scale, 2), vel: 0.3, pan: colPan(c), dur: 2, bright: 0.1,
      });
    }
    const mn = this._meanNorm(f);
    const meanNorm = Number.isNaN(mn) ? 0.5 : mn;
    this.pad.setCutoff(300 + meanNorm * 2600, time, 1);
    this.flow.setLevel(0.015 + f.motion * 0.12, time, 0.6);
    this.flow.setFreq(350 + f.motion * 1800, time, 0.6);
    // Hot-spot chime once per sweep where the hottest cell is.
    if (c === 0 && f.stats.maxAt && this._maxNorm(f) > 0.9) {
      const pan = (f.stats.maxAt.x / f.w) * 1.7 - 0.85;
      bell(this.e, this.L("warm"), time, { midi: this.root + 36, vel: 0.35, pan, dur: 3 });
    }
  }
  _meanNorm(f) {
    let s = 0, n = 0;
    for (let i = 0; i < f.norm.length; i += 3) if (!Number.isNaN(f.norm[i])) { s += f.norm[i]; n++; }
    return n ? s / n : NaN;
  }
  _maxNorm(f) {
    const i = f.stats.maxAt ? f.stats.maxAt.y * f.w + f.stats.maxAt.x : -1;
    return i >= 0 ? f.norm[i] : 0;
  }
}

// ---------------------------------------------------------------------------
// Lightning — "Storm Drums"
// ---------------------------------------------------------------------------
export class LightningComposer extends Composer {
  static LAYERS = [
    { id: "strikes", name: "Lightning strikes", desc: "One drum hit per new flash. Left–right = longitude. Deep drums = near the equator, higher drums = towards the poles." },
    { id: "rumble", name: "Thunder rumble", desc: "Low rumble that grows with the total amount of lightning on the planet." },
    { id: "pulse", name: "Rain pulse", desc: "Hi-hat-like ticks; more ticks when more of the world is stormy." },
    { id: "drone", name: "Hemisphere chord", desc: "Major chord when most lightning is in the Northern Hemisphere, minor when most is in the Southern." },
  ];
  start() {
    this.queue = [];
    this.rumble = this.keep(new NoiseBed(this.e, this.L("rumble"), { type: "lowpass", freq: 160, q: 0.5, lfoRate: 0.05 }));
    this.drone = this.keep(new Pad(this.e, this.L("drone"), { voices: 3, type: "triangle", level: 0.06, cutoff: 600 }));
    this.drone.setChord([45, 52, 57], this.e.now);
  }
  step(i, time, dur, f) {
    if (f !== this._lastF) {
      this._lastF = f;
      for (const ev of f.events) this.queue.push(ev);
      this.queue.sort((a, b) => b.intensity - a.intensity);
      if (this.queue.length > 24) this.queue.length = 24;
    }
    const hits = Math.min(this.queue.length, 2);
    for (let h = 0; h < hits; h++) {
      const ev = this.queue.shift();
      const polar = Math.min(1, Math.abs(ev.lat) / 50);
      drum(this.e, this.L("strikes"), time + h * dur * 0.5, {
        freq: lerp(48, 170, polar), vel: 0.35 + 0.6 * ev.intensity, pan: ev.lon / 180,
        decay: lerp(0.6, 0.18, polar), noise: lerp(0.25, 0.7, polar), tone: lerp(900, 4000, polar),
      });
    }
    const d = clamp01(Math.sqrt(f.stats.density || 0) * 4);
    this.rumble.setLevel(0.02 + d * 0.22, time, 0.8);
    this.rumble.setFreq(110 + d * 260, time, 0.8);
    if (Math.random() < 0.15 + d * 0.8) {
      grain(this.e, this.L("pulse"), time, { vel: 0.15 + d * 0.3, pan: Math.random() * 1.6 - 0.8, freq: 7000, q: 0.8, dur: 0.025 });
    }
    if (i % 16 === 0) {
      const north = (f.stats.northShare ?? 0.5) >= 0.5;
      this.drone.setChord(north ? [45, 49, 52] : [45, 48, 52], time, 1.5);
      drum(this.e, this.L("pulse"), time, { freq: 45, vel: 0.25 + d * 0.3, decay: 0.5, noise: 0 });
    }
  }
}

// ---------------------------------------------------------------------------
// Aerosols — "Air Quartet": one instrument per particle type
// ---------------------------------------------------------------------------
export class AerosolComposer extends Composer {
  static LAYERS = [
    { id: "dust", name: "Dust (magenta)", desc: "Low buzzing drone. Louder with more dust; it pans towards where the dust is." },
    { id: "blackCarbon", name: "Smoke / black carbon (red-orange)", desc: "Crackling fire-like grains. More smoke = denser crackle." },
    { id: "seaSalt", name: "Sea salt (cyan)", desc: "Wind and surf noise that swells with the sea-salt swirls of storms." },
    { id: "sulfate", name: "Sulfate (green)", desc: "Glassy bells played by the scanner wherever sulfate pollution is. Higher bell = further north." },
  ];
  start() {
    this.dustPan = pannedDest(this.e, "dust");
    this.dust = this.keep(new Pad(this.e, this.dustPan, { voices: 2, type: "sawtooth", level: 0, cutoff: 300 }));
    this.dust.setChord([38, 45], this.e.now);
    this.salt = this.keep(new NoiseBed(this.e, this.L("seaSalt"), { type: "bandpass", freq: 1400, q: 0.5, lfoRate: 0.18 }));
  }
  step(i, time, dur, f, scan) {
    const T = f.stats.types;
    const dust = T.dust, smoke = T.blackCarbon, salt = T.seaSalt;
    this.dust.setLevel(Math.min(0.2, dust.coverage * 1.4), time, 0.8);
    this.dust.setCutoff(180 + dust.intensity * 1400, time, 0.8);
    if (dust.centroid && this.dustPan.pan) this.dustPan.pan.setTargetAtTime(dust.centroid.lon / 180, time, 0.8);
    this.salt.setLevel(Math.min(0.16, salt.coverage * 0.5), time, 0.8);
    if (salt.centroid) this.salt.setPan(salt.centroid.lon / 180, time);

    const grains = Math.min(4, Math.round(smoke.coverage * 120));
    for (let g = 0; g < grains; g++) {
      grain(this.e, this.L("blackCarbon"), time + Math.random() * dur, {
        vel: 0.2 + smoke.intensity * 0.5, pan: smoke.centroid ? smoke.centroid.lon / 180 + (Math.random() - 0.5) * 0.4 : 0,
        freq: 1200 + Math.random() * 4500, q: 2, dur: 0.012 + Math.random() * 0.03,
      });
    }
    if (i % 16 === 0 && smoke.coverage > 0.004) {
      pluck(this.e, this.L("blackCarbon"), time, { midi: 41, vel: 0.3 + smoke.coverage * 4, pan: smoke.centroid ? smoke.centroid.lon / 180 : 0, dur: 2.5, bright: 0.15 });
    }

    // Sulfate bells via the scanner.
    const c = i % COLS;
    let best = -1, bestV = 0;
    for (let r = 0; r < scan.rows; r++) {
      const k = r * scan.cols + c;
      if (scan.type[k] === 4 && scan.cover[k] > 0.12 && scan.cover[k] > bestV) { bestV = scan.cover[k]; best = r; }
    }
    if (best >= 0) {
      bell(this.e, this.L("sulfate"), time, {
        midi: quantize(rowLat(best, scan.rows), 67, SCALES.majorPentatonic, 2), vel: 0.25 + bestV * 0.6, pan: colPan(c), dur: 1.8, ratio: 2.76, index: 2.5,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Carbon dioxide — "Carbon Breath"
// ---------------------------------------------------------------------------
export class Co2Composer extends Composer {
  static LAYERS = [
    { id: "drone", name: "Carbon drone", desc: "A low chord that grows louder, brighter and more out-of-tune as more of the planet is covered by high CO₂." },
    { id: "plumes", name: "Plumes", desc: "Notes from the scanner wherever there is a visible CO₂ plume. Higher note = higher ppm. Tense notes appear above ~440 ppm." },
    { id: "pulse", name: "Heartbeat", desc: "A heartbeat whose strength follows total plume coverage — you can hear the daily pulse of fires and plants." },
  ];
  start() {
    this.drone = this.keep(new Pad(this.e, this.L("drone"), { voices: 3, type: "sawtooth", level: 0.05, cutoff: 400 }));
    this.drone.setChord([36, 43, 48], this.e.now);
  }
  step(i, time, dur, f, scan) {
    const k = clamp01(f.stats.coverage / 0.06);
    this.drone.setLevel(0.04 + k * 0.1, time, 1);
    this.drone.setCutoff(250 + k * 2000, time, 1);
    this.drone.setDetune(3 + k * 22, time);
    const c = i % COLS;
    let best = -1, bestV = -1, cov = 0;
    for (let r = 0; r < scan.rows; r++) {
      const q = r * scan.cols + c;
      if (scan.cover[q] < 0.08) continue;
      cov += scan.cover[q];
      if (scan.max[q] > bestV) { bestV = scan.max[q]; best = r; }
    }
    if (best >= 0) {
      // Above ~440 ppm (t≈0.42 on the opaque part of the bar) switch to a darker mode.
      const scale = bestV > 0.42 ? SCALES.phrygian : SCALES.dorian;
      pluck(this.e, this.L("plumes"), time, {
        midi: quantize(bestV, 48, scale, 2), vel: 0.3 + clamp01(cov) * 0.6, pan: colPan(c), dur: 1.6, bright: 0.3 + bestV * 0.5,
      });
    }
    if (i % 4 === 0 || i % 16 === 3) {
      drum(this.e, this.L("pulse"), time, { freq: 52, vel: 0.15 + k * 0.6, decay: 0.4, noise: 0.05, tone: 300 });
    }
  }
}

// ---------------------------------------------------------------------------
// Night lights — "City Lights"
// ---------------------------------------------------------------------------
export class NightLightsComposer extends Composer {
  static LAYERS = [
    { id: "cities", name: "City lights (2012–2023)", desc: "During the yearly maps: the brightest places in each slice of the world, played as notes. Higher = further north." },
    { id: "gain", name: "New lights (purple)", desc: "During the change map: bright, rising major-key notes where lights appeared." },
    { id: "loss", name: "Lights out (orange)", desc: "During the change map: low, muffled minor-key notes where lights went out." },
    { id: "pad", name: "Planet glow", desc: "A chord that brightens with total light. Major when the world gained more light than it lost, minor otherwise." },
  ];
  start() {
    this.pad = this.keep(new Pad(this.e, this.L("pad"), { voices: 3, type: "triangle", level: 0.06, cutoff: 800 }));
    this.pad.setChord([48, 52, 55], this.e.now);
    this._year = null;
  }
  step(i, time, dur, f, scan, info) {
    const c = i % COLS;
    if (f.mode === "series") {
      if (info.year !== this._year) {
        if (this._year !== null) bell(this.e, this.L("cities"), time, { midi: 84, vel: 0.3, dur: 2 });
        this._year = info.year;
      }
      const cells = [];
      for (let r = 0; r < scan.rows; r++) {
        const k = r * scan.cols + c;
        if (scan.cover[k] > 0.03) cells.push([r, scan.cover[k] * (scan.mean[k] || 0)]);
      }
      cells.sort((a, b) => b[1] - a[1]);
      cells.slice(0, 2).forEach(([r, w], j) => {
        pluck(this.e, this.L("cities"), time + j * dur * 0.5, {
          midi: quantize(rowLat(r, scan.rows), 55, SCALES.lydian, 3), vel: clamp01(0.25 + w * 6), pan: colPan(c), dur: 1, bright: 0.7,
        });
      });
      this.pad.setCutoff(300 + clamp01(f.stats.brightness * 20) * 2500, time, 1);
      this.pad.setChord([48, 52, 55], time, 1);
    } else {
      let g = -1, gV = 0, l = -1, lV = 0;
      for (let r = 0; r < scan.rows; r++) {
        const k = r * scan.cols + c;
        if (scan.cover[k] < 0.02) continue;
        const v = scan.mean[k] * 2 - 1; // back to -1..1
        if (v > 0 && scan.cover[k] * v > gV) { gV = scan.cover[k] * v; g = r; }
        if (v < 0 && -scan.cover[k] * v > lV) { lV = -scan.cover[k] * v; l = r; }
      }
      if (g >= 0) pluck(this.e, this.L("gain"), time, { midi: quantize(rowLat(g, scan.rows), 64, SCALES.majorPentatonic, 2), vel: clamp01(0.3 + gV * 8), pan: colPan(c), dur: 1.2, bright: 0.9 });
      if (l >= 0) pluck(this.e, this.L("loss"), time + dur * 0.5, { midi: quantize(rowLat(l, scan.rows), 40, SCALES.minorPentatonic, 2), vel: clamp01(0.3 + lV * 8), pan: colPan(c), dur: 1.8, bright: 0.05 });
      const major = (f.stats.balance ?? 0) >= 0;
      this.pad.setChord(major ? [48, 52, 55] : [48, 51, 55], time, 1.5);
      this.pad.setCutoff(500 + clamp01((f.stats.gainStrength + f.stats.lossStrength) * 40) * 2000, time, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// GEDI forest height — "Canopy" (globe view: scanner sweeps the screen)
// ---------------------------------------------------------------------------
export class ForestComposer extends Composer {
  static LAYERS = [
    { id: "tall", name: "Tallest canopy", desc: "Long, bowed-sounding notes for the tallest forest in each slice. Higher and longer = taller trees." },
    { id: "short", name: "Low vegetation", desc: "Short, dry plucks for the lowest vegetation in the slice." },
    { id: "pad", name: "Forest cover", desc: "A warm chord that swells with how much forest is visible on the globe." },
  ];
  start() {
    this.pad = this.keep(new Pad(this.e, this.L("pad"), { voices: 3, type: "triangle", level: 0.05, cutoff: 900 }));
    this.pad.setChord([43, 47, 50], this.e.now);
  }
  step(i, time, dur, f, scan) {
    const c = i % COLS;
    let tall = -1, tallV = -1, low = -1, lowV = 2;
    for (let r = 0; r < scan.rows; r++) {
      const k = r * scan.cols + c;
      if (scan.cover[k] < 0.15) continue;
      if (scan.max[k] > tallV) { tallV = scan.max[k]; tall = r; }
      if (scan.mean[k] < lowV) { lowV = scan.mean[k]; low = r; }
    }
    if (tall >= 0) {
      const dest = this.L("tall");
      const midi = quantize(tallV, 43, SCALES.majorPentatonic, 3);
      pluck(this.e, dest, time, { midi, vel: 0.3 + tallV * 0.5, pan: colPan(c), dur: 0.9 + tallV * 2.2, bright: 0.25 });
      if (tallV > 0.6) pluck(this.e, dest, time + 0.03, { midi: midi + 12, vel: 0.15, pan: colPan(c), dur: 2.5, bright: 0.1 });
    }
    if (low >= 0 && i % 2 === 1) {
      pluck(this.e, this.L("short"), time, { midi: quantize(lowV, 31, SCALES.majorPentatonic, 2), vel: 0.25, pan: colPan(c), dur: 0.35, bright: 0.05 });
    }
    this.pad.setLevel(0.02 + clamp01(f.stats.coverage * 4) * 0.08, time, 1);
  }
}

// ---------------------------------------------------------------------------
// Any image — classic image sonification (row = pitch, brightness = loudness)
// ---------------------------------------------------------------------------
export class ImageComposer extends Composer {
  static LAYERS = [
    { id: "warmHues", name: "Warm colours", desc: "Reds, oranges and yellows play as plucked strings." },
    { id: "coolHues", name: "Cool colours", desc: "Greens, blues and purples play as bells." },
    { id: "pad", name: "Overall brightness", desc: "A chord that brightens with the image's average brightness." },
  ];
  start() {
    this.pad = this.keep(new Pad(this.e, this.L("pad"), { voices: 3, type: "triangle", level: 0.05, cutoff: 800 }));
    this.pad.setChord([48, 55, 60], this.e.now);
  }
  step(i, time, dur, f, scan) {
    const c = i % COLS;
    const cells = [];
    for (let r = 0; r < scan.rows; r++) {
      const k = r * scan.cols + c;
      cells.push([r, scan.mean[k] || 0]);
    }
    cells.sort((a, b) => b[1] - a[1]);
    for (const [r, v] of cells.slice(0, 2)) {
      if (v < 0.25) continue;
      const px = Math.floor(((c + 0.5) / COLS) * f.w), py = Math.floor(((r + 0.5) / scan.rows) * f.h);
      const idx = py * f.w + px;
      const hue = f.hue[idx], sat = f.sat[idx];
      const midi = quantize(rowLat(r, scan.rows), 48, SCALES.majorPentatonic, 3);
      const warmHue = sat > 0.2 && (hue < 70 || hue > 320);
      if (warmHue || sat <= 0.2) pluck(this.e, this.L("warmHues"), time, { midi, vel: v, pan: colPan(c), dur: 1, bright: v });
      else bell(this.e, this.L("coolHues"), time, { midi, vel: v * 0.8, pan: colPan(c), dur: 1.6, ratio: 2.5, index: 2 });
    }
    this.pad.setCutoff(300 + (f.stats.mean || 0) * 2500, time, 1);
  }
}

export const COMPOSERS = {
  ocean: OceanComposer,
  lightning: LightningComposer,
  aerosols: AerosolComposer,
  co2: Co2Composer,
  nightlights: NightLightsComposer,
  forest: ForestComposer,
  image: ImageComposer,
};
