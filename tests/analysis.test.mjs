// Validates the pixel -> data pipeline on real NASA SVS frames (fixtures are
// produced by scripts/build_media.py at the same resolution the app analyses).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeAnalyzers, scanGrid, sampleAt } from "../js/analysis.js";
import { ColormapInverter } from "../js/color.js";
import { placeName, cellToLatLon, latLonToCell } from "../js/geo.js";
import { quantize, SCALES } from "../js/music.js";
import { describe, readout, probeText } from "../js/describe.js";
import { TRACKS } from "../js/tracks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const colormaps = JSON.parse(fs.readFileSync(path.join(ROOT, "media/colormaps.json"), "utf8"));
const A = makeAnalyzers(colormaps);

function fixture(name) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures", `${name}.json`), "utf8"));
  return { img: { width: j.width, height: j.height, data: new Uint8ClampedArray(Buffer.from(j.rgba, "base64")) }, time: j.time };
}
const run = (analyzer, name, prev = null) => { const { img, time } = fixture(name); return A[analyzer](img, time, prev); };

test("colormap inversion recovers every legend stop", () => {
  for (const key of ["sst", "co2", "gedi", "ocean2", "nightlights"]) {
    const inv = A.inverters[key];
    const cm = colormaps[key];
    let worst = 0;
    cm.colors.forEach((c, i) => {
      const t = inv.invertT(c[0], c[1], c[2]);
      assert.ok(t >= 0, `${key} stop ${i} rejected`);
      worst = Math.max(worst, Math.abs(t - i / (cm.colors.length - 1)));
    });
    assert.ok(worst < 0.12, `${key} worst inversion error ${worst.toFixed(3)}`);
  }
});

test("norm metric is robust to shading (darker copy of a colour maps to same value)", () => {
  const inv = new ColormapInverter(colormaps.sst, { metric: "norm", maxDist: 0.32 });
  const [r, g, b] = colormaps.sst.colors[70];
  const bright = inv.invertT(r, g, b);
  const dark = inv.invertT(Math.round(r * 0.55), Math.round(g * 0.55), Math.round(b * 0.55));
  assert.ok(Math.abs(bright - dark) < 0.08, `${bright} vs ${dark}`);
});

test("SST: warmest water is tropical, coldest is polar, plausible ranges", () => {
  for (const name of ["sst@5", "sst@40"]) {
    const f = run("sst", name);
    const s = f.stats;
    assert.ok(s.coverage > 0.2 && s.coverage < 0.5, `ocean coverage ${s.coverage}`);
    assert.ok(s.max > 27 && s.max <= 32, `max ${s.max}`);
    assert.ok(Math.abs(s.maxAt.lat) < 25, `warmest at lat ${s.maxAt.lat}`);
    assert.ok(Math.abs(s.minAt.lat) > 50, `coldest at lat ${s.minAt.lat}`);
    assert.ok(s.mean > 12 && s.mean < 26, `mean ${s.mean}`);
  }
});

test("SST: equatorial band is warmer than high latitudes on average", () => {
  const f = run("sst", "sst@40");
  const band = (lo, hi) => {
    let s = 0, n = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const { lat } = cellToLatLon(x, y, f.w, f.h);
      const v = f.value[y * f.w + x];
      if (Math.abs(lat) >= lo && Math.abs(lat) < hi && !Number.isNaN(v)) { s += v; n++; }
    }
    return s / n;
  };
  assert.ok(band(0, 15) > band(45, 70) + 10);
});

test("Lightning: detects flashes inside the ISS orbit band, mostly in the tropics", () => {
  for (const name of ["lightning@20", "lightning@60"]) {
    const f = run("lightning", name);
    assert.ok(f.stats.count > 50, `count ${f.stats.count}`);
    assert.ok(Math.abs(f.stats.centroid.lat) < 30, `centroid lat ${f.stats.centroid.lat}`);
    for (let i = 0; i < f.value.length; i++) {
      if (Number.isNaN(f.value[i])) continue;
      const { lat } = cellToLatLon(i % f.w, Math.floor(i / f.w), f.w, f.h);
      assert.ok(Math.abs(lat) < 62, `flash at impossible latitude ${lat}`);
    }
  }
});

test("Lightning: comparing two frames yields new-flash events", () => {
  const a = run("lightning", "lightning@20");
  const b = run("lightning", "lightning@60", a);
  assert.ok(b.events.length > 20, `events ${b.events.length}`);
  for (const ev of b.events.slice(0, 20)) assert.ok(b.active[ev.y * b.w + ev.x]);
});

