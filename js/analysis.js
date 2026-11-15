// Frame analysers: turn the pixels of one EIC/SVS video frame into data.
//
// Every analyser receives an ImageData-like object {data, width, height}
// (RGBA, already downscaled to the track's analysis grid), the playback time,
// and the previous result (for motion / "new flash" detection). They are pure
// and DOM-free, which is what lets `npm test` validate them on real frames.

import { ColormapInverter, rgbToHsv, luminance } from "./color.js";
import { cellToLatLon } from "./geo.js";

export const AEROSOL_TYPES = ["none", "blackCarbon", "dust", "seaSalt", "sulfate"];

function baseFeatures(img) {
  const n = img.width * img.height;
  return {
    w: img.width,
    h: img.height,
    value: new Float32Array(n).fill(NaN), // physical value (°C, ppm, m, ...)
    norm: new Float32Array(n).fill(NaN),  // 0..1 position on the colour scale
    lum: new Float32Array(n),
    motion: 0,
    events: [],
    stats: {},
  };
}

function inRects(fx, fy, rects) {
  if (!rects) return false;
  for (const r of rects) if (fx >= r[0] && fx <= r[1] && fy >= r[2] && fy <= r[3]) return true;
  return false;
}

function finishMotion(f, prev) {
  if (!prev || prev.lum.length !== f.lum.length) return;
  let s = 0;
  for (let i = 0; i < f.lum.length; i++) s += Math.abs(f.lum[i] - prev.lum[i]);
  // Typical frame-to-frame differences are a few percent; scale into ~0..1.
  f.motion = Math.min(1, (s / f.lum.length) * 25);
}

/** Summary statistics over the valid cells of `f.value`. */
function valueStats(f, geo) {
  let n = 0, sum = 0, min = Infinity, max = -Infinity, minI = -1, maxI = -1;
  for (let i = 0; i < f.value.length; i++) {
    const v = f.value[i];
    if (Number.isNaN(v)) continue;
    n++; sum += v;
    if (v < min) { min = v; minI = i; }
    if (v > max) { max = v; maxI = i; }
  }
  const loc = (i) => {
    if (i < 0) return null;
    const x = i % f.w, y = Math.floor(i / f.w);
    return geo ? { x, y, ...cellToLatLon(x, y, f.w, f.h) } : { x, y, fx: x / f.w, fy: y / f.h };
  };
  return {
    coverage: n / f.value.length,
    mean: n ? sum / n : NaN,
    min: n ? min : NaN,
    max: n ? max : NaN,
    minAt: loc(minI),
    maxAt: loc(maxI),
  };
}

/** Circular mean longitude + mean latitude of cells selected by `pick`. */
function centroid(f, pick) {
  let cx = 0, cy = 0, lat = 0, wsum = 0;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const wgt = pick(y * f.w + x);
      if (!wgt) continue;
      const p = cellToLatLon(x, y, f.w, f.h);
      const a = (p.lon * Math.PI) / 180;
      cx += Math.cos(a) * wgt; cy += Math.sin(a) * wgt; lat += p.lat * wgt; wsum += wgt;
    }
  }
  if (!wsum) return null;
  return { lat: lat / wsum, lon: (Math.atan2(cy, cx) * 180) / Math.PI, weight: wsum };
}

// ---------------------------------------------------------------------------

/** Continuous-colormap analyser (SST, Perpetual Ocean temperature, GEDI). */
function makeScalarAnalyzer(inv, { minSat = 0.3, minV = 0.2, minT = 0, accept, exclude, geo = true } = {}) {
  return (img, time, prev) => {
    const f = baseFeatures(img);
    const d = img.data;
    for (let i = 0, p = 0; i < f.lum.length; i++, p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      f.lum[i] = luminance(r, g, b);
      const [h, s, v] = rgbToHsv(r, g, b);
      if (s < minSat || v < minV) continue;
      if (accept && !accept(h, s, v, r, g, b)) continue;
      if (exclude && inRects((i % f.w) / f.w, Math.floor(i / f.w) / f.h, exclude)) continue;
      const t = inv.invertT(r, g, b);
      if (t < minT) continue;
      f.norm[i] = t;
      f.value[i] = inv.toValue(t);
    }
    finishMotion(f, prev);
    f.stats = valueStats(f, geo);
    return f;
  };
}

