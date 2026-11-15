// Runs every composer against real analysed frames using a minimal fake Web
// Audio graph, to catch runtime errors and check that sound is produced.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeAnalyzers, scanGrid } from "../js/analysis.js";
import { COMPOSERS } from "../js/composers.js";
import { TRACKS } from "../js/tracks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = makeAnalyzers(JSON.parse(fs.readFileSync(path.join(ROOT, "media/colormaps.json"), "utf8")));

// ---- fake Web Audio ---------------------------------------------------------
function param(v = 0) {
  const p = { value: v };
  for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues"]) {
    p[m] = (val, t) => {
      assert.ok(Number.isFinite(val), `${m} got non-finite value ${val}`);
      assert.ok(t === undefined || Number.isFinite(t), `${m} got non-finite time ${t}`);
      if (m.startsWith("exponential")) assert.ok(val > 0, "exponential ramp to <= 0");
      return p;
    };
  }
  p.connect = () => p;
  return p;
}
function node(extra = {}) {
  const n = {
    connect: (d) => d ?? n, disconnect() {}, start() { counts.starts++; }, stop() {},
    gain: param(1), frequency: param(440), detune: param(0), Q: param(1), pan: param(0), ...extra,
  };
  return n;
}
const counts = { starts: 0 };
const fakeCtx = {
  currentTime: 0, sampleRate: 48000,
  createGain: () => node(), createOscillator: () => node({ type: "sine" }), createBiquadFilter: () => node({ type: "lowpass" }),
  createStereoPanner: () => node(), createBufferSource: () => node({ buffer: null, loop: false }),
};
const engine = {
  ctx: fakeCtx, noise: {}, get now() { return fakeCtx.currentTime; },
  layers: new Map(),
  layer(id) { if (!this.layers.has(id)) this.layers.set(id, node()); return this.layers.get(id); },
  claimVoice: () => true,
};

function fixture(name) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures", `${name}.json`), "utf8"));
  return { img: { width: j.width, height: j.height, data: new Uint8ClampedArray(Buffer.from(j.rgba, "base64")) }, time: j.time };
}

const FRAMES = {
  sst: ["sst@5", "sst@40"], lightning: ["lightning@20", "lightning@60"], aerosols: ["aerosols@5", "aerosols@50"],
  co2: ["co2@2", "co2@20"], nightlights: ["nightlights@1", "nightlights@23", "nightlights@30"], gedi: ["gedi@20"], ocean2: ["ocean2@30"],
};

for (const track of TRACKS) {
  test(`composer for ${track.id} runs 64 steps and makes sound`, () => {
    counts.starts = 0;
    const Comp = COMPOSERS[track.composer];
    assert.ok(Comp.LAYERS.length >= 3, "each record explains at least three sound layers");
    const c = new Comp(engine, track.composerOpts || {});
    c.start();
    let prev = null;
    for (const name of FRAMES[track.id]) {
      const { img, time } = fixture(name);
      const f = A[track.analyzer](img, time, prev);
      prev = f;
      const scan = scanGrid(f, 16, 12);
      const info = track.date(time, 60);
      for (let i = 0; i < 64; i++) { fakeCtx.currentTime += 0.15; c.step(i, fakeCtx.currentTime, 0.15, f, scan, info); }
    }
    c.stop();
    assert.ok(counts.starts > 40, `${track.id}: only ${counts.starts} sound sources started`);
  });
}

test("legends can be played for every record", () => {
  for (const t of TRACKS) for (const item of t.legend) {
    assert.ok(item.say.length > 3);
    item.play(engine, 1);
  }
});