test("Aerosols: dust over the Sahara, sulfate over East Asia", () => {
  for (const name of ["aerosols@5", "aerosols@50"]) {
    const { types } = run("aerosols", name).stats;
    const d = types.dust.centroid;
    assert.ok(d.lat > 5 && d.lat < 35 && d.lon > -40 && d.lon < 45, `dust centroid ${JSON.stringify(d)}`);
    const s = types.sulfate.centroid;
    assert.ok(s.lat > 15 && s.lon > 60 && s.lon < 140, `sulfate centroid ${JSON.stringify(s)}`);
    for (const k of Object.keys(types)) assert.ok(types[k].coverage > 0.002, `${k} missing`);
  }
});

test("CO2: plumes are within the legend's opaque range and over emission regions", () => {
  for (const name of ["co2@2", "co2@20"]) {
    const s = run("co2", name).stats;
    assert.ok(s.coverage > 0.001, "no plumes found");
    assert.ok(s.min >= 424 && s.max <= 460, `range ${s.min}-${s.max}`);
    assert.ok(Math.abs(s.plumeCentroid.lat) < 40, `centroid ${JSON.stringify(s.plumeCentroid)}`);
  }
});

test("Night lights: series mode before 24 s, change mode after; more light later", () => {
  const y2012 = run("nightlights", "nightlights@1");
  const y2023 = run("nightlights", "nightlights@23");
  const change = run("nightlights", "nightlights@30");
  assert.equal(y2012.mode, "series");
  assert.equal(change.mode, "change");
  assert.ok(y2012.stats.litFraction > 0.005);
  assert.ok(y2023.stats.litFraction > y2012.stats.litFraction, "2023 should be brighter than 2012");
  assert.ok(change.stats.gainFraction > 0 && change.stats.lossFraction > 0);
  assert.ok(change.stats.balance > 0, "globally more light gained than lost");
});

test("GEDI and Perpetual Ocean globes produce values inside their legends", () => {
  const g = run("gedi", "gedi@20").stats;
  assert.ok(g.coverage > 0.05 && g.min >= 0 && g.max <= 50);
  const o = run("ocean2", "ocean2@30").stats;
  assert.ok(o.coverage > 0.02 && o.min >= 4.9 && o.max <= 25.01, `${o.min}-${o.max}`);
});

test("scanGrid and sampleAt agree with the full-resolution analysis", () => {
  const f = run("sst", "sst@40");
  const scan = scanGrid(f, 16, 12);
  assert.equal(scan.mean.length, 192);
  // Antarctica row (bottom) has little ocean coverage compared with the tropics.
  const rowCover = (r) => scan.cover.slice(r * 16, r * 16 + 16).reduce((a, b) => a + b, 0);
  assert.ok(rowCover(6) > rowCover(11));
  const pacific = latLonToCell(0, -140, f.w, f.h);
  const s = sampleAt(f, (pacific.x + 0.5) / f.w, (pacific.y + 0.5) / f.h);
  assert.ok(s && s.value > 20, `equatorial Pacific ${s?.value}`);
});

test("music: quantize is monotonic and stays in range", () => {
  let last = -Infinity;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const m = quantize(t, 50, SCALES.dorian, 3);
    assert.ok(m >= last); last = m;
    assert.ok(m >= 50 && m <= 50 + 36);
  }
});

test("geo: place names", () => {
  assert.equal(placeName(28, 15, "land"), "the Sahara");
  assert.equal(placeName(5, 140, "ocean"), "the Western Pacific Warm Pool");
  assert.equal(placeName(-75, 0, "land"), "Antarctica");
  assert.match(placeName(-60, 40, "ocean"), /Southern Ocean/);
});

test("descriptions are generated for every record without errors", () => {
  const frames = { sst: "sst@40", lightning: "lightning@60", aerosols: "aerosols@5", co2: "co2@20", nightlights: "nightlights@30", gedi: "gedi@20", ocean2: "ocean2@30" };
  for (const t of TRACKS) {
    const f = run(t.analyzer, frames[t.id]);
    const info = t.date(10, 60);
    const text = describe(t, f, info);
    assert.ok(text.length > 20 && !/NaN|undefined/.test(text), `${t.id}: ${text}`);
    for (const r of readout(t, f, info)) assert.ok(!/NaN|undefined/.test(r.value), `${t.id} readout ${r.label}=${r.value}`);
    const p = probeText(t, sampleAt(f, 0.5, 0.5), 0.5, 0.5, f);
    assert.ok(!/NaN|undefined/.test(p.spoken), p.spoken);
  }
});