function lightningAnalyzer(img, time, prev) {
  const f = baseFeatures(img);
  const d = img.data;
  const active = new Uint8Array(f.lum.length);
  let count = 0, north = 0;
  for (let i = 0, p = 0; i < f.lum.length; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    f.lum[i] = luminance(r, g, b);
    // Lightning events are drawn as yellow dots on a grey/black map.
    const yellow = (r + g) / 2 - b;
    if (r > 70 && g > 60 && yellow > 38 && b < g * 0.75) {
      const intensity = Math.min(1, yellow / 160);
      active[i] = 1;
      f.norm[i] = intensity;
      f.value[i] = intensity;
      count++;
      if (i / f.w < f.h / 2) north++;
    }
  }
  // A "new flash" is a cell lit now that was dark in the previous analysed frame.
  if (prev && prev.active && prev.active.length === active.length) {
    for (let i = 0; i < active.length; i++) {
      if (active[i] && !prev.active[i]) {
        const x = i % f.w, y = Math.floor(i / f.w);
        f.events.push({ x, y, intensity: f.norm[i], ...cellToLatLon(x, y, f.w, f.h) });
      }
    }
  }
  f.active = active;
  finishMotion(f, prev);
  const c = centroid(f, (i) => active[i]);
  // Busiest 30°x30° box
  const bx = 12, by = 6, boxes = new Float32Array(bx * by);
  for (let i = 0; i < active.length; i++) if (active[i]) {
    const x = i % f.w, y = Math.floor(i / f.w);
    boxes[Math.floor((y / f.h) * by) * bx + Math.floor((x / f.w) * bx)]++;
  }
  let bi = 0;
  for (let i = 1; i < boxes.length; i++) if (boxes[i] > boxes[bi]) bi = i;
  f.stats = {
    count,
    density: count / active.length,
    newFlashes: f.events.length,
    northShare: count ? north / count : 0.5,
    centroid: c,
    busiest: count ? {
      lat: 90 - ((Math.floor(bi / bx) + 0.5) / by) * 180,
      lon: -180 + (((bi % bx) + 0.5) / bx) * 360,
      share: boxes[bi] / count,
    } : null,
  };
  return f;
}

function classifyAerosol(r, g, b) {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (v < 0.22) return [0, 0];
  if (h >= 75 && h <= 165 && s > 0.35) return [4, v];                // sulfate (green)
  if ((h <= 35 || h >= 345) && s > 0.35 && v > 0.3) return [1, v];   // black carbon / smoke
  if (h >= 255 && h <= 335 && s > 0.12 && v > 0.42) return [2, v];   // dust (magenta / lilac)
  if (h >= 165 && h < 230 && s > 0.08 && v > 0.33) return [3, v];    // sea salt (cyan)
  if (s < 0.16 && v > 0.62) return [3, v];                           // bright white sea-salt swirls
  return [0, 0];
}

function aerosolAnalyzer(img, time, prev) {
  const f = baseFeatures(img);
  const d = img.data;
  f.type = new Uint8Array(f.lum.length);
  const cover = [0, 0, 0, 0, 0], inten = [0, 0, 0, 0, 0];
  for (let i = 0, p = 0; i < f.lum.length; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    f.lum[i] = luminance(r, g, b);
    const [t, v] = classifyAerosol(r, g, b);
    if (!t) continue;
    f.type[i] = t;
    f.norm[i] = v;
    f.value[i] = v;
    cover[t]++; inten[t] += v;
  }
  finishMotion(f, prev);
  const n = f.lum.length;
  const types = {};
  for (let t = 1; t <= 4; t++) {
    types[AEROSOL_TYPES[t]] = {
      coverage: cover[t] / n,
      intensity: cover[t] ? inten[t] / cover[t] : 0,
      centroid: cover[t] ? centroid(f, (i) => (f.type[i] === t ? f.norm[i] : 0)) : null,
    };
  }
  let dominant = null, best = 0;
  for (const [k, v] of Object.entries(types)) if (v.coverage > best) { best = v.coverage; dominant = k; }
  f.stats = { types, dominant, coverage: (cover[1] + cover[2] + cover[3] + cover[4]) / n };
  return f;
}

function makeCo2Analyzer(inv) {
  const scalar = makeScalarAnalyzer(inv, {
    minSat: 0.42,
    minV: 0.45,
    // Plumes are orange/red; reject the blue marble's blues, greens and pale sand.
    accept: (h) => h <= 48 || h >= 350,
  });
  return (img, time, prev) => {
    const f = scalar(img, time, prev);
    const c = centroid(f, (i) => (Number.isNaN(f.value[i]) ? 0 : f.norm[i] + 0.05));
    f.stats.plumeCentroid = c;
    return f;
  };
}

