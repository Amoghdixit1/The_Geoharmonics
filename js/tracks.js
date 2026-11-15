// The "records" in the jukebox. Facts here come from the NASA SVS pages cited
// in `source`; dates are mapped linearly onto video time unless noted.

import { pluck, bell, drum, grain } from "./audio/voices.js";
import { quantize, SCALES } from "./music.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function linearDate(start, end) {
  const a = Date.parse(start), b = Date.parse(end);
  return (t, duration) => {
    const d = new Date(a + (b - a) * Math.max(0, Math.min(1, t / duration)));
    const label = `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    return { label, spoken: `about ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`, date: d };
  };
}

/**
 * Piecewise-linear date mapping through [videoSeconds, isoDate] anchors.
 * Used where the video's pace is uneven and the dates were calibrated from
 * the data itself (see Storm Drums).
 */
function anchoredDate(anchors) {
  const pts = anchors.map(([s, iso]) => [s, Date.parse(iso)]);
  return (t) => {
    if (t < pts[0][0]) return { label: "Before data", spoken: "the opening seconds, before the data starts" };
    let k = 0;
    while (k < pts.length - 2 && t > pts[k + 1][0]) k++;
    const [s0, d0] = pts[k], [s1, d1] = pts[k + 1];
    const d = new Date(d0 + (d1 - d0) * Math.max(0, Math.min(1, (t - s0) / (s1 - s0))));
    return { label: `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`, spoken: `about ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, date: d };
  };
}

// Legend helpers -------------------------------------------------------------
const scaleLegend = (lowSay, highSay, root, scale, octaves, layer) => [
  { say: `Low: ${lowSay}.`, play: (e, t) => { for (let k = 0; k < 3; k++) pluck(e, e.layer(layer), t + k * 0.32, { midi: quantize(0.02 * k, root, scale, octaves), vel: 0.6, dur: 1 }); } },
  { say: "Rising through the scale…", play: (e, t) => { for (let k = 0; k <= 8; k++) pluck(e, e.layer(layer), t + k * 0.22, { midi: quantize(k / 8, root, scale, octaves), vel: 0.55, dur: 0.9, bright: k / 8 }); } },
  { say: `High: ${highSay}.`, play: (e, t) => { for (let k = 0; k < 3; k++) pluck(e, e.layer(layer), t + k * 0.32, { midi: quantize(1 - 0.02 * k, root, scale, octaves), vel: 0.6, dur: 1, bright: 1 }); } },
];

