// Earth Jukebox — application wiring.
import { AudioEngine } from "./audio/engine.js";
import { Probe, drum } from "./audio/voices.js";
import { makeAnalyzers, scanGrid, sampleAt } from "./analysis.js";
import { COMPOSERS } from "./composers.js";
import { TRACKS, IMAGE_TRACK, trackById } from "./tracks.js";
import { describe, readout, probeText } from "./describe.js";

const $ = (id) => document.getElementById(id);
const els = {
  gate: $("gate"), main: $("main"), start: $("btn-start"),
  list: $("track-list"), file: $("file-input"),
  title: $("now-title"), sub: $("now-sub"), summary: $("now-summary"),
  stage: $("stage"), video: $("video"), still: $("still"), overlay: $("overlay"), loading: $("loading"), exploreHint: $("explore-hint"),
  play: $("btn-play"), restart: $("btn-restart"), seek: $("seek"), timeLabel: $("time-label"), speed: $("speed"), volume: $("volume"),
  story: $("btn-story"), legend: $("btn-legend"), explore: $("btn-explore"), describe: $("btn-describe"), record: $("btn-record"), download: $("download"),
  caption: $("caption"), readout: $("readout"), scope: $("scope"),
  mixer: $("mixer"), mapping: $("mapping"), source: $("source"),
  polite: $("live-polite"), assertive: $("live-assertive"),
};

const GRID = {
  sst: [128, 64], lightning: [256, 128], aerosols: [128, 64], co2: [128, 64],
  nightlights: [128, 72], gedi: [128, 72], ocean2: [128, 72], image: [128, 96],
};

const engine = new AudioEngine();
const state = {
  track: null,
  analyzers: null,
  composer: null,
  playing: false,
  exploring: false,
  probe: null,
  cursor: { fx: 0.5, fy: 0.5 },
  f: null,
  prevF: null,
  markers: [],
  flashes: [],
  lastNarration: 0,
  lastCaption: 0,
  lastYear: null,
  mix: {},
  storyToken: 0,
  muted: false,
  imageSource: null,
};

// ---------------------------------------------------------------------------
// Settings (per-viewer convenience only; app works without storage)
// ---------------------------------------------------------------------------
const settings = { narrate: true, voice: false, rate: 1, contrast: false, large: false, motion: false, haptic: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem("ej-settings") || "{}")); } catch { /* storage unavailable */ }
if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && !("motion" in safeStored())) settings.motion = true;
function safeStored() { try { return JSON.parse(localStorage.getItem("ej-settings") || "{}"); } catch { return {}; } }
function saveSettings() { try { localStorage.setItem("ej-settings", JSON.stringify(settings)); } catch { /* ignore */ } }
function applySettings() {
  document.body.classList.toggle("hc", settings.contrast);
  document.body.classList.toggle("large", settings.large);
  $("opt-narrate").checked = settings.narrate;
  $("opt-voice").checked = settings.voice;
  $("opt-rate").value = settings.rate;
  $("opt-contrast").checked = settings.contrast;
  $("opt-large").checked = settings.large;
  $("opt-motion").checked = settings.motion;
  $("opt-haptic").checked = settings.haptic;
}
for (const [id, key] of [["opt-narrate", "narrate"], ["opt-voice", "voice"], ["opt-contrast", "contrast"], ["opt-large", "large"], ["opt-motion", "motion"], ["opt-haptic", "haptic"]]) {
  $(id).addEventListener("change", (e) => { settings[key] = e.target.checked; saveSettings(); applySettings(); });
}
$("opt-rate").addEventListener("input", (e) => { settings.rate = Number(e.target.value); saveSettings(); });
applySettings();

// ---------------------------------------------------------------------------
// Announcements & speech
// ---------------------------------------------------------------------------
function announce(text, assertive = false) {
  const el = assertive ? els.assertive : els.polite;
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 30);
}

function speak(text, { force = false } = {}) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || (!settings.voice && !force)) return resolve();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = settings.rate;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    u.onend = finish; u.onerror = finish;
    setTimeout(finish, 1500 + text.length * 90); // safety net if onend never fires
    synth.speak(u);
  });
}