function makeNightLightsAnalyzer(inv, seriesEnd) {
  const changeExclude = [[0.36, 0.56, 0.66, 0.76]]; // on-screen colour bar
  const seriesExclude = [[0.42, 0.5, 0.58, 0.68]];  // on-screen year label
  return (img, time, prev) => {
    const f = baseFeatures(img);
    const d = img.data;
    const series = time < seriesEnd;
    f.mode = series ? "series" : "change";
    let lit = 0, sum = 0, gain = 0, loss = 0, gainSum = 0, lossSum = 0;
    for (let i = 0, p = 0; i < f.lum.length; i++, p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      const L = luminance(r, g, b);
      f.lum[i] = L;
      const fx = (i % f.w) / f.w, fy = Math.floor(i / f.w) / f.h;
      if (series) {
        if (inRects(fx, fy, seriesExclude)) continue;
        // Annual-average lights drawn warm-white on black. Calibrated on the
        // SVS stills: background < 0.01, brightest metro areas ≈ 0.2–0.3.
        const brightness = Math.min(1, Math.max(0, (L - 0.015) / 0.2));
        if (brightness <= 0.05) continue;
        f.norm[i] = brightness; f.value[i] = brightness;
        lit++; sum += brightness;
      } else {
        if (inRects(fx, fy, changeExclude)) continue;
        const [, s, v] = rgbToHsv(r, g, b);
        if (s < 0.22 || v < 0.16) continue; // grey land, dark ocean, "no change"
        const t = inv.invertT(r, g, b);
        if (t < 0) continue;
        const change = inv.toValue(t); // -1 lights out .. +1 new lights
        if (Math.abs(change) < 0.15) continue;
        const weighted = change * Math.min(1, v * 1.6);
        f.value[i] = weighted;
        f.norm[i] = (weighted + 1) / 2;
        if (weighted > 0) { gain++; gainSum += weighted; } else { loss++; lossSum -= weighted; }
      }
    }
    finishMotion(f, prev);
    const n = f.lum.length;
    if (series) {
      f.stats = { litFraction: lit / n, brightness: sum / n, centroid: centroid(f, (i) => (Number.isNaN(f.value[i]) ? 0 : f.value[i])) };
    } else {
      f.stats = {
        gainFraction: gain / n,
        lossFraction: loss / n,
        gainStrength: gainSum / n,
        lossStrength: lossSum / n,
        balance: gainSum + lossSum ? (gainSum - lossSum) / (gainSum + lossSum) : 0,
        gainCentroid: centroid(f, (i) => (f.value[i] > 0 ? f.value[i] : 0)),
        lossCentroid: centroid(f, (i) => (f.value[i] < 0 ? -f.value[i] : 0)),
      };
    }
    return f;
  };
}

/** Generic analyser for user-supplied images: brightness = value, hue = colour family. */
function imageAnalyzer(img, time, prev) {
  const f = baseFeatures(img);
  const d = img.data;
  f.hue = new Float32Array(f.lum.length);
  f.sat = new Float32Array(f.lum.length);
  let sum = 0;
  for (let i = 0, p = 0; i < f.lum.length; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const [h, s, v] = rgbToHsv(r, g, b);
    f.lum[i] = luminance(r, g, b);
    f.hue[i] = h; f.sat[i] = s;
    f.norm[i] = v; f.value[i] = v;
    sum += v;
  }
  finishMotion(f, prev);
  f.stats = valueStats(f, false);
  f.stats.mean = sum / f.lum.length;
  return f;
}

