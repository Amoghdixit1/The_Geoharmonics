// Earth Jukebox — Code written with Claude (Anthropic) as an AI coding assistant, under our direction. See AI_DISCLOSURE.md.
// Natural-language descriptions generated from analysed frames.
// Used for the live caption, screen-reader announcements and spoken narration.
// Everything stated here is computed from the pixels of the current frame.

import { placeName, speakLatLon, screenPlace, formatLatLon } from "./geo.js";
import { AEROSOL_TYPES } from "./analysis.js";

const r1 = (x) => Math.round(x * 10) / 10;
const pct = (x) => (x > 0 && x < 0.005 ? "under 1%" : `${Math.round(x * 100)}%`);
const NICE = { blackCarbon: "smoke and black carbon", dust: "dust", seaSalt: "sea salt", sulfate: "sulfate" };

export function describe(track, f, info) {
  if (!f) return "";
  const s = f.stats;
  const when = info?.spoken ? `${info.spoken[0].toUpperCase()}${info.spoken.slice(1)}: ` : "";
  switch (track.analyzer) {
    case "sst": {
      if (!s.maxAt) return `${when}no ocean detected in this frame.`;
      return `${when}warmest water about ${r1(s.max)} °C near ${placeName(s.maxAt.lat, s.maxAt.lon, "ocean")}; ` +
        `coldest about ${r1(s.min)} °C near ${placeName(s.minAt.lat, s.minAt.lon, "ocean")}. ` +
        `Average across visible ocean ${r1(s.mean)} °C.`;
    }
    case "ocean2":
    case "gedi": {
      if (!s.maxAt) return `${when}nothing measurable in view.`;
      const what = track.analyzer === "gedi" ? "tallest canopy" : "warmest water";
      const avg = track.analyzer === "gedi" ? "average visible canopy" : "average visible water";
      return `${when}${what} about ${Math.round(s.max)} ${track.unit} in ${screenPlace(s.maxAt.fx, s.maxAt.fy)}; ` +
        `${avg} ${Math.round(s.mean)} ${track.unit}; ${pct(s.coverage)} of the view has data.`;
    }
    case "lightning": {
      if (!s.count) return `${when}very little lightning on the map right now.`;
      const busy = s.busiest ? placeName(s.busiest.lat, s.busiest.lon, "land") : "the tropics";
      const hemi = s.northShare >= 0.5 ? `${pct(s.northShare)} in the Northern Hemisphere` : `${pct(1 - s.northShare)} in the Southern Hemisphere`;
      return `${when}${s.count > 300 ? "lots of" : s.count > 100 ? "moderate" : "light"} lightning activity, busiest near ${busy}; ${hemi}.`;
    }
    case "aerosols": {
      const parts = Object.entries(s.types)
        .filter(([, v]) => v.coverage > 0.003)
        .sort((a, b) => b[1].coverage - a[1].coverage)
        .map(([k, v]) => `${NICE[k]} over ${pct(v.coverage)} of the map${v.centroid ? `, centred near ${placeName(v.centroid.lat, v.centroid.lon)}` : ""}`);
      return parts.length ? `${when}${parts.join("; ")}.` : `${when}clear air on most of the map.`;
    }
    case "co2": {
      if (!s.maxAt) return `${when}no strong CO₂ plumes visible.`;
      return `${when}strongest plume about ${Math.round(s.max)} ppm near ${placeName(s.maxAt.lat, s.maxAt.lon)}. ` +
        `High-CO₂ plumes cover ${pct(s.coverage)} of the map` +
        (s.plumeCentroid ? `, centred near ${placeName(s.plumeCentroid.lat, s.plumeCentroid.lon)}.` : ".");
    }
    case "nightlights": {
      if (f.mode === "series") {
        return `${when}lit areas cover ${pct(s.litFraction)} of the map` +
          (s.centroid ? `, with the centre of brightness near ${placeName(s.centroid.lat, s.centroid.lon)}.` : ".");
      }
      const g = s.gainCentroid ? ` New light is concentrated near ${placeName(s.gainCentroid.lat, s.gainCentroid.lon, "land")}.` : "";
      const l = s.lossCentroid ? ` Lost light is concentrated near ${placeName(s.lossCentroid.lat, s.lossCentroid.lon, "land")}.` : "";
      const net = s.balance >= 0 ? "more light gained than lost" : "more light lost than gained";
      return `Change from 2012 to 2023: ${net} overall.${g}${l}`;
    }
    case "image":
      return `Your image: average brightness ${pct(s.mean || 0)}.`;
    default:
      return "";
  }
}

