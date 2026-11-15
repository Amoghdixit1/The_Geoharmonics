# Earth Jukebox — Code written with Claude (Anthropic) as an AI coding assistant, under our direction. See AI_DISCLOSURE.md.
"""
Earth Jukebox media pipeline.

Streams the NASA SVS / EIC source videos straight from svs.gsfc.nasa.gov,
re-encodes them to small web-friendly H.264 files, extracts the colormap of
every legend (colorbar) so the browser can turn pixel colours back into
physical values, and writes raw-pixel test fixtures used by `npm test`.

Why this exists: SVS media is not served with CORS headers for arbitrary
origins, so a browser cannot read pixels from it directly. Serving our own
same-origin copies lets the app analyse every frame live in a <canvas>.

Usage:
    pip install imageio-ffmpeg numpy pillow
    python scripts/build_media.py            # build everything
    python scripts/build_media.py sst co2    # build selected tracks
    python scripts/build_media.py --fixtures-only
"""
from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "media"
FIXTURES = ROOT / "tests" / "fixtures"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SVS = "https://svs.gsfc.nasa.gov/vis/a000000"

# ---------------------------------------------------------------------------
# Track definitions. `analysis` is the pixel grid the browser analyses; the
# fixtures are rendered at exactly that size so tests see what the app sees.
# ---------------------------------------------------------------------------
TRACKS = {
    "sst": dict(
        inputs=[dict(url=f"{SVS}/a003900/a003912/ecco2_sst_flow.mp4")],
        size=(1024, 512), crf=24, poster=20.0,
        analysis=(128, 64), fixture_times=[5.0, 40.0],
    ),
    "lightning": dict(
        inputs=[dict(url=f"{SVS}/a005000/a005011/iss_lightning_sos_yearly_07312023_2048p60.mp4")],
        size=(1024, 512), crf=19, poster=60.0,
        analysis=(256, 128), fixture_times=[20.0, 60.0],
    ),
    "aerosols": dict(
        inputs=[dict(url=f"{SVS}/a005500/a005552/Aerosols_NoLabels_2048x1024_30fps.mp4")],
        size=(1024, 512), crf=24, poster=5.0,
        analysis=(128, 64), fixture_times=[5.0, 50.0],
    ),
    "co2": dict(
        inputs=[dict(url=f"{SVS}/a005400/a005436/soscomp_1-29-2025a_1024p30.mp4")],
        size=(1024, 512), crf=24, poster=20.0,
        analysis=(128, 64), fixture_times=[2.0, 20.0],
    ),
    # Night lights: 12 annual stills (2012..2023) held 2 s each, followed by
    # the clean global change map (no zoom insets) from the flat-map video.
    "nightlights": dict(
        inputs=[
            dict(url=f"{SVS}/a005200/a005276/nightlights_flat_series_stills_only_lights_2160p3_h265.mp4"),
            dict(url=f"{SVS}/a005200/a005276/nightlights_2012-2023_change_flat_2160p30.mp4", ss=10.0, t=10.5),
        ],
        filter=(
            "[0:v]setpts=PTS*6,fps=30,scale=1024:576:flags=area,setsar=1[a];"
            "[1:v]fps=30,scale=1024:576:flags=area,setsar=1[b];"
            "[a][b]concat=n=2:v=1:a=0[v]"
        ),
        size=(1024, 576), crf=21, poster=30.0,
        analysis=(128, 72), fixture_times=[1.0, 23.0, 30.0],
    ),
    "gedi": dict(
        inputs=[dict(url=f"{SVS}/a004900/a004950/GEDI_global_w_colorbar_1080p60.mp4")],
        size=(1024, 576), crf=23, poster=20.0,
        analysis=(128, 72), fixture_times=[20.0],
    ),
    "ocean2": dict(
        inputs=[dict(url=f"{SVS}/a005400/a005425/perpetual_ocean2_CLOSE_096_temperature_1080p30.mp4", t=75.0)],
        size=(1024, 576), crf=23, poster=30.0,
        analysis=(128, 72), fixture_times=[30.0],
    ),
}

# Colorbars: where the gradient lives and what physical values its ends mean.
COLORBARS = {
    "sst": dict(url=f"{SVS}/a003900/a003912/sst_ecco2_cbar.png",
                row=47, x0=16, x1=289, v0=0.0, v1=32.0, unit="°C"),
    # CO2 bar spans 380 ppm (x=238) .. 460 ppm (x=1681). Below ~425 ppm the
    # visualisation is (semi-)transparent, so only the opaque part is usable.
    "co2": dict(url=f"{SVS}/a005400/a005436/dyamondCbar_6-27-2024a.png",
                row=330, x0=1050, x1=1681, v0=380 + (1050 - 238) / (1681 - 238) * 80, v1=460.0, unit="ppm"),
    "nightlights": dict(url=f"{SVS}/a005200/a005276/nightlights_change_colorbar.png",
                        row=1085, x0=None, x1=None, v0=-1.0, v1=1.0, unit="relative change"),
    "ocean2": dict(url=f"{SVS}/a005400/a005425/perpetual_ocean2_CLOSE_101_cbar_temperature.png",
                   row=540, x0=268, x1=1652, v0=0.0, v1=25.0, unit="°C"),
    # GEDI's legend is burned into the video itself: read it from a frame.
    "gedi": dict(frame=(f"{SVS}/a004900/a004950/GEDI_global_w_colorbar_1080p60.mp4", 20.0),
                 row=1000, x0=66, x1=466, v0=0.0, v1=50.0, unit="m"),
}