function vibrate(pattern) {
  if (settings.haptic && navigator.vibrate) navigator.vibrate(pattern);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Track list
// ---------------------------------------------------------------------------
function renderTrackList() {
  els.list.innerHTML = "";
  for (const t of TRACKS) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "track-btn";
    b.dataset.id = t.id;
    b.setAttribute("aria-keyshortcuts", t.key);
    b.innerHTML = `<span class="num" aria-hidden="true">${t.key}</span><span class="t"><span class="swatch" style="background:${t.accent}" aria-hidden="true"></span>${t.title}</span><span class="s">${t.subtitle}</span>`;
    b.setAttribute("aria-label", `${t.title}: ${t.subtitle}`);
    b.addEventListener("click", () => selectTrack(t.id, { autoplay: state.playing }));
    li.append(b);
    els.list.append(li);
  }
}

function markCurrent() {
  for (const b of els.list.querySelectorAll(".track-btn")) {
    b.setAttribute("aria-current", b.dataset.id === state.track?.id ? "true" : "false");
  }
}

// ---------------------------------------------------------------------------
// Selecting a record
// ---------------------------------------------------------------------------
async function selectTrack(id, { autoplay = false, source = null } = {}) {
  stopPlayback();
  exitExplore();
  cancelStory();
  const track = id === "image" ? IMAGE_TRACK : trackById(id);
  state.track = track;
  state.f = null; state.prevF = null; state.flashes = []; state.lastYear = null;
  document.documentElement.style.setProperty("--accent", track.accent);
  els.title.textContent = track.title;
  els.sub.textContent = track.subtitle;
  els.summary.textContent = track.summary;
  els.caption.textContent = "Press Play to begin, or try the Guided story.";
  els.stage.style.aspectRatio = "";
  renderMapping(track);
  renderMixer(track);
  renderSource(track);
  markCurrent();
  try { history.replaceState(null, "", `#${track.id}`); } catch { /* file:// */ }

  if (track.id === "image") {
    const src = source || state.imageSource;
    state.imageSource = src;
    if (src?.kind === "image") {
      els.video.removeAttribute("src"); els.video.load(); els.video.hidden = true;
      els.still.src = src.url; els.still.hidden = false;
      await els.still.decode().catch(() => {});
      const ar = els.still.naturalWidth / els.still.naturalHeight || 1.5;
      els.stage.style.aspectRatio = String(ar);
      GRID.image = [128, Math.max(32, Math.round(128 / ar))];
      els.seek.disabled = true;
    } else if (src?.kind === "video") {
      els.still.hidden = true; els.video.hidden = false;
      await loadVideo(src.url, "");
      const ar = els.video.videoWidth / els.video.videoHeight || 1.6;
      els.stage.style.aspectRatio = String(ar);
      GRID.image = [128, Math.max(32, Math.round(128 / ar))];
      els.seek.disabled = false;
    }
  } else {
    els.still.hidden = true; els.video.hidden = false;
    els.seek.disabled = false;
    await loadVideo(`media/${track.id}/video.mp4`, `media/${track.id}/poster.jpg`);
  }
  const f0 = analyzeNow();
  updateTimeUI();
  els.readout.innerHTML = "";
  if (f0) renderReadout(f0, dateInfo());
  announce(`${track.title}. ${track.subtitle}. ${autoplay ? "" : "Press Space to play, or S for the guided story."}`);
  if (autoplay) play();
}