/** Short stat cards for the visible readout panel. */
export function readout(track, f, info) {
  if (!f) return [];
  const s = f.stats;
  const out = [{ label: "Time", value: info?.label || "" }];
  switch (track.analyzer) {
    case "sst": case "ocean2":
      if (s.coverage) out.push({ label: "Warmest", value: `${r1(s.max)} °C` }, { label: "Average", value: `${r1(s.mean)} °C` }, { label: "Coldest", value: `${r1(s.min)} °C` });
      break;
    case "gedi":
      if (s.coverage) out.push({ label: "Tallest", value: `${Math.round(s.max)} m` }, { label: "Average", value: `${Math.round(s.mean)} m` }, { label: "Forest in view", value: pct(s.coverage) });
      break;
    case "lightning":
      out.push({ label: "Lit cells", value: String(s.count) }, { label: "New flashes", value: String(s.newFlashes) }, { label: "North share", value: pct(s.northShare) });
      break;
    case "aerosols":
      for (const k of AEROSOL_TYPES.slice(1)) out.push({ label: NICE[k].replace(" and black carbon", ""), value: pct(s.types[k].coverage) });
      break;
    case "co2":
      out.push({ label: "Peak", value: s.coverage ? `${Math.round(s.max)} ppm` : "–" }, { label: "Plume cover", value: pct(s.coverage) });
      break;
    case "nightlights":
      if (f.mode === "series") out.push({ label: "Lit area", value: pct(s.litFraction) });
      else out.push({ label: "Gained", value: pct(s.gainFraction) }, { label: "Lost", value: pct(s.lossFraction) }, { label: "Balance", value: s.balance >= 0 ? "net gain" : "net loss" });
      break;
    case "image":
      out.push({ label: "Brightness", value: pct(s.mean || 0) });
      break;
  }
  out.push({ label: "Motion", value: pct(f.motion) });
  return out;
}

/** What the Explore probe says about one point. */
export function probeText(track, sample, fx, fy, f) {
  const geo = track.projection === "equirect";
  const lat = 90 - fy * 180, lon = -180 + fx * 360;
  const where = geo ? `near ${placeName(lat, lon)}, ${speakLatLon(lat, lon)}` : `in ${screenPlace(fx, fy)}`;
  const whereShort = geo ? `${placeName(lat, lon)} (${formatLatLon(lat, lon)})` : screenPlace(fx, fy);
  let what;
  if (!sample) {
    what = {
      sst: "land or no data", ocean2: "no measurable water", gedi: "no forest data", lightning: "no lightning here",
      aerosols: "clear air", co2: "no strong CO₂ plume", nightlights: f?.mode === "series" ? "dark" : "no change", image: "dark",
    }[track.analyzer];
  } else {
    switch (track.analyzer) {
      case "sst": case "ocean2": what = `${r1(sample.value)} degrees Celsius`; break;
      case "gedi": what = `canopy about ${Math.round(sample.value)} metres`; break;
      case "lightning": what = "lightning here"; break;
      case "aerosols": what = `${NICE[sample.type] || "aerosol"}, ${sample.norm > 0.7 ? "dense" : sample.norm > 0.45 ? "moderate" : "thin"}`; break;
      case "co2": what = `about ${Math.round(sample.value)} parts per million`; break;
      case "nightlights":
        what = f?.mode === "series"
          ? `${sample.norm > 0.6 ? "very bright" : sample.norm > 0.3 ? "bright" : "dim"} lights`
          : sample.value > 0 ? "new lights since 2012" : "lights out since 2012";
        break;
      default: what = `brightness ${pct(sample.norm)}`;
    }
  }
  return { spoken: `${what}, ${where}.`, short: `${what} · ${whereShort}` };
}
