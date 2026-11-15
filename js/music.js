// Musical rules that keep data-driven audio pleasant: every pitch is snapped
// to a scale, so any data value lands on a note that fits the harmony.

export const SCALES = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Map t (0..1) onto a scale spanning `octaves` above `root` (MIDI note).
 * Monotonic: a higher data value never produces a lower note.
 */
export function quantize(t, root, scale, octaves = 2) {
  const steps = scale.length * octaves;
  const k = Math.max(0, Math.min(steps, Math.round(Math.max(0, Math.min(1, t)) * steps)));
  const oct = Math.floor(k / scale.length);
  const deg = k % scale.length;
  return root + oct * 12 + scale[deg];
}

/** Chord tones (MIDI) built in thirds on `degree` of a scale. */
export function chord(root, scale, degree = 0, size = 3) {
  const out = [];
  for (let i = 0; i < size; i++) {
    const d = degree + i * 2;
    out.push(root + 12 * Math.floor(d / scale.length) + scale[d % scale.length]);
  }
  return out;
}

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const lerp = (a, b, t) => a + (b - a) * t;
