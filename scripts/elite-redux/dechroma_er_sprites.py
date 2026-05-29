#!/usr/bin/env python3
# Some Elite Redux sprite/icon PNGs ship with an un-removed chroma-key
# background (a flat green, e.g. (46,230,68) on full sprites or (98,156,131)/
# (152,208,160) on down-sampled icons) instead of transparency. In any grid
# that renders the ER per-slug atlases (starter-select, Pokédex, party) those
# show as a green square behind the icon; in battle they'd box the sprite.
#
# This pass removes that background by an EDGE flood-fill: starting from every
# border pixel whose colour matches the detected corner background (within a
# tolerance), it clears connected matching pixels to transparent. Flood-fill
# (rather than a global colour match) protects same-coloured pixels INSIDE the
# sprite from being punched out.
#
# Idempotent: images whose corners are already transparent are skipped.
#
# Usage:
#   python scripts/elite-redux/dechroma-er-sprites.py            # apply in place
#   python scripts/elite-redux/dechroma-er-sprites.py --dry      # report only
#   python scripts/elite-redux/dechroma-er-sprites.py <slug>...  # limit to slugs
import os
import sys
from collections import deque

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = os.path.join(ROOT, "assets/images/pokemon/elite-redux")
TOL = 48  # per-channel chroma match tolerance

DRY = "--dry" in sys.argv
slug_filter = [a for a in sys.argv[1:] if not a.startswith("--")]


def is_green_chroma(px):
    r, g, b, a = px
    return a > 200 and g > r + 18 and g > b + 18 and g > 70


def close(c, ref):
    return all(abs(c[i] - ref[i]) <= TOL for i in range(3))


def dechroma(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    # Reference bg = a corner pixel that is opaque green chroma.
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    ref = next((c for c in corners if is_green_chroma(c)), None)
    if ref is None:
        return False  # already transparent / not chroma-keyed

    visited = bytearray(w * h)
    q = deque()

    def consider(x, y):
        if 0 <= x < w and 0 <= y < h and not visited[y * w + x]:
            visited[y * w + x] = 1
            c = px[x, y]
            if c[3] > 0 and close(c, ref):
                px[x, y] = (c[0], c[1], c[2], 0)
                q.append((x, y))

    for x in range(w):
        consider(x, 0)
        consider(x, h - 1)
    for y in range(h):
        consider(0, y)
        consider(w - 1, y)
    while q:
        x, y = q.popleft()
        consider(x + 1, y)
        consider(x - 1, y)
        consider(x, y + 1)
        consider(x, y - 1)

    if not DRY:
        im.save(path)
    return True


def main():
    slugs = slug_filter if slug_filter else sorted(os.listdir(BASE))
    fixed = 0
    fixed_files = 0
    for slug in slugs:
        d = os.path.join(BASE, slug)
        if not os.path.isdir(d):
            continue
        touched = False
        for fn in os.listdir(d):
            if not fn.endswith(".png"):
                continue
            if dechroma(os.path.join(d, fn)):
                fixed_files += 1
                touched = True
        if touched:
            fixed += 1
    print(f"{'[dry] ' if DRY else ''}slugs with chroma bg removed: {fixed} | png files: {fixed_files}")


if __name__ == "__main__":
    main()
