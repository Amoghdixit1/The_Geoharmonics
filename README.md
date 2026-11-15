# Earth Jukebox

**Hear our changing planet.** Earth Jukebox plays NASA Earth Information Center (EIC) visualizations as live music. Each musical step reads the video frame currently on screen, converts pixel colours back into real values (°C, ppm, metres) using the visualization's own colour bar, and turns those values into sound.

Built for the NASA Space Apps Challenge *Earth Jukebox* challenge. It works with screen readers, the keyboard and touch.

## The records

| # | Record | NASA SVS source | What you hear |
|---|---|---|---|
| 1 | **Ocean Heat & Currents** | [Global Sea Surface Currents and Temperature (3912)](https://svs.gsfc.nasa.gov/3912) | Warmest and coldest water in each slice of ocean, as notes (0–32 °C → pitch) |
| 2 | **Storm Drums** | [Lightning from the ISS 2017–2023 (5011)](https://svs.gsfc.nasa.gov/5011) | One drum per new flash. Latitude sets the drum pitch, longitude sets left/right. The chord flips major/minor with the hemisphere that has more storms |
| 3 | **Air Quartet** | [GEOS Aerosols (5572 / 5552)](https://svs.gsfc.nasa.gov/5552) | One instrument per particle type: dust drone, smoke crackle, sea-salt surf, sulfate bells |
| 4 | **Carbon Breath** | [DYAMOND Global CO₂ (5196 / 5436)](https://svs.gsfc.nasa.gov/5436) | Plume notes (≈425–460 ppm → pitch). A drone grows tense with plume coverage, and a heartbeat follows the daily pulse |
| 5 | **City Lights** | [Night Lights 2012–2023, EIC version (5313 / 5276)](https://svs.gsfc.nasa.gov/5313) | One year every 2 s, then the change map: new lights play bright major notes, lights out play muffled minor notes |
| 6 | **Canopy** | [GEDI Forest Height (4950)](https://svs.gsfc.nasa.gov/4950) | Taller forest plays higher, longer notes (0–50 m) |
| 7 | **Gulf Stream Tour** | [Perpetual Ocean 2: Western Boundary Currents (5425)](https://svs.gsfc.nasa.gov/5425) | Warm currents as rising plucks (≈5–25 °C) |
| 8 | **Your Image** | Any frame you upload | Classic image sonification: height on screen sets pitch, brightness sets loudness, hue sets the instrument |

## Features

- **Live sonification.** Sound is synthesised in the browser with the Web Audio API, from the frame on screen at that moment. No pre-recorded audio is used.
- **Values come from the legend.** The pipeline samples each SVS colour bar. The app inverts it with a precomputed 32³ lookup cube, comparing colour without brightness for shaded imagery and adding a lightness term for GEDI's brown → cream bar.
- **The scanner.** Every bar sweeps west to east in 16 steps. Time in the bar and stereo position both mean longitude, on every record, so you learn it once.
- **Explore by touch.** Pause and move a sound probe with the arrow keys, mouse or finger. Pitch follows the value and pan follows position. **Enter** speaks the value and place, for example *"28.4 degrees Celsius, near the Gulf Stream, 35 degrees north, 70 degrees west."* Supported phones vibrate on extremes and on lightning.
- **Guided story.** A spoken introduction to each dataset, then the audio legend, then playback.
- **Hear the legend.** Plays what "low" and "high" sound like before you listen.
- **Live descriptions.** Sentences generated from the data, for example *"warmest water about 30.3 °C near the Western Pacific Warm Pool…"*. They go to a caption, an ARIA live region and, optionally, the built-in voice.
- **Mixer.** Each instrument is a layer with a plain-language explanation, plus mute, solo and level controls.
- **Record.** Export the soundtrack as an audio file to build a playlist.
- **Accessibility.** Full keyboard control (`?` lists shortcuts), screen-reader announcements, high contrast, larger text, reduced motion and 44 px touch targets.

## Run it

Requirements: Node 18+ to serve the app, and Python 3.10+ only if you want to rebuild the media.

```bash
npm start            # http://localhost:8080
npm test             # 23 tests: analysis on real NASA frames + every composer
```

The processed media (`media/`) is committed, so the app runs straight away. To rebuild it from NASA's servers (about 1 GB is streamed):

```bash
pip install imageio-ffmpeg numpy pillow
python scripts/build_media.py          # or: python scripts/build_media.py sst co2
```

Use the included server, not `file://` or `python -m http.server`. Video seeking needs HTTP Range requests, and ES modules need the right MIME type.

## Deploy (GitHub Pages)

GitHub Pages lets browsers cache files for about 10 minutes. Before every push, stamp a new version so visitors always get the latest build:

```bash
npm run bump        # versions CSS/JS URLs + version.json
git add -A && git commit -m "..." && git push
```

The page also checks `version.json` (bypassing the cache) on load and reloads once if it is out of date.

## How it works

```
NASA SVS videos + colour bars
        │  scripts/build_media.py  (ffmpeg, streamed; colormap + fixture extraction)
        ▼
media/<record>/video.mp4  +  media/colormaps.json
        │  browser: <video> → <canvas> (128×64 analysis grid) every musical step
        ▼
js/analysis.js   pixels → values (colormap inversion, aerosol classifier,
                 lightning flash detection, night-light change), lat/lon, stats
        ▼
js/composers.js  artistic rule-sets: scanner, scales, instruments per variable
        ▼
js/audio/        Web Audio synths → compressor → limiter → speakers / recorder
js/describe.js   the same numbers → sentences for captions and screen readers
```

**Why each pitch choice sounds musical:** every value goes through `quantize()` onto a scale chosen per record (Dorian, Lydian, pentatonic…). Busy data is capped by a voice budget, then a compressor and limiter. Data can make the music tense, as in CO₂ detuning and mode changes, but it never clips or turns into noise.

## Validation

`npm test` runs the real analysers on frames taken from the NASA videos and checks the results against known physical patterns:

- **Colour bars:** every legend colour inverts to the right value (error < 12%), and shaded colours still invert correctly.
- **Sea surface temperature:** the maximum is 27–32 °C in the tropics, the minimum is at high latitudes, and the equator is more than 10 °C warmer than 45–70°.
- **Lightning:** no flashes beyond the ISS orbit band, the centre of activity is in the tropics, and new-flash events are detected between frames.
- **Aerosols:** dust is centred over the Sahara and Atlantic, and sulfate over East and South Asia.
- **CO₂:** plume values stay inside the opaque legend range (≈425–460 ppm).
- **Night lights:** 2023 has more lit area than 2012, and the world shows a net gain overall.
- **Composers and legends:** every composer runs 64 steps per frame against a fake Web Audio graph with no non-finite parameters, and every legend plays.

## Honest limitations

- Values are read from rendered colours, not the raw science data. Compression and anti-aliasing add small errors, and on 3D globes (GEDI, Perpetual Ocean 2) lighting can shift values.
- Where a video has no on-screen date, dates are estimated and labelled "about". Most are spread evenly across the video. For Storm Drums the pace is uneven, so dates are anchored to the data: the analyser found the Northern-Hemisphere lightning share peaking every boreal summer, and those peaks are pinned to mid-July of each year.
- Below ≈425 ppm the CO₂ visualization is transparent, and below ≈5 °C Perpetual Ocean's navy matches the sea floor, so those ranges are not sonified. The interface says so.
- Place names come from approximate bounding boxes and are phrased as "near".

## Credits

Visualizations: **NASA Goddard Space Flight Center Scientific Visualization Studio**, with the science teams credited on each record page (ECCO2/ECCO-2, ISS LIS, NASA GMAO GEOS, DYAMOND GEOS-MITgcm, Black Marble / Suomi NPP VIIRS, GEDI). Earth Jukebox is a Space Apps project and is not endorsed by NASA. No NASA logos are used.

All synthesis, analysis and interface code in this repository is original (MIT licence). No third-party runtime libraries are used.