export const TRACKS = [
  {
    id: "sst",
    key: "1",
    title: "Ocean Heat & Currents",
    subtitle: "Global sea surface currents and temperature",
    analyzer: "sst",
    composer: "ocean",
    composerOpts: { root: 50, scale: SCALES.dorian },
    bpm: 88, stepsPerBeat: 2,
    projection: "equirect",
    unit: "°C",
    accent: "#ff8a3d",
    source: { name: "Global Sea Surface Currents and Temperature", svs: 3912, url: "https://svs.gsfc.nasa.gov/3912", credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio; ECCO2 model output (MIT/JPL)." },
    date: linearDate("2007-03-25T12:00Z", "2008-03-03T12:00Z"),
    summary: "Surface currents from NASA/JPL's ECCO2 ocean model, coloured by sea surface temperature, March 2007 to March 2008. Blue is about 0 °C, green 10–20 °C, yellow about 25 °C, red 32 °C.",
    story: [
      "Ocean Heat and Currents. You are hearing the surface of the world ocean from March 2007 to March 2008, from NASA and JPL's ECCO2 ocean model.",
      "Every two bars, the music sweeps once around the planet from west to east, so left to right in your headphones is west to east on the map.",
      "Plucked notes are the warmest water in each slice of ocean: the higher the note, the warmer the water. Soft low notes are the coldest water in that same slice, near the poles.",
      "Listen near the end of each sweep: the highest notes come from the Western Pacific Warm Pool, some of the warmest ocean water on Earth.",
    ],
    mapping: [
      ["Temperature from the colour bar (0–32 °C)", "Pitch of the plucked notes — warmer is higher (D Dorian scale)"],
      ["Longitude (scan from west to east)", "Position in the bar and left–right stereo position"],
      ["Coldest water in the same slice", "Soft low notes on the off-beats"],
      ["Global average temperature", "Brightness of the sustained chord"],
      ["On-screen motion of the currents", "Surf-like noise that swells with faster flow"],
      ["Hottest spot on the map (≥ 29 °C)", "A high chime once per sweep, panned to where it is"],
    ],
    legend: scaleLegend("about 0 degrees Celsius, polar water", "about 32 degrees Celsius, tropical water", 50, SCALES.dorian, 3, "warm"),
  },
  {
    id: "lightning",
    key: "2",
    title: "Storm Drums",
    subtitle: "Lightning detected from the ISS, 2017–2023",
    analyzer: "lightning",
    composer: "lightning",
    bpm: 100, stepsPerBeat: 4,
    projection: "equirect",
    unit: "",
    accent: "#ffd84a",
    source: { name: "Lightning Events Detected from the International Space Station (ISS) 2017-2023", svs: 5011, url: "https://svs.gsfc.nasa.gov/5011", credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio; Lightning Imaging Sensor (LIS) on the ISS, quality-controlled science data." },
    // The video's pace is uneven, so dates are anchored to the data: the share
    // of lightning in the Northern Hemisphere peaks every boreal summer, at
    // these video times (measured with the app's own analyser, 1 frame/s).
    date: anchoredDate([
      [5, "2017-03-01T00:00Z"], [15.5, "2017-07-15T00:00Z"], [28, "2018-07-15T00:00Z"], [40, "2019-07-15T00:00Z"],
      [51, "2020-07-15T00:00Z"], [62, "2021-07-15T00:00Z"], [75, "2022-07-15T00:00Z"], [94, "2023-07-15T00:00Z"],
      [98, "2023-07-31T00:00Z"],
    ]),
    dateApprox: true,
    summary: "Lightning events seen by the Lightning Imaging Sensor on the International Space Station, March 2017 to July 2023, shown with a 10-day roving window. The ISS orbit covers roughly 55° north to 55° south.",
    story: [
      "Storm Drums. These are lightning flashes detected from the International Space Station between 2017 and 2023.",
      "Every new flash on the map becomes a drum hit. Left and right tell you the longitude. Deep, booming drums are flashes near the equator; tighter, higher drums are flashes towards the poles.",
      "Underneath, a thunder rumble grows with the total amount of lightning on the planet.",
      "And listen to the chord: it turns major when most lightning is in the Northern Hemisphere and minor when most is in the Southern Hemisphere. As the seasons change, storms follow the sun, and you can hear the year turning.",
    ],
    mapping: [
      ["A new lightning flash (yellow dot appears)", "A drum hit, scheduled on a 16th-note grid"],
      ["Latitude of the flash", "Drum pitch and length: deep near the equator, higher towards the poles"],
      ["Longitude of the flash", "Left–right stereo position"],
      ["Total lightning on screen", "Loudness and brightness of the thunder rumble; density of rain ticks"],
      ["Share of lightning in the Northern Hemisphere", "Chord: major when north dominates, minor when south dominates"],
    ],
    legend: [
      { say: "A flash near the equator sounds like this.", play: (e, t) => drum(e, e.layer("strikes"), t, { freq: 48, vel: 0.9, decay: 0.6, noise: 0.25, tone: 900 }) },
      { say: "A flash at high latitude sounds like this.", play: (e, t) => drum(e, e.layer("strikes"), t, { freq: 170, vel: 0.9, decay: 0.18, noise: 0.7, tone: 4000 }) },
      { say: "A flash in the far west, then the far east.", play: (e, t) => { drum(e, e.layer("strikes"), t, { freq: 80, vel: 0.8, pan: -0.9 }); drum(e, e.layer("strikes"), t + 0.5, { freq: 80, vel: 0.8, pan: 0.9 }); } },
    ],
  },
  {
    id: "aerosols",
    key: "3",
    title: "Air Quartet",
    subtitle: "GEOS aerosols: dust, smoke, sea salt, sulfate",
    analyzer: "aerosols",
    composer: "aerosols",
    bpm: 76, stepsPerBeat: 2,
    projection: "equirect",
    unit: "",
    accent: "#c49af0",
    source: { name: "Science On A Sphere: Aerosols in the Air (version of GEOS Aerosols, SVS 5572)", svs: 5552, url: "https://svs.gsfc.nasa.gov/5552", credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio; NASA Global Modeling and Assimilation Office GEOS model." },
    date: linearDate("2024-08-01T00:00Z", "2024-09-14T00:00Z"),
    dateApprox: true,
    summary: "Aerosols modelled by NASA's GEOS system from 1 August to 14 September 2024: black carbon / smoke (orange-red), dust (magenta), sea salt (cyan) and sulfates (green).",
    story: [
      "Air Quartet. This is the air itself, from NASA's GEOS model, during August and September 2024. Four kinds of tiny particles drift around the planet, and each one plays its own instrument.",
      "Dust, lifted from deserts like the Sahara, is a low buzzing drone that pans towards wherever the dust is.",
      "Smoke from fires is a crackle, like a campfire. Sea salt, whipped up by ocean storms, is the sound of wind and surf.",
      "Sulfate pollution, from industry and volcanoes, rings out as glassy bells as the scanner passes over it. Use the mixer to solo any one particle type.",
    ],
    mapping: [
      ["Dust (magenta) amount", "Loudness of a low sawtooth drone; brightness follows dust intensity"],
      ["Where the dust is (centre of mass)", "Stereo position of the dust drone"],
      ["Smoke / black carbon (orange-red) amount", "Density of crackling noise grains; a low note per bar"],
      ["Sea salt (cyan / white swirls) amount", "Wind-and-surf noise level and position"],
      ["Sulfate (green) under the scanner", "Bells; higher bell = further north"],
    ],
    legend: [
      { say: "Dust.", play: (e, t) => drum(e, e.layer("dust"), t, { freq: 73, vel: 0.5, decay: 1.2, noise: 0.6, tone: 400 }) },
      { say: "Smoke.", play: (e, t) => { for (let k = 0; k < 14; k++) grain(e, e.layer("blackCarbon"), t + Math.random() * 1.2, { vel: 0.6, freq: 1500 + Math.random() * 4000, q: 2, dur: 0.02 }); } },
      { say: "Sea salt.", play: (e, t) => { for (let k = 0; k < 30; k++) grain(e, e.layer("seaSalt"), t + k * 0.04, { vel: 0.25, freq: 1400, q: 0.5, dur: 0.12 }); } },
      { say: "Sulfate.", play: (e, t) => { for (let k = 0; k < 3; k++) bell(e, e.layer("sulfate"), t + k * 0.3, { midi: 72 + k * 4, vel: 0.6, dur: 1.5, ratio: 2.76, index: 2.5 }); } },
    ],
  },
  {
    id: "co2",
    key: "4",
    title: "Carbon Breath",
    subtitle: "DYAMOND global carbon dioxide, early 2020",
    analyzer: "co2",
    composer: "co2",
    bpm: 66, stepsPerBeat: 2,
    projection: "equirect",
    unit: "ppm",
    accent: "#ff5a36",
    source: { name: "DYAMOND Global Carbon Dioxide for Science On A Sphere (version of SVS 5196)", svs: 5436, url: "https://svs.gsfc.nasa.gov/5436", credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio; experimental coupled GEOS-MITgcm (DYAMOND) simulation, NASA Global Modeling and Assimilation Office." },
    date: linearDate("2020-01-01T00:00Z", "2020-03-31T00:00Z"),
    dateApprox: true,
    summary: "Carbon dioxide near the surface, January to March 2020, from a very high-resolution NASA model. Plumes from power plants, cities and fires appear in orange to red (≈425–460 ppm). Lower concentrations are drawn nearly transparent, so they are not sonified.",
    story: [
      "Carbon Breath. This is carbon dioxide in the air, January to March 2020, from an experimental NASA model run at very high resolution.",
      "The low chord is the planet's carbon load: as more of the map fills with high carbon dioxide, the chord grows louder, brighter and more out of tune — tension you can feel.",
      "Notes play wherever the scanner crosses a plume. Higher notes mean higher concentrations, and above about 440 parts per million the music shifts into a darker mode.",
      "Over China, the United States and South Asia most of these emissions came from power plants, industry and traffic. In Africa and South America they came largely from fires. Listen for the heartbeat rising and falling: that is the daily pulse of fires and growing plants.",
    ],
    mapping: [
      ["CO₂ concentration from the colour bar (≈425–460 ppm)", "Pitch of plume notes — higher ppm is higher"],
      ["Very high concentration (above ≈440 ppm)", "Scale switches from Dorian to darker Phrygian"],
      ["Share of the map covered by plumes", "Drone loudness, brightness and detuning (tension)"],
      ["Day-to-day rise and fall of plumes", "Strength of the heartbeat"],
      ["Longitude (scan from west to east)", "Position in the bar and stereo position"],
    ],
    legend: scaleLegend("about 425 parts per million", "460 parts per million", 48, SCALES.dorian, 2, "plumes"),
  },
  {
    id: "nightlights",
    key: "5",
    title: "City Lights",
    subtitle: "Night lights 2012–2023 and how they changed",
    analyzer: "nightlights",
    composer: "nightlights",
    bpm: 96, stepsPerBeat: 2,
    projection: "equirect",
    unit: "",
    accent: "#a98bff",
    source: { name: "Change in Night Lights between 2012 and 2023 (EIC version: SVS 5313)", svs: 5276, url: "https://svs.gsfc.nasa.gov/5313", credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio; NASA Black Marble product from Suomi NPP VIIRS. Annual stills and change map from SVS 5276; EIC wall version SVS 5313." },
    date: (t) => (t < 24
      ? { label: String(2012 + Math.min(11, Math.floor(t / 2))), spoken: `the year ${2012 + Math.min(11, Math.floor(t / 2))}`, year: 2012 + Math.min(11, Math.floor(t / 2)) }
      : { label: "Change 2012 → 2023", spoken: "the change between 2012 and 2023", year: "change" }),
    summary: "Annual average night lights from NASA's Black Marble product, one year every 2 seconds from 2012 to 2023, then a map of change: purple where lights appeared, orange where lights went out.",
    story: [
      "City Lights. First you will hear the lights of the world at night, one year every two seconds, from 2012 to 2023. A small bell marks each new year.",
      "The scanner plays the brightest places in each slice of the globe; higher notes are further north.",
      "Then the map changes to show what changed. New lights, in purple, play bright rising notes in a major key. Places where the lights went out, in orange, play low, muffled notes in a minor key — in this period that includes places affected by conflict and disaster, such as parts of Ukraine.",
      "The chord underneath turns major when the planet gained more light than it lost.",
    ],
    mapping: [
      ["Brightest lit places in each slice (2012–2023 maps)", "Notes in a Lydian scale; higher = further north; louder = brighter"],
      ["New year in the series", "A small bell"],
      ["Purple: new lights", "Bright major-key notes"],
      ["Orange: lights out", "Low, muffled minor-key notes"],
      ["Total light / net gain vs loss", "Chord brightness; major if gain > loss, minor otherwise"],
    ],
    legend: [
      { say: "Lights appearing.", play: (e, t) => { for (let k = 0; k < 4; k++) pluck(e, e.layer("gain"), t + k * 0.2, { midi: quantize(k / 4, 64, SCALES.majorPentatonic, 2), vel: 0.6, dur: 1.2, bright: 0.9 }); } },
      { say: "Lights going out.", play: (e, t) => { for (let k = 0; k < 4; k++) pluck(e, e.layer("loss"), t + k * 0.25, { midi: quantize(1 - k / 4, 40, SCALES.minorPentatonic, 2), vel: 0.7, dur: 1.6, bright: 0.05 }); } },
    ],
  },
  {
    id: "gedi",
    key: "6",
    title: "Canopy",
    subtitle: "GEDI forest height from the ISS",
    analyzer: "gedi",
    composer: "forest",
    bpm: 80, stepsPerBeat: 2,
    projection: "globe",
    unit: "m",
    accent: "#9fd66b",
    source: { name: "GEDI Forest Height", svs: 4950, url: "https://svs.gsfc.nasa.gov/4950", credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio; Global Ecosystem Dynamics Investigation (GEDI) lidar on the ISS." },
    date: () => ({ label: "Apr 2019 – Apr 2020", spoken: "data from April 2019 to April 2020" }),
    summary: "Forest canopy height measured by the GEDI laser instrument on the International Space Station (April 2019 – April 2020), on a rotating globe. Brown and dark green are short vegetation; bright green and white are tall forest (0–50 m). Height is exaggerated on screen.",
    story: [
      "Canopy. This is the height of the world's forests, measured by a laser on the International Space Station, shown on a slowly turning globe.",
      "Because this is a globe, the scanner sweeps across the screen from left to right rather than around the whole world.",
      "The tallest trees in each slice play long, rising notes — the taller the forest, the higher and longer the note. Short, dry plucks are the lowest vegetation.",
      "Listen for the deep tropical rainforests: they sing in the upper register, while grasslands and dry regions stay low and quiet.",
    ],
    mapping: [
      ["Canopy height from the colour bar (0–50 m)", "Pitch and length of notes — taller is higher and longer"],
      ["Very tall forest (above ≈30 m)", "An extra octave harmonic"],
      ["Lowest vegetation in the slice", "Short, dry low plucks"],
      ["Forest visible on the globe", "Loudness of the warm chord"],
      ["Horizontal position on screen", "Position in the bar and stereo position"],
    ],
    legend: scaleLegend("bare ground, zero metres", "fifty metre tall forest", 43, SCALES.majorPentatonic, 3, "tall"),
  },
  {
    id: "ocean2",
    key: "7",
    title: "Gulf Stream Tour",
    subtitle: "Perpetual Ocean 2: western boundary currents",
    analyzer: "ocean2",
    composer: "ocean",
    composerOpts: { root: 52, scale: SCALES.lydian },
    bpm: 80, stepsPerBeat: 2,
    projection: "globe",
    unit: "°C",
    accent: "#ffb347",
    source: { name: "Perpetual Ocean 2: Western Boundary Currents (temperature version, opening 75 s)", svs: 5425, url: "https://svs.gsfc.nasa.gov/5425", credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio; ECCO-2 model output, 2021–2023." },
    date: () => ({ label: "Model years 2021–2023", spoken: "model output for 2021 to 2023" }),
    summary: "A camera tour of ocean currents from the ECCO-2 model, coloured by temperature (0–25 °C and above). Western boundary currents such as the Gulf Stream carry warm, salty water poleward. Values under ~5 °C cannot be told apart from the ocean background and are not sonified.",
    story: [
      "Gulf Stream Tour. This is the opening of Perpetual Ocean 2, a camera tour of ocean currents from NASA's ECCO-2 model.",
      "The scanner sweeps across the screen. Bright plucks are warm water, and the warmer it is, the higher the note.",
      "Watch and listen for the Gulf Stream: a ribbon of warm water flowing up the east coast of North America and out across the Atlantic. Currents like it carry heat from the tropics towards the poles.",
    ],
    mapping: [
      ["Temperature from the colour bar (≈5–25+ °C)", "Pitch of plucks — warmer is higher (E Lydian)"],
      ["Coldest visible water in the slice", "Soft low notes"],
      ["Camera and current motion", "Surf-like noise"],
      ["Horizontal position on screen", "Position in the bar and stereo position"],
    ],
    legend: scaleLegend("about 5 degrees Celsius", "25 degrees Celsius or warmer", 52, SCALES.lydian, 3, "warm"),
  },
];

export const IMAGE_TRACK = {
  id: "image",
  key: "8",
  title: "Your Image",
  subtitle: "Sonify any EIC frame or picture you upload",
  analyzer: "image",
  composer: "image",
  bpm: 84, stepsPerBeat: 2,
  projection: "screen",
  unit: "",
  accent: "#7fd4ff",
  source: { name: "Your upload", url: null, credit: "Analysed only in your browser; nothing is uploaded anywhere." },
  date: () => ({ label: "Your image", spoken: "your image" }),
  summary: "Upload any EIC frame, still or short video. The scanner sweeps left to right: bright regions play notes, higher on screen = higher pitch, warm colours are strings and cool colours are bells.",
  story: [
    "Your Image. The scanner sweeps across your picture from left to right. Bright areas play notes: the higher up they are, the higher the pitch. Warm colours play strings and cool colours play bells.",
  ],
  mapping: [
    ["Horizontal position", "Time in the bar and stereo position"],
    ["Vertical position of bright areas", "Pitch — higher on screen is higher"],
    ["Brightness", "Loudness"],
    ["Warm vs cool hue", "Strings vs bells"],
  ],
  legend: scaleLegend("the bottom of the picture", "the top of the picture", 48, SCALES.majorPentatonic, 3, "warmHues"),
};

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || (id === "image" ? IMAGE_TRACK : null);
}
