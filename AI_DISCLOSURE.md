# AI Use Disclosure

**Code written with Claude (Anthropic) as an AI coding assistant, under our direction.** This file follows the NASA Space Apps rules for disclosing AI-generated material.

## Who did what

**Our team:**
- Chose the *Earth Jukebox* challenge and researched it: the brief, the NASA EIC/SVS resources, and the judging and submission requirements.
- Brainstormed and directed the concept: an accessible, data-driven "jukebox" of EIC visualizations, its features, and how it should look and behave (for example the homepage, the Watch-demo button and demo mode).
- Reviewed, ran and tested the app on our own devices. Our testing found real problems that were then fixed: the demo montage switching before records were heard, stale versions served by GitHub Pages caching, and the demo video running over 30 seconds.
- Recorded and produced the demo video.
- Managed the code repository and hosting (Git, GitHub, GitHub Pages).
- Made the final decisions on what to submit.

**AI assistance (Claude, Anthropic):**
- Code written with Claude (Anthropic) as an AI coding assistant, under our direction (JavaScript, HTML/CSS, Python, tests), including debugging.
- Helped research the NASA datasets, inspect their colour bars and define the sound mappings.
- Drafted documentation text: the README, in-app descriptions and story narration, and project-page text.

## AI-generated material in this project

| Material | AI involvement | How it is labelled |
|---|---|---|
| Source code (`js/`, `css/`, `index.html`, `scripts/`, `tests/`) | AI-assisted | This file; a header line in each source file; `aiDisclosure` in `package.json`; `<meta name="ai-disclosure">` in `index.html` |
| Derived data (`media/colormaps.json`, `tests/fixtures/`, re-encoded `media/*/video.mp4`) | Produced by AI-assisted scripts from NASA SVS originals | This file; `_provenance` field in `colormaps.json` |
| Audio (live soundtrack, and recordings made with the Record button) | Synthesised in real time by AI-assisted code from NASA data. No generative-AI audio model is used. | This file; recording file names |
| Demo page (the app's 30-second demo mode: its scripted sequence and subtitle text) | Part of the app code, written with Claude | This file; header line in `js/main.js` |
| Demo video | made by our team from the demo page made with ai"s assistance ; the video itself is not AI-generated | This file; video description |
| Text (descriptions, narration, docs) | Drafted with AI, reviewed by our team | This file |
| GeoHarmonics logo and banner (`geoharmonics_logo_waves`, `geoharmonics_banner`) | **AI-generated images** | Visible "AI-generated image" watermark on the labelled copies (`*-ai-labelled.jpg/.svg`); image metadata (EXIF description / SVG `<desc>`); this file |
| In-app logo and browser-tab icon (the circle-and-wave icon in `index.html`) | Drawn in SVG code written with Claude | This file; "How it works" box |

## What is *not* AI-generated

- **All imagery is NASA's.** It comes from the NASA Goddard Scientific Visualization Studio; it was re-encoded, not altered or generated. Credits are in the README.
- **No AI video, voice-clone or music-generation models were used.** Every sound is synthesised by deterministic code (oscillators, filters and noise) from values read out of NASA's visualizations. Spoken narration uses the viewer's own browser text-to-speech voice.
- The only AI-generated images are our GeoHarmonics logo and banner (see the table above). No NASA imagery was generated or altered.
