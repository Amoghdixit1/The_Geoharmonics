# Space Apps project page — copy/paste text

Replace the [brackets]. Field names may differ slightly on the form; match by meaning.

---

## Project name
Earth Jukebox: Hear Our Changing Planet

## High-level summary (short)
Earth Jukebox turns NASA Earth Information Center visualizations into live music generated from their pixels. It reads each visualization's own colour bar to recover real values (sea temperature in °C, CO₂ in ppm, forest height in metres) and maps them to pitch, rhythm and instruments, with stereo position following longitude. Blind and low-vision users can explore any map by touch or keyboard and hear the value and place spoken aloud. Seven EIC/SVS datasets are included (ocean heat, lightning, aerosols, CO₂, night lights, forest height and ocean currents), and users can upload their own frames.

## Links
- Live demo: https://amoghdixit1.github.io/nasa-final/
- Demo video (30 s): [YouTube link]
- Code: https://github.com/Amoghdixit1/nasa-final

## Project details

**What it does**
Earth Jukebox is a web "jukebox" of seven NASA Earth Information Center visualizations. Pick a record and the visualization plays while a soundtrack is synthesised live from the frame on screen. It works in any modern browser and needs no install. It has five modes:
- **Listen:** the live sonification.
- **Guided story:** a spoken introduction, then the audio legend.
- **Hear the legend:** what "low" and "high" sound like.
- **Explore by touch:** pause and move a sound probe over the map; press Enter to hear, for example, "29.5 degrees Celsius, near the Western Pacific Warm Pool".
- **Your image:** sonify any uploaded EIC frame.

**How it works**
1. **Pixels back to data.** We sampled each visualization's own colour bar and invert it with a precomputed 32×32×32 colour lookup. On shaded imagery (flowing particles, 3D globes) we compare chroma (colour without brightness), so shadows don't change the value.
2. **Where on Earth.** Most records are flat equirectangular maps, so every pixel has a latitude and longitude. This drives stereo panning and place names in the descriptions.
3. **The scanner.** Every bar of music sweeps the planet from west to east in 16 steps. Position in the bar and left–right position both mean longitude, on every record, so a listener learns the mapping once.
4. **A musical rule-set per dataset:**
   - **Ocean:** warmer water plays higher notes.
   - **Lightning:** each new flash is a drum, deeper near the equator. The chord turns major or minor depending on which hemisphere has more storms, so you hear the seasons.
   - **Aerosols:** four instruments for dust, smoke, sea salt and sulfate, with a mixer to solo each.
   - **CO₂:** plume notes plus a drone that grows tense and out of tune as plumes spread.
   - **Night lights:** 2012–2023 year by year, then new lights as bright major notes and lights-out as muffled minor notes.
   - **Forest height:** taller canopy plays higher, longer notes.
5. **Musical by design.** Pitches are snapped to a scale chosen per dataset, and a voice limit, compressor and limiter keep dense data from becoming noise.
6. **Accessible by design.** Data-generated descriptions go to an ARIA live region and an optional built-in voice. There's full keyboard control, high contrast, larger text, reduced motion and vibration on supported phones.

**Validation**
An automated test suite (23 tests) runs the analysers on real frames from the NASA videos and checks known physical patterns:
- The warmest water is in the tropics (about 30 °C, Western Pacific Warm Pool) and the coldest near the poles.
- Dust is centred over the Sahara and sulfate over East Asia.
- No lightning appears outside the ISS orbit band.
- CO₂ values stay within the legend's 425–460 ppm range.
- The world gained more night light than it lost from 2012 to 2023.

The tests also caught and fixed a dating error. The lightning video's pace is uneven, so we calibrated its dates from the data itself: the Northern-Hemisphere share of lightning peaks every boreal summer.

**Benefits and intended impact**
EIC visualizations are currently sight-only. Earth Jukebox gives blind and low-vision people a way to explore Earth science independently, not just hear a description of it. For everyone else, sound adds an emotional, memorable layer: you can hear storms follow the sun, cities brighten across India, and carbon dioxide build into tension. It could run on EIC displays, in classrooms and museums, or on any phone.

**Tools and technologies**
- **App:** JavaScript (ES modules), HTML and CSS, with the Web Audio API for all synthesis (no samples) and the Web Speech API.
- **Media pipeline:** Python with ffmpeg (via imageio-ffmpeg), NumPy and Pillow.
- **Tests:** Node.js test runner.
- **Hosting:** GitHub Pages.
- No third-party runtime libraries.

**Honest limitations**
- Values are read from rendered colours, not raw science files, so they are close approximations.
- Some dates are estimated from video position and labelled "about".
- Very low CO₂ (below about 425 ppm) and very cold Perpetual Ocean water (below about 5 °C) are not sonified, because the visualizations make them indistinguishable from the background.

## Use of Artificial Intelligence
We used Claude, an AI coding assistant from Anthropic, to help write and debug the application code, the media pipeline and the tests, and to help draft documentation. Our team chose the datasets and the sonification design, reviewed and tested the output, and made the final decisions. No AI-generated imagery or audio is used: every sound is synthesised live from NASA data by our code.

## NASA data used
- Global Sea Surface Currents and Temperature — https://svs.gsfc.nasa.gov/3912
- Lightning Events Detected from the ISS 2017–2023 — https://svs.gsfc.nasa.gov/5011
- GEOS Aerosols — https://svs.gsfc.nasa.gov/5572 (Science On a Sphere version: https://svs.gsfc.nasa.gov/5552)
- DYAMOND Global Carbon Dioxide — https://svs.gsfc.nasa.gov/5196 (SOS version: https://svs.gsfc.nasa.gov/5436)
- Change in Night Lights between 2012 and 2023, EIC Version — https://svs.gsfc.nasa.gov/5313 (also https://svs.gsfc.nasa.gov/5276)
- GEDI Forest Height — https://svs.gsfc.nasa.gov/4950
- Perpetual Ocean 2: Western Boundary Currents — https://svs.gsfc.nasa.gov/5425
- Conceptual reference: Data Sonification: Caldwell 73 (NASA)

## Space agency partner and other data
None. All imagery is from NASA's Scientific Visualization Studio.

## Tags
#sonification #accessibility #EarthInformationCenter #climate #WebAudio #blind #lowvision #oceans #lightning #CO2
