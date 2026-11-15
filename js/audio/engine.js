// Web Audio engine: master bus, reverb, limiter, mixer layers, look-ahead
// clock, voice budget and recording. Everything is synthesised live — no
// samples — so the sound is generated in real time from the analysed frames.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.layers = new Map();
    this.activeVoices = 0;
    this.maxVoices = 28;
    this._clock = null;
    this.onStep = null;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: "interactive" });
    this.ctx = ctx;

    this.input = ctx.createGain();
    this.bus = ctx.createGain();
    this.input.connect(this.bus);

    // Reverb: synthetic impulse response (decaying stereo noise), ~3 s tail.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.input.connect(this.reverbSend).connect(this.reverb).connect(this.bus);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.bus.connect(comp).connect(limiter).connect(this.master).connect(ctx.destination);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.analyser);
    this.recordDest = ctx.createMediaStreamDestination();
    this.master.connect(this.recordDest);

    this.noise = this._noiseBuffer(2);
    if (ctx.state === "suspended") await ctx.resume();
  }

  get now() { return this.ctx.currentTime; }

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.05);
  }

  // ---- mixer layers -------------------------------------------------------
  layer(id) {
    if (!this.layers.has(id)) {
      const g = this.ctx.createGain();
      g.connect(this.input);
      this.layers.set(id, { node: g, level: 1, muted: false, solo: false });
    }
    return this.layers.get(id).node;
  }

  clearLayers() {
    for (const l of this.layers.values()) {
      const n = l.node;
      n.gain.setTargetAtTime(0, this.now, 0.15);
      setTimeout(() => n.disconnect(), 1200);
    }
    this.layers.clear();
  }

  setLayer(id, patch) {
    const l = this.layers.get(id);
    if (!l) return;
    Object.assign(l, patch);
    this._applyMix();
  }

  _applyMix() {
    const anySolo = [...this.layers.values()].some((l) => l.solo);
    for (const l of this.layers.values()) {
      const on = anySolo ? l.solo : !l.muted;
      l.node.gain.setTargetAtTime(on ? l.level : 0, this.now, 0.05);
    }
  }

  // ---- voice budget: keeps dense data from turning into noise ---------------
  claimVoice(seconds) {
    if (this.activeVoices >= this.maxVoices) return false;
    this.activeVoices++;
    setTimeout(() => { this.activeVoices--; }, Math.max(50, seconds * 1000));
    return true;
  }

  // ---- look-ahead clock ---------------------------------------------------
  startClock(bpm, stepsPerBeat, onStep) {
    this.stopClock();
    const stepDur = 60 / bpm / stepsPerBeat;
    let next = this.now + 0.08;
    let step = 0;
    const tick = () => {
      while (next < this.now + 0.14) {
        try { onStep(step, next, stepDur); } catch (e) { console.error(e); }
        step++;
        next += stepDur;
      }
    };
    tick();
    this._clock = setInterval(tick, 25);
    this.stepDur = stepDur;
  }

  stopClock() {
    if (this._clock) clearInterval(this._clock);
    this._clock = null;
  }

  // ---- recording ----------------------------------------------------------
  startRecording() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error("Recording is not supported in this browser.");
    this._chunks = [];
    this._rec = new MediaRecorder(this.recordDest.stream, { mimeType });
    this._rec.ondataavailable = (e) => e.data.size && this._chunks.push(e.data);
    this._rec.start(500);
    return mimeType;
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this._rec) return resolve(null);
      this._rec.onstop = () => {
        resolve(new Blob(this._chunks, { type: this._rec.mimeType }));
        this._rec = null;
      };
      this._rec.stop();
    });
  }

  // ---- helpers ------------------------------------------------------------
  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < rate * 0.01 ? i / (rate * 0.01) : 1);
      }
    }
    return buf;
  }
}
