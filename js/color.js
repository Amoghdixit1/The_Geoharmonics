// Colour utilities and colormap inversion.
// Pure functions only (no DOM) so they run in Node tests and in the browser.

export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

export function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Turns a pixel colour back into the physical value the legend says it means.
 *
 * The legend (colorbar) gradient is sampled into `colors` (low -> high). A
 * 32x32x32 lookup cube is precomputed so inverting a pixel is a single array
 * read, fast enough to run on every analysed video frame.
 *
 * metric:
 *  - "rgb":  plain Euclidean RGB distance. For flat, unshaded colour fields.
 *  - "norm": colours are scaled so their brightest channel is 1 before
 *            comparing. Shading (darker flow lines, 3D lighting) changes
 *            brightness but not chroma, so this stays accurate on shaded
 *            renders such as particle flows or the GEDI 3D globe.
 */
export class ColormapInverter {
  constructor({ colors, v0, v1, unit }, { metric = "rgb", maxDist = Infinity } = {}) {
    this.colors = colors;
    this.v0 = v0;
    this.v1 = v1;
    this.unit = unit;
    this.metric = metric;
    this.maxDist = maxDist;
    const n = colors.length;
    const ref = colors.map((c) => this._prep(c[0], c[1], c[2]));
    this.lutT = new Float32Array(32768);
    this.lutD = new Float32Array(32768);
    for (let ri = 0; ri < 32; ri++) {
      for (let gi = 0; gi < 32; gi++) {
        for (let bi = 0; bi < 32; bi++) {
          const p = this._prep(ri * 8 + 4, gi * 8 + 4, bi * 8 + 4);
          let best = Infinity, bestK = 0;
          for (let k = 0; k < n; k++) {
            const q = ref[k];
            const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2;
            if (d < best) { best = d; bestK = k; }
          }
          const idx = (ri << 10) | (gi << 5) | bi;
          this.lutT[idx] = bestK / (n - 1);
          this.lutD[idx] = Math.sqrt(best);
        }
      }
    }
  }

  _prep(r, g, b) {
    if (this.metric === "norm" || this.metric === "hybrid") {
      const m = Math.max(r, g, b, 1);
      // "hybrid": chroma plus a lightness term, for legends (like GEDI's
      // brown -> green -> cream) whose stops differ mainly in brightness.
      return [r / m, g / m, b / m, this.metric === "hybrid" ? (1.5 * m) / 255 : 0];
    }
    return [r / 255, g / 255, b / 255, 0];
  }

  /** Returns position along the colorbar 0..1, or -1 if the colour is not on it. */
  invertT(r, g, b) {
    const idx = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    return this.lutD[idx] <= this.maxDist ? this.lutT[idx] : -1;
  }

  toValue(t) {
    return this.v0 + t * (this.v1 - this.v0);
  }

  /** Colour of the legend at position t (0..1) — used for the audio legend UI. */
  colorAt(t) {
    const i = Math.max(0, Math.min(this.colors.length - 1, Math.round(t * (this.colors.length - 1))));
    return this.colors[i];
  }
}
