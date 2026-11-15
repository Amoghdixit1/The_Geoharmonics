// Earth Jukebox — Code written with Claude (Anthropic) as an AI coding assistant, under our direction. See AI_DISCLOSURE.md.
// Geography helpers: equirectangular pixel <-> lat/lon and coarse place names.
// Region boxes are deliberately approximate; descriptions say "near" for that reason.

export function cellToLatLon(x, y, w, h) {
  return {
    lat: 90 - ((y + 0.5) / h) * 180,
    lon: -180 + ((x + 0.5) / w) * 360,
  };
}

export function latLonToCell(lat, lon, w, h) {
  return {
    x: Math.min(w - 1, Math.max(0, Math.floor(((lon + 180) / 360) * w))),
    y: Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h))),
  };
}

export function formatLatLon(lat, lon) {
  const la = `${Math.abs(Math.round(lat))}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(Math.round(lon))}°${lon >= 0 ? "E" : "W"}`;
  return `${la} ${lo}`;
}

/** Spoken form, e.g. "35 degrees north, 40 degrees west". */
export function speakLatLon(lat, lon) {
  const la = Math.abs(Math.round(lat));
  const lo = Math.abs(Math.round(lon));
  return `${la} degrees ${lat >= 0 ? "north" : "south"}, ${lo} degrees ${lon >= 0 ? "east" : "west"}`;
}

// [name, kind, latMin, latMax, lonMin, lonMax]  — first (smallest) match wins.
const REGIONS = [
  ["the Gulf of Mexico", "ocean", 18, 31, -98, -81],
  ["the Caribbean Sea", "ocean", 9, 22, -88, -60],
  ["the Mediterranean Sea", "ocean", 30, 46, -6, 36],
  ["the Red Sea", "ocean", 12, 30, 32, 44],
  ["the Persian Gulf", "ocean", 23, 31, 47, 57],
  ["the Bay of Bengal", "ocean", 5, 23, 80, 95],
  ["the Arabian Sea", "ocean", 5, 25, 55, 75],
  ["the South China Sea", "ocean", 0, 23, 105, 121],
  ["the Gulf Stream", "ocean", 30, 45, -80, -50],
  ["the Kuroshio Current", "ocean", 25, 42, 122, 150],
  ["the Agulhas Current", "ocean", -42, -25, 15, 35],
  ["the Western Pacific Warm Pool", "ocean", -10, 10, 120, 160],
  ["the eastern equatorial Pacific", "ocean", -8, 8, -130, -80],
  ["the Arctic Ocean", "ocean", 66, 90, -180, 180],
  ["the Southern Ocean", "ocean", -90, -55, -180, 180],
  ["the North Atlantic Ocean", "ocean", 0, 66, -80, -5],
  ["the South Atlantic Ocean", "ocean", -55, 0, -70, 20],
  ["the Indian Ocean", "ocean", -55, 25, 20, 120],
  ["the North Pacific Ocean", "ocean", 0, 66, 120, 180],
  ["the North Pacific Ocean", "ocean", 0, 66, -180, -80],
  ["the South Pacific Ocean", "ocean", -55, 0, 120, 180],
  ["the South Pacific Ocean", "ocean", -55, 0, -180, -70],

  ["Florida", "land", 25, 31, -87, -80],
  ["Ukraine", "land", 45, 52.5, 22, 40],
  ["Japan", "land", 30, 46, 129, 146],
  ["Madagascar", "land", -26, -12, 43, 51],
  ["Greenland", "land", 59, 84, -74, -11],
  ["Alaska", "land", 51, 72, -170, -130],
  ["the Congo Basin", "land", -10, 6, 12, 32],
  ["West Africa", "land", 4, 18, -18, 12],
  ["East Africa", "land", -12, 18, 32, 52],
  ["Southern Africa", "land", -35, -10, 10, 41],
  ["the Sahara", "land", 15, 35, -17, 32],
  ["the Arabian Peninsula", "land", 12, 32, 34, 60],
  ["India and South Asia", "land", 6, 35, 66, 92],
  ["Southeast Asia", "land", 5, 28, 92, 110],
  ["the Maritime Continent (Indonesia)", "land", -11, 7, 95, 141],
  ["Australia", "land", -44, -10, 112, 155],
  ["China and East Asia", "land", 18, 54, 92, 135],
  ["Central Asia", "land", 35, 55, 46, 92],
  ["Siberia and northern Russia", "land", 50, 78, 40, 180],
  ["Europe", "land", 36, 71, -11, 45],
  ["the Middle East", "land", 28, 42, 34, 63],
  ["Mexico and Central America", "land", 7, 32, -118, -77],
  ["the Amazon Basin", "land", -15, 5, -75, -45],
  ["northern South America", "land", -5, 13, -82, -34],
  ["southern South America", "land", -56, -15, -76, -34],
  ["the United States", "land", 24, 50, -125, -66],
  ["Canada", "land", 42, 84, -141, -52],
  ["Antarctica", "land", -90, -60, -180, 180],
];

/**
 * Coarse name for a location. `kind` ("ocean" | "land" | undefined) lets a
 * caller that knows the surface type from the imagery pick the right list.
 */
export function placeName(lat, lon, kind) {
  for (const [name, k, a, b, c, d] of REGIONS) {
    if (kind && k !== kind) continue;
    if (lat >= a && lat <= b && lon >= c && lon <= d) return name;
  }
  if (kind) return placeName(lat, lon);
  return lat >= 0 ? "the Northern Hemisphere" : "the Southern Hemisphere";
}

/** For globe views (no reliable lat/lon), describe screen position instead. */
export function screenPlace(fx, fy) {
  const v = fy < 0.33 ? "upper" : fy > 0.66 ? "lower" : "middle";
  const h = fx < 0.33 ? "left" : fx > 0.66 ? "right" : "centre";
  if (v === "middle" && h === "centre") return "the centre of the view";
  return `the ${v} ${h} of the view`;
}