function loadVideo(src, poster) {
  return new Promise((resolve) => {
    const v = els.video;
    els.loading.hidden = false;
    v.poster = poster || "";
    v.src = src;
    v.playbackRate = Number(els.speed.value);
    const done = () => { els.loading.hidden = true; if (v.videoWidth) els.stage.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`; v.removeEventListener("loadeddata", done); v.removeEventListener("error", fail); resolve(); };
    const fail = () => {
      els.loading.hidden = true;
      els.caption.textContent = "This visualization could not be loaded. Run “python scripts/build_media.py” to fetch the NASA media, and open the app through a local web server (npm start).";
      resolve();
    };
    v.addEventListener("loadeddata", done);
    v.addEventListener("error", fail, { once: true });
    v.load();
  });
}

function renderMapping(track) {
  els.mapping.innerHTML = track.mapping.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
}

function renderSource(track) {
  const s = track.source;
  els.source.innerHTML = s.url
    ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a> (NASA SVS ${s.svs}). ${s.credit}${track.dateApprox ? " Dates shown are approximate (estimated from the video's position, not read from the frame)." : ""}`
    : s.credit;
}

function renderMixer(track) {
  const Comp = COMPOSERS[track.composer];
  const mix = (state.mix[track.id] ||= {});
  els.mixer.innerHTML = "";
  for (const L of Comp.LAYERS) {
    const m = (mix[L.id] ||= { muted: false, solo: false, level: 1 });
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="mix-head"><span class="mix-name" id="mx-${L.id}">${L.name}</span>
        <span class="mix-btns">
          <button data-act="mute" aria-pressed="${m.muted}" aria-label="Mute ${L.name}">Mute</button>
          <button data-act="solo" aria-pressed="${m.solo}" aria-label="Solo ${L.name}">Solo</button>
        </span></div>
      <p class="mix-desc">${L.desc}</p>
      <label class="sr-only" for="lv-${L.id}">${L.name} level</label>
      <input id="lv-${L.id}" type="range" min="0" max="1.5" step="0.01" value="${m.level}">`;
    li.querySelector('[data-act="mute"]').addEventListener("click", (e) => {
      m.muted = !m.muted; e.currentTarget.setAttribute("aria-pressed", m.muted); applyMix();
      announce(`${L.name} ${m.muted ? "muted" : "unmuted"}`);
    });
    li.querySelector('[data-act="solo"]').addEventListener("click", (e) => {
      m.solo = !m.solo; e.currentTarget.setAttribute("aria-pressed", m.solo); applyMix();
      announce(`${L.name} ${m.solo ? "solo on" : "solo off"}`);
    });
    li.querySelector("input").addEventListener("input", (e) => { m.level = Number(e.target.value); applyMix(); });
    els.mixer.append(li);
  }
}

function applyMix() {
  if (!engine.ctx || !state.track) return;
  const mix = state.mix[state.track.id] || {};
  for (const [id, m] of Object.entries(mix)) {
    engine.layer(id);
    engine.setLayer(id, { muted: m.muted, solo: m.solo, level: m.level });
  }
}

// ---------------------------------------------------------------------------
// Frame analysis
// ---------------------------------------------------------------------------
const acanvas = document.createElement("canvas");
const actx = acanvas.getContext("2d", { willReadFrequently: true });

function analyzeNow() {
  const t = state.track;
  if (!t || !state.analyzers) return null;
  const src = t.id === "image" && state.imageSource?.kind === "image" ? els.still : els.video;
  if (src === els.video && els.video.readyState < 2) return null;
  const [w, h] = GRID[t.id];
  if (acanvas.width !== w || acanvas.height !== h) { acanvas.width = w; acanvas.height = h; }
  try {
    actx.drawImage(src, 0, 0, w, h);
    const img = actx.getImageData(0, 0, w, h);
    const time = src === els.video ? els.video.currentTime : 0;
    const f = state.analyzers[t.analyzer](img, time, state.f);
    state.prevF = state.f;
    state.f = f;
    return f;
  } catch (e) {
    console.warn("analysis failed", e);
    return null;
  }
}

function dateInfo() {
  const t = state.track;
  const d = els.video.duration || 1;
  return t.date(els.video.currentTime || 0, d);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
async function play({ startStep = 0 } = {}) {
  if (!state.track) return;
  await engine.init();
  engine.setVolume(state.muted ? 0 : Number(els.volume.value));
  exitExplore();
  if (!state.composer) {
    const Comp = COMPOSERS[state.track.composer];
    state.composer = new Comp(engine, state.track.composerOpts || {});
    for (const L of Comp.LAYERS) engine.layer(L.id);
    applyMix();
    state.composer.start();
  }
  if (!els.video.hidden) await els.video.play().catch(() => {});
  state.playing = true;
  els.play.textContent = "Pause";
  els.play.setAttribute("aria-label", "Pause");
  const t = state.track;
  engine.startClock(t.bpm, t.stepsPerBeat, onStep, startStep);
  state.lastNarration = performance.now() - 9000; // first narration after ~6 s
}

function pause() {
  stopPlayback();
  els.caption.textContent = describe(state.track, state.f, dateInfo()) || "Paused.";
}

function stopPlayback() {
  engine.stopClock();
  if (state.composer) { state.composer.stop(); state.composer = null; }
  if (engine.ctx) engine.clearLayers();
  els.video.pause();
  state.playing = false;
  els.play.textContent = "Play";
  els.play.setAttribute("aria-label", "Play");
}

function togglePlay() { state.playing ? pause() : play(); }

function onStep(step, time, dur) {
  const f = analyzeNow() || state.f;
  if (!f || !state.composer) return;
  const scan = scanGrid(f, 16, 12);
  const info = dateInfo();
  state.composer.step(step, time, dur, f, scan, info);
  state.markers.push({ time, col: step % 16 });
  if (state.markers.length > 64) state.markers.splice(0, 32);

  if (f.events?.length) {
    const now = performance.now();
    for (const ev of f.events.slice(0, 12)) state.flashes.push({ x: (ev.x + 0.5) / f.w, y: (ev.y + 0.5) / f.h, born: now });
    if (f.events.length > 6) vibrate(15);
  }

  if (state.track.id === "nightlights" && info.year !== state.lastYear) {
    state.lastYear = info.year;
    announce(info.year === "change" ? "Now showing change between 2012 and 2023." : String(info.year));
  }

  const now = performance.now();
  if (now - state.lastCaption > 3000) {
    state.lastCaption = now;
    els.caption.textContent = describe(state.track, f, info);
    renderReadout(f, info);
  }
  if (settings.narrate && now - state.lastNarration > 15000) {
    state.lastNarration = now;
    const text = describe(state.track, f, info);
    announce(text);
    speak(text);
  }
}

function renderReadout(f, info) {
  els.readout.innerHTML = readout(state.track, f, info).map((r) => `<div><dt>${r.label}</dt><dd>${r.value}</dd></div>`).join("");
}

function updateTimeUI() {
  const v = els.video;
  if (!state.track) return;
  if (v.duration && !els.seek.disabled) {
    els.seek.max = v.duration.toFixed(1);
    els.seek.value = v.currentTime.toFixed(1);
  }
  const info = dateInfo();
  els.timeLabel.textContent = info.label;
  els.seek.setAttribute("aria-valuetext", info.label);
}

els.video.addEventListener("timeupdate", updateTimeUI);
els.seek.addEventListener("input", () => {
  els.video.currentTime = Number(els.seek.value);
});
els.video.addEventListener("seeked", () => {
  state.f = null;
  analyzeNow();
  if (state.exploring) updateProbe(false);
});
els.speed.addEventListener("change", () => { els.video.playbackRate = Number(els.speed.value); });
els.volume.addEventListener("input", () => { state.muted = false; engine.ctx && engine.setVolume(Number(els.volume.value)); });

function seekBy(sec) {
  const v = els.video;
  if (!v.duration) return;
  v.currentTime = Math.max(0, Math.min(v.duration - 0.05, v.currentTime + sec));
  announce(dateInfo().label);
}

// ---------------------------------------------------------------------------
// Guided story & audio legend
// ---------------------------------------------------------------------------
function cancelStory() {
  state.storyToken++;
  window.speechSynthesis?.cancel();
  els.story.setAttribute("aria-pressed", "false");
}

async function playLegend(token = ++state.storyToken) {
  await engine.init();
  engine.setVolume(state.muted ? 0 : Number(els.volume.value));
  for (const L of COMPOSERS[state.track.composer].LAYERS) engine.layer(L.id);
  applyMix();
  for (const item of state.track.legend) {
    if (token !== state.storyToken) return;
    els.caption.textContent = item.say;
    announce(item.say);
    await speak(item.say, { force: true });
    if (token !== state.storyToken) return;
    item.play(engine, engine.now + 0.05);
    await wait(2200);
  }
}

async function runStory() {
  if (els.story.getAttribute("aria-pressed") === "true") { cancelStory(); return; }
  const token = ++state.storyToken;
  stopPlayback();
  exitExplore();
  els.story.setAttribute("aria-pressed", "true");
  await engine.init();
  els.video.currentTime = 0;
  for (const line of state.track.story) {
    if (token !== state.storyToken) return;
    els.caption.textContent = line;
    if (!window.speechSynthesis) announce(line);
    await speak(line, { force: true });
    await wait(250);
  }
  if (token !== state.storyToken) return;
  const intro = "Here is the legend.";
  els.caption.textContent = intro;
  await speak(intro, { force: true });
  await playLegend(token);
  if (token !== state.storyToken) return;
  els.story.setAttribute("aria-pressed", "false");
  els.caption.textContent = "Now playing.";
  await play();
}

// ---------------------------------------------------------------------------
// Explore mode: a sound probe you move over the picture
// ---------------------------------------------------------------------------
async function enterExplore() {
  if (state.exploring) return;
  cancelStory();
  stopPlayback();
  await engine.init();
  engine.setVolume(state.muted ? 0 : Number(els.volume.value));
  analyzeNow();
  state.exploring = true;
  state.probe = new Probe(engine, engine.layer("probe"));
  engine.setLayer("probe", { muted: false, solo: false, level: 1 });
  els.explore.setAttribute("aria-pressed", "true");
  els.stage.classList.add("exploring");
  els.stage.tabIndex = 0;
  els.stage.setAttribute("role", "application");
  els.stage.setAttribute("aria-roledescription", "sound map");
  els.stage.setAttribute("aria-label", `Explore ${state.track.title}. Arrow keys move the probe, Enter speaks the value, Escape leaves.`);
  els.exploreHint.hidden = false;
  els.stage.focus();
  updateProbe(true);
}

function exitExplore() {
  if (!state.exploring) return;
  state.exploring = false;
  state.probe?.stop();
  state.probe = null;
  els.explore.setAttribute("aria-pressed", "false");
  els.stage.classList.remove("exploring");
  els.stage.removeAttribute("role");
  els.stage.removeAttribute("aria-roledescription");
  els.stage.removeAttribute("aria-label");
  els.stage.tabIndex = -1;
  els.exploreHint.hidden = true;
}

let probeDebounce = 0;
function updateProbe(announceIt) {
  const f = state.f;
  if (!f || !state.probe) return;
  const { fx, fy } = state.cursor;
  const s = sampleAt(f, fx, fy, state.track.analyzer === "aerosols" ? 1 : 2);
  const pan = fx * 2 - 1;
  if (!s) {
    state.probe.set({ midi: 36, level: 0.025, pan, timbre: 0 });
  } else if (state.track.analyzer === "aerosols") {
    const base = { dust: 45, blackCarbon: 52, seaSalt: 64, sulfate: 76 }[s.type] || 60;
    state.probe.set({ midi: base + Math.round(s.norm * 5), level: 0.17, pan, timbre: { dust: 0.9, blackCarbon: 0.6, seaSalt: 0.1, sulfate: 0.4 }[s.type] ?? 0.3 });
  } else if (state.track.analyzer === "lightning") {
    state.probe.set({ midi: 76, level: 0.12, pan, timbre: 0.5 });
    drum(engine, engine.layer("probe"), engine.now, { freq: 70, vel: 0.6, pan, decay: 0.4 });
  } else {
    const n = s.norm;
    state.probe.set({ midi: Math.round(45 + n * 33), level: 0.16, pan, timbre: 0.15 + n * 0.5 });
  }
  if (s && (s.norm > 0.88 || state.track.analyzer === "lightning")) vibrate(25);
  const text = probeText(state.track, s, fx, fy, f);
  els.caption.textContent = text.short;
  clearTimeout(probeDebounce);
  if (announceIt) announce(text.short);
  else probeDebounce = setTimeout(() => announce(text.short), 700);
}

function speakProbe() {
  const f = state.f;
  if (!f) return;
  const { fx, fy } = state.cursor;
  const s = sampleAt(f, fx, fy, state.track.analyzer === "aerosols" ? 1 : 2);
  const text = probeText(state.track, s, fx, fy, f);
  announce(text.spoken, true);
  speak(text.spoken);
}

function stagePoint(e) {
  const r = els.stage.getBoundingClientRect();
  state.cursor.fx = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width));
  state.cursor.fy = Math.min(0.999, Math.max(0, (e.clientY - r.top) / r.height));
}
els.stage.addEventListener("pointerdown", (e) => {
  if (!state.exploring) return;
  els.stage.setPointerCapture?.(e.pointerId);
  stagePoint(e); updateProbe(false);
});
els.stage.addEventListener("pointermove", (e) => {
  if (!state.exploring) return;
  if (e.pointerType !== "mouse" && e.buttons === 0) return;
  stagePoint(e); updateProbe(false);
});
els.stage.addEventListener("dblclick", () => state.exploring && speakProbe());
els.stage.style.touchAction = "none";

// ---------------------------------------------------------------------------
// Overlay & oscilloscope drawing
// ---------------------------------------------------------------------------
const octx = els.overlay.getContext("2d");
const sctx = els.scope.getContext("2d");
let scopeData = null;

function draw() {
  requestAnimationFrame(draw);
  const c = els.overlay;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  octx.clearRect(0, 0, W, H);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ffb347";

  if (state.playing && engine.ctx && !settings.motion) {
    const now = engine.now;
    let col = -1;
    for (const m of state.markers) if (m.time <= now) col = m.col;
    if (col >= 0) {
      const x = (col / 16) * W, w = W / 16;
      const g = octx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(255,255,255,0.16)");
      octx.fillStyle = g;
      octx.fillRect(x, 0, w, H);
      octx.fillStyle = accent;
      octx.fillRect(x + w - 2 * dpr, 0, 2 * dpr, H);
    }
  }
  if (state.flashes.length && !settings.motion) {
    const now = performance.now();
    state.flashes = state.flashes.filter((fl) => now - fl.born < 700);
    for (const fl of state.flashes) {
      const a = 1 - (now - fl.born) / 700;
      octx.strokeStyle = `rgba(255,230,120,${a})`;
      octx.lineWidth = 2 * dpr;
      octx.beginPath();
      octx.arc(fl.x * W, fl.y * H, (6 + (1 - a) * 18) * dpr, 0, Math.PI * 2);
      octx.stroke();
    }
  }
  if (state.exploring) {
    const x = state.cursor.fx * W, y = state.cursor.fy * H;
    octx.strokeStyle = "#66d1ff";
    octx.lineWidth = 2 * dpr;
    octx.beginPath();
    octx.moveTo(x, 0); octx.lineTo(x, H); octx.moveTo(0, y); octx.lineTo(W, y);
    octx.globalAlpha = 0.45; octx.stroke(); octx.globalAlpha = 1;
    octx.beginPath(); octx.arc(x, y, 12 * dpr, 0, Math.PI * 2); octx.stroke();
  }

  // Oscilloscope
  const s = els.scope;
  const SW = Math.round(s.clientWidth * dpr), SH = Math.round(s.clientHeight * dpr);
  if (s.width !== SW || s.height !== SH) { s.width = SW; s.height = SH; }
  sctx.clearRect(0, 0, SW, SH);
  if (engine.analyser) {
    scopeData ||= new Uint8Array(engine.analyser.fftSize);
    engine.analyser.getByteTimeDomainData(scopeData);
    sctx.strokeStyle = accent;
    sctx.lineWidth = 1.5 * dpr;
    sctx.beginPath();
    for (let i = 0; i < scopeData.length; i++) {
      const x = (i / (scopeData.length - 1)) * SW;
      const y = (scopeData[i] / 255) * SH;
      i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
    sctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
async function toggleRecord() {
  await engine.init();
  if (els.record.getAttribute("aria-pressed") === "true") {
    const blob = await engine.stopRecording();
    els.record.setAttribute("aria-pressed", "false");
    els.record.innerHTML = '<span aria-hidden="true">●</span> Record';
    if (blob) {
      const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      els.download.href = URL.createObjectURL(blob);
      els.download.download = `earth-jukebox-${state.track.id}.${ext}`;
      els.download.textContent = `Download “${state.track.title}” (${(blob.size / 1e6).toFixed(1)} MB)`;
      els.download.hidden = false;
      announce("Recording stopped. A download link is ready after the Record button.", true);
    }
  } else {
    try {
      engine.startRecording();
      els.record.setAttribute("aria-pressed", "true");
      els.record.innerHTML = '<span aria-hidden="true">■</span> Stop recording';
      announce("Recording the soundtrack.", true);
      if (!state.playing) play();
    } catch (e) {
      announce(e.message, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Upload your own frame
// ---------------------------------------------------------------------------
els.file.addEventListener("change", () => {
  const file = els.file.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const kind = file.type.startsWith("video") ? "video" : "image";
  selectTrack("image", { source: { kind, url }, autoplay: true });
});

// ---------------------------------------------------------------------------
// Buttons, dialogs, keyboard
// ---------------------------------------------------------------------------
els.play.addEventListener("click", togglePlay);
els.restart.addEventListener("click", () => { els.video.currentTime = 0; announce("Back to the start."); });
els.story.addEventListener("click", runStory);
els.legend.addEventListener("click", () => { cancelStory(); playLegend(); });
els.explore.addEventListener("click", () => (state.exploring ? exitExplore() : enterExplore()));
els.describe.addEventListener("click", describeNow);
els.record.addEventListener("click", toggleRecord);
$("btn-help").addEventListener("click", () => $("dlg-help").showModal());
$("btn-a11y").addEventListener("click", () => $("dlg-settings").showModal());
$("btn-about").addEventListener("click", () => $("dlg-about").showModal());

function describeNow() {
  const f = state.f || analyzeNow();
  const text = describe(state.track, f, dateInfo()) || "Nothing to describe yet.";
  els.caption.textContent = text;
  announce(text, true);
  speak(text);
}

function toggleMute() {
  state.muted = !state.muted;
  if (engine.ctx) engine.setVolume(state.muted ? 0 : Number(els.volume.value));
  announce(state.muted ? "Muted" : "Unmuted", true);
}

document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  if (els.main.hidden) return;
  const tag = e.target.tagName;
  const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (state.exploring) {
    const step = e.shiftKey ? 0.1 : 0.025;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step * 2], ArrowDown: [0, step * 2] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      state.cursor.fx = (state.cursor.fx + dx + 1) % 1;
      state.cursor.fy = Math.min(0.999, Math.max(0, state.cursor.fy + dy));
      updateProbe(true);
      return;
    }
    if (e.key === "Enter" || (e.key === " " && e.target === els.stage)) { e.preventDefault(); speakProbe(); return; }
    if (e.key === "Escape") { e.preventDefault(); exitExplore(); els.explore.focus(); announce("Left explore mode."); return; }
  }
  if (typing) return;
  const onButton = tag === "BUTTON" || tag === "A";
  const k = e.key.toLowerCase();
  if ((e.key === " " && !onButton) || k === "k") { e.preventDefault(); togglePlay(); return; }
  if (e.key === "?" || (k === "/" && e.shiftKey)) { e.preventDefault(); $("dlg-help").showModal(); return; }
  if (e.key === "ArrowLeft" && !state.exploring) { e.preventDefault(); seekBy(-5); return; }
  if (e.key === "ArrowRight" && !state.exploring) { e.preventDefault(); seekBy(5); return; }
  if (e.key === "Escape") { cancelStory(); return; }
  const t = TRACKS.find((x) => x.key === e.key);
  if (t) { e.preventDefault(); selectTrack(t.id, { autoplay: state.playing }); return; }
  switch (k) {
    case "s": e.preventDefault(); runStory(); break;
    case "l": e.preventDefault(); cancelStory(); playLegend(); break;
    case "e": e.preventDefault(); state.exploring ? exitExplore() : enterExplore(); break;
    case "d": e.preventDefault(); describeNow(); break;
    case "r": e.preventDefault(); toggleRecord(); break;
    case "m": e.preventDefault(); toggleMute(); break;
    case "n":
      e.preventDefault();
      settings.narrate = !settings.narrate; saveSettings(); applySettings();
      announce(`Automatic narration ${settings.narrate ? "on" : "off"}`, true);
      break;
  }
});

// ---------------------------------------------------------------------------
// Demo mode (?demo): a scripted 30-second showcase for the submission video.
// Optional: ?demo&team=Your%20Team&url=github.com/you/earth-jukebox
// ---------------------------------------------------------------------------
const DEMO = new URLSearchParams(location.search).has("demo");

async function runDemo() {
  const params = new URLSearchParams(location.search);
  document.body.classList.add("demo");
  const sub = document.createElement("div");
  sub.className = "demo-sub";
  const shade = document.createElement("div");
  shade.className = "demo-shade";
  els.stage.append(shade, sub);
  const t0 = performance.now();
  const at = (sec) => wait(Math.max(0, t0 + sec * 1000 - performance.now()));
  const say = (text) => { sub.textContent = text; sub.classList.remove("show"); void sub.offsetWidth; sub.classList.add("show"); };
  const seekTo = (sec) => new Promise((r) => { els.video.addEventListener("seeked", r, { once: true }); els.video.currentTime = sec; });

  // Warm the browser cache for the montage so its cuts switch instantly.
  const MONTAGE = [["aerosols", 8], ["co2", 2], ["nightlights", 28], ["gedi", 20]];
  for (const [id] of MONTAGE) fetch(`media/${id}/video.mp4`).catch(() => {});

  // 0–4 s: black screen, lightning audio only
  await selectTrack("lightning");
  await seekTo(61);
  shade.classList.add("on");
  say("Close your eyes. This is lightning, heard from space.");
  await play({ startStep: 4 });

  // 4–9 s: reveal
  await at(4);
  shade.classList.remove("on");
  say("Earth Jukebox turns NASA Earth visualizations into live music — played from their pixels.");

  // 9–15 s: ocean temperature, data → pitch
  await at(9);
  await selectTrack("sst");
  await seekTo(20);
  await play({ startStep: 4 });
  say("Each map's own colour bar turns colours back into data: warmer water, higher notes.");

  // 15–21 s: explore by touch
  await at(15);
  say("Blind and low-vision users can explore any map by touch or keyboard.");
  await enterExplore();
  const path = [[0.08, 0.5], [0.3, 0.48], [0.55, 0.47], [0.78, 0.45], [0.9, 0.46]];
  for (let i = 0; i < 34; i++) {
    const p = (i / 33) * (path.length - 1), k = Math.min(path.length - 2, Math.floor(p)), u = p - k;
    state.cursor.fx = path[k][0] + (path[k + 1][0] - path[k][0]) * u;
    state.cursor.fy = path[k][1] + (path[k + 1][1] - path[k][1]) * u;
    updateProbe(false);
    await wait(95);
  }
  const s = sampleAt(state.f, state.cursor.fx, state.cursor.fy, 2);
  const txt = probeText(state.track, s, state.cursor.fx, state.cursor.fy, state.f);
  els.caption.textContent = txt.short;
  speak(txt.spoken.split(",").slice(0, 2).join(","), { force: true });

  // 21–28 s: montage — four records, each held ~1.75 s with sound from the first beat.
  await at(21);
  exitExplore();
  window.speechSynthesis?.cancel();
  say("Seven NASA datasets. One planet. Listen.");
  for (let i = 0; i < MONTAGE.length; i++) {
    const [id, sec] = MONTAGE[i];
    await selectTrack(id);
    await seekTo(sec);
    // Start the scanner over the Americas/Atlantic, where every record has data.
    await play({ startStep: 5 });
    await at(21 + (i + 1) * 1.75);
  }

  // 28–30 s: end card
  await at(28);
  stopPlayback();
  const end = document.createElement("div");
  end.className = "demo-end";
  end.innerHTML = `<h2>Earth Jukebox</h2><p>Hear our changing planet.</p>` +
    (params.get("team") ? `<p class="team">${params.get("team").replace(/[<>&]/g, "")}</p>` : "") +
    (params.get("url") ? `<p class="url">${params.get("url").replace(/[<>&]/g, "")}</p>` : "") +
    `<p class="credit">Data: NASA Scientific Visualization Studio · NASA Space Apps 2026</p>`;
  els.stage.append(end);
  sub.textContent = "";
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  if (DEMO) els.start.textContent = "Start 30-second demo";
  renderTrackList();
  const colormaps = await fetch("media/colormaps.json").then((r) => {
    if (!r.ok) throw new Error("media/colormaps.json missing — run python scripts/build_media.py");
    return r.json();
  });
  state.analyzers = makeAnalyzers(colormaps);
  const fromHash = location.hash.slice(1);
  await selectTrack(trackById(fromHash) && fromHash !== "image" ? fromHash : "sst");
  requestAnimationFrame(draw);
}

els.start.addEventListener("click", async () => {
  await engine.init();
  els.gate.hidden = true;
  els.main.hidden = false;
  if (DEMO) { runDemo(); return; }
  els.play.focus();
  announce(`Earth Jukebox ready. ${state.track?.title || ""}. Press Space to play, S for a guided story, or question mark for shortcuts.`);
});

// Read-only handle for automated browser tests and curious developers.
window.__earthJukebox = { engine, state };

boot().catch((e) => {
  console.error(e);
  els.caption.textContent = e.message;
  document.querySelector(".gate-inner").insertAdjacentHTML("beforeend", `<p role="alert">${e.message}</p>`);
});