/** Build all analysers from the colormaps extracted by scripts/build_media.py. */
export function makeAnalyzers(colormaps) {
  const sstInv = new ColormapInverter(colormaps.sst, { metric: "norm", maxDist: 0.32 });
  const oceanInv = new ColormapInverter(colormaps.ocean2, { metric: "norm", maxDist: 0.3 });
  const gediInv = new ColormapInverter(colormaps.gedi, { metric: "hybrid", maxDist: 0.35 });
  const co2Inv = new ColormapInverter(colormaps.co2, { metric: "rgb", maxDist: 0.3 });
  const nlInv = new ColormapInverter(colormaps.nightlights, { metric: "norm", maxDist: 0.35 });
  return {
    inverters: { sst: sstInv, ocean2: oceanInv, gedi: gediInv, co2: co2Inv, nightlights: nlInv },
    sst: makeScalarAnalyzer(sstInv, { minSat: 0.35, minV: 0.22 }),
    // Below ~5 °C the legend's navy blues are indistinguishable from the
    // Blue Marble ocean floor shown between particles, so they are ignored.
    ocean2: makeScalarAnalyzer(oceanInv, {
      minSat: 0.3, minV: 0.14, minT: 0.2, geo: false,
      // Reject land greens and blue-marble land browns that are not on the bar.
      accept: (h, s, v, r, g, b) => !(g > r && g > b),
    }),
    gedi: makeScalarAnalyzer(gediInv, {
      minSat: 0.12, minV: 0.1, geo: false,
      accept: (h, s, v, r, g, b) => !(b > r && b > g), // drop blue ocean
      exclude: [[0, 0.3, 0.84, 1]], // on-screen colour bar
    }),
    co2: makeCo2Analyzer(co2Inv),
    lightning: lightningAnalyzer,
    aerosols: aerosolAnalyzer,
    nightlights: makeNightLightsAnalyzer(nlInv, 24),
    image: imageAnalyzer,
  };
}

/**
 * Reduce a frame to a coarse `cols x rows` matrix for the musical scanner.
 * Each cell holds the mean normalised value of its valid pixels and the
 * fraction of pixels that were valid ("coverage").
 */
export function scanGrid(f, cols = 16, rows = 12) {
  const mean = new Float32Array(cols * rows).fill(NaN);
  const max = new Float32Array(cols * rows).fill(NaN);
  const cover = new Float32Array(cols * rows);
  const type = f.type ? new Uint8Array(cols * rows) : null;
  const sums = new Float32Array(cols * rows), counts = new Uint32Array(cols * rows), totals = new Uint32Array(cols * rows);
  const typeCounts = f.type ? new Uint32Array(cols * rows * 5) : null;
  for (let y = 0; y < f.h; y++) {
    const ry = Math.min(rows - 1, Math.floor((y / f.h) * rows));
    for (let x = 0; x < f.w; x++) {
      const k = ry * cols + Math.min(cols - 1, Math.floor((x / f.w) * cols));
      const i = y * f.w + x;
      totals[k]++;
      const v = f.norm[i];
      if (Number.isNaN(v)) continue;
      sums[k] += v; counts[k]++;
      if (!(max[k] >= v)) max[k] = v;
      if (typeCounts) typeCounts[k * 5 + f.type[i]]++;
    }
  }
  for (let k = 0; k < cols * rows; k++) {
    cover[k] = totals[k] ? counts[k] / totals[k] : 0;
    if (counts[k]) mean[k] = sums[k] / counts[k];
    if (typeCounts) {
      let bt = 0, bc = 0;
      for (let t = 1; t <= 4; t++) if (typeCounts[k * 5 + t] > bc) { bc = typeCounts[k * 5 + t]; bt = t; }
      type[k] = bt;
    }
  }
  return { cols, rows, mean, max, cover, type };
}

/** Sample the analysed grid at fractional coordinates (Explore mode probe). */
export function sampleAt(f, fx, fy, radius = 1) {
  const cx = Math.min(f.w - 1, Math.max(0, Math.floor(fx * f.w)));
  const cy = Math.min(f.h - 1, Math.max(0, Math.floor(fy * f.h)));
  let n = 0, sv = 0, sn = 0;
  const typeVotes = [0, 0, 0, 0, 0];
  for (let y = cy - radius; y <= cy + radius; y++) {
    if (y < 0 || y >= f.h) continue;
    for (let x = cx - radius; x <= cx + radius; x++) {
      const xx = (x + f.w) % f.w;
      const i = y * f.w + xx;
      if (Number.isNaN(f.value[i])) continue;
      n++; sv += f.value[i]; sn += f.norm[i];
      if (f.type) typeVotes[f.type[i]]++;
    }
  }
  if (!n) return null;
  let type = null;
  if (f.type) {
    let bt = 0;
    for (let t = 1; t <= 4; t++) if (typeVotes[t] > typeVotes[bt]) bt = t;
    type = AEROSOL_TYPES[bt];
  }
  return { value: sv / n, norm: sn / n, type, x: cx, y: cy };
}