AEROSOL_SWATCHES = dict(url=f"{SVS}/a005500/a005552/Aerosols_cbar.png",
                        points={"blackCarbon": (185, 175), "dust": (392, 175),
                                "seaSalt": (593, 175), "sulfate": (803, 175)})


def run(cmd: list[str]) -> bytes:
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        sys.stderr.write(res.stderr.decode(errors="replace")[-3000:])
        raise SystemExit(f"command failed: {' '.join(cmd[:6])} ...")
    return res.stdout


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def build_video(name: str, cfg: dict) -> None:
    out = MEDIA / name / "video.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
    for inp in cfg["inputs"]:
        if "ss" in inp:
            cmd += ["-ss", str(inp["ss"])]
        if "t" in inp:
            cmd += ["-t", str(inp["t"])]
        cmd += ["-i", inp["url"]]
    w, h = cfg["size"]
    if "filter" in cfg:
        cmd += ["-filter_complex", cfg["filter"], "-map", "[v]"]
    else:
        cmd += ["-vf", f"fps=30,scale={w}:{h}:flags=area,setsar=1"]
    cmd += ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(cfg["crf"]),
            "-pix_fmt", "yuv420p", "-g", "30", "-movflags", "+faststart", str(out)]
    print(f"[{name}] encoding video (streaming from SVS)...", flush=True)
    run(cmd)
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(cfg["poster"]),
         "-i", str(out), "-frames:v", "1", "-q:v", "4", str(out.parent / "poster.jpg")])
    print(f"[{name}] {out.stat().st_size / 1e6:.1f} MB", flush=True)


def gradient_from_image(img: Image.Image, row: int, x0, x1, n: int = 96) -> list[list[int]]:
    a = np.asarray(img.convert("RGBA")).astype(int)
    line = a[row]
    if x0 is None:  # auto-detect the opaque, coloured extent of the bar
        xs = np.where(line[:, 3] > 200)[0]
        x0, x1 = int(xs.min()) + 2, int(xs.max()) - 2
    xs = np.linspace(x0, x1, n).round().astype(int)
    band = a[row - 2: row + 3, :, :3].mean(axis=0)  # average 5 rows to denoise
    return [[int(round(c)) for c in band[x]] for x in xs]


def build_colormaps() -> None:
    maps = {}
    for name, cb in COLORBARS.items():
        if "frame" in cb:
            url, t = cb["frame"]
            png = run([FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", str(t), "-i", url,
                       "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"])
            img = Image.open(io.BytesIO(png))
        else:
            img = Image.open(io.BytesIO(fetch(cb["url"])))
        colors = gradient_from_image(img, cb["row"], cb["x0"], cb["x1"])
        maps[name] = dict(v0=round(cb["v0"], 3), v1=cb["v1"], unit=cb["unit"], colors=colors)
        print(f"[colormap] {name}: {len(colors)} stops {colors[0]} -> {colors[-1]}")
    img = np.asarray(Image.open(io.BytesIO(fetch(AEROSOL_SWATCHES["url"]))).convert("RGB")).astype(int)
    maps["aerosolTypes"] = {k: [int(c) for c in img[y, x]] for k, (x, y) in AEROSOL_SWATCHES["points"].items()}
    print(f"[colormap] aerosol swatches: {maps['aerosolTypes']}")
    maps = {"_provenance": "Colour-bar samples extracted from NASA SVS legends by scripts/build_media.py "
                           "(AI-assisted code: Claude, Anthropic). See AI_DISCLOSURE.md.", **maps}
    (MEDIA / "colormaps.json").write_text(json.dumps(maps, indent=1))


def build_fixtures(name: str, cfg: dict) -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    w, h = cfg["analysis"]
    src = MEDIA / name / "video.mp4"
    for t in cfg["fixture_times"]:
        raw = run([FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", str(t), "-i", str(src),
                   "-frames:v", "1", "-vf", f"scale={w}:{h}:flags=area", "-f", "rawvideo",
                   "-pix_fmt", "rgba", "-"])
        assert len(raw) == w * h * 4, (name, t, len(raw))
        (FIXTURES / f"{name}@{t:g}.json").write_text(json.dumps(
            dict(track=name, time=t, width=w, height=h, rgba=base64.b64encode(raw).decode())))
    print(f"[{name}] fixtures written")


def main(argv: list[str]) -> None:
    fixtures_only = "--fixtures-only" in argv
    names = [a for a in argv if not a.startswith("--")] or list(TRACKS)
    MEDIA.mkdir(exist_ok=True)
    if not fixtures_only:
        build_colormaps()
    for name in names:
        if not fixtures_only:
            build_video(name, TRACKS[name])
        build_fixtures(name, TRACKS[name])


if __name__ == "__main__":
    main(sys.argv[1:])
