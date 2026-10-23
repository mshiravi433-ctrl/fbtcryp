#!/usr/bin/env python3
"""Build the reward-tier animal artwork from the supplied JPEGs.

    python3 scripts/build-reward-artwork.py

Reads assets/rewards/source/<animal>.jpg and writes the transparent, optically
normalised public/images/rewards/<animal>.webp files that TierTotem renders.

WHY THIS SCRIPT EXISTS (and why it is not a one-off ImageMagick command line)
---------------------------------------------------------------------------
The uploads are JPEGs, so they have no alpha channel: the "transparent" look is
a near-white checkerboard baked into 245..255. Two naive approaches both fail:

  · "delete white pixels" also deletes the specular highlights plastered all
    over the turtle's shell and the diamond facets — the animal becomes a
    colander.
  · "threshold then keep the bbox" fails on the sparkles floating around every
    illustration: one dot near the frame edge makes the bbox the whole frame,
    and the animal renders tiny.

So the pipeline is:

  1. flood the connected light background inward from the border (only pixels
     reachable from the frame are background — interior whites survive),
  2. feather the cut edge so the JPEG stair-steps disappear,
  3. un-composite the white fringe: source = a*colour + (1-a)*white, solved for
     colour. Without this every cut keeps a pale halo, which is glaring on the
     dark theme the app defaults to,
  4. erode away isolated specks, take the bbox of what is left, pad it back,
  5. re-centre on a 400×400 square at a per-animal optical size (FIT), so a
     wide turtle and a tall lion read as the same weight inside the medallion
     instead of one floating in empty space.

Requires Pillow + numpy (dev-only; not needed to build, run or test the app).
"""

import pathlib
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "assets" / "rewards" / "source"
OUT_DIR = ROOT / "public" / "images" / "rewards"

SIZE = 400

# Fraction of the square canvas the *longest* side of the artwork occupies.
# Full figures breathe a little more than head-only portraits, which is what
# makes the row look even; these numbers were tuned against the real files.
FIT = {
    "turtle": 0.94,  # wide and low — needs to fill the width to have presence
    "wolf": 0.86,    # tall portrait bust
    "lion": 0.86,    # tall portrait bust, same as the wolf on purpose
    "dragon": 0.84,  # horns + winding neck are the widest part
    "phoenix": 0.88, # tall flames, but the wings already spread wide
}


def background_mask(rgb: np.ndarray, lum_threshold=232, max_chroma=14) -> np.ndarray:
    """Flood light, near-neutral pixels inward from the frame."""
    lum = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    candidate = (lum >= lum_threshold) & (chroma <= max_chroma)

    h, w = candidate.shape
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def build(name: str) -> None:
    source = Image.open(SRC_DIR / f"{name}.jpg").convert("RGB")
    rgb = np.asarray(source).astype(np.float32)

    alpha = np.where(background_mask(rgb), 0.0, 1.0).astype(np.float32)

    alpha = np.asarray(
        Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.6))
    ).astype(np.float32) / 255.0

    a = np.clip(alpha, 1e-3, 1.0)[..., None]
    colour = np.clip((rgb - (1.0 - a) * 255.0) / a, 0, 255)

    art = Image.fromarray(
        np.concatenate([colour, alpha[..., None] * 255.0], axis=2).astype(np.uint8), "RGBA"
    )

    # Isolated sparkles must not inflate the crop.
    mask = art.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    opened = mask.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))
    box = opened.getbbox()
    pad = 8
    box = (
        max(0, box[0] - pad),
        max(0, box[1] - pad),
        min(art.width, box[2] + pad),
        min(art.height, box[3] + pad),
    )
    art = art.crop(box)

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    target = int(round(SIZE * FIT[name]))
    scale = target / max(art.size)
    art = art.resize(
        (max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS
    )
    canvas.alpha_composite(art, ((SIZE - art.width) // 2, (SIZE - art.height) // 2))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT_DIR / f"{name}.webp", "WEBP", quality=88, method=6)
    print(f"{name}: source box {box} -> {art.size} in {SIZE}px, fit {FIT[name]}")


if __name__ == "__main__":
    for animal in FIT:
        build(animal)
