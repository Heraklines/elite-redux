# SPDX-FileCopyrightText: 2024-2026 Pagefault Games
# SPDX-License-Identifier: AGPL-3.0-only
"""Append ER status-tag labels (bleed / frostbite / fear) to the in-combat
`statuses` atlas so they render in the HP-bar status slot exactly like the
vanilla PSN/BRN/PAR labels.

The vanilla labels are 20x8 colored pixel text. We render matching 8px labels
with a hand-built 3x5 pixel font: white glyphs over a 1px colored drop-shadow
in the status's theme color. Idempotent: re-running won't duplicate frames.

Run: python scripts/elite_redux/build_er_status_icons.py
"""

import json
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PNG = os.path.join(ROOT, "assets", "images", "statuses.png")
JSON = os.path.join(ROOT, "assets", "images", "statuses.json")

ROW_H = 8
LABEL_W = 20

# 3x5 pixel glyphs (rows top->bottom, "1" = lit).
FONT = {
    "B": ["110", "101", "110", "101", "110"],
    "L": ["100", "100", "100", "100", "111"],
    "D": ["110", "101", "101", "101", "110"],
    "F": ["111", "100", "110", "100", "100"],
    "R": ["110", "101", "110", "110", "101"],
    "E": ["111", "100", "110", "100", "111"],
    "A": ["010", "101", "111", "101", "101"],
    "T": ["111", "010", "010", "010", "010"],
    "S": ["011", "100", "010", "001", "110"],
}

WHITE = (248, 248, 248, 255)

# (frame name, 3-letter label, theme/shadow color)
NEW = [
    ("bleed", "BLD", (200, 40, 56)),
    ("frostbite", "FRB", (96, 184, 232)),
    ("fear", "FER", (176, 96, 208)),
]


def render_label(text: str, color: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (LABEL_W, ROW_H), (0, 0, 0, 0))
    px = img.load()
    shadow = (*color, 255)
    # 3 glyphs * 3px + 2 gaps = 11px; center in 20px.
    total = len(text) * 3 + (len(text) - 1)
    x0 = (LABEL_W - total) // 2
    y0 = 1
    for i, ch in enumerate(text):
        glyph = FONT[ch]
        gx = x0 + i * 4
        for ry, row in enumerate(glyph):
            for rx, bit in enumerate(row):
                if bit == "1":
                    x, y = gx + rx, y0 + ry
                    # drop-shadow first (down-right), then white on top
                    if x + 1 < LABEL_W and y + 1 < ROW_H:
                        px[x + 1, y + 1] = shadow
    for i, ch in enumerate(text):
        glyph = FONT[ch]
        gx = x0 + i * 4
        for ry, row in enumerate(glyph):
            for rx, bit in enumerate(row):
                if bit == "1":
                    px[gx + rx, y0 + ry] = WHITE
    return img


def main() -> None:
    meta = json.load(open(JSON, encoding="utf-8"))
    tex = meta["textures"][0]
    existing = {f["filename"] for f in tex["frames"]}
    todo = [n for n in NEW if n[0] not in existing]
    if not todo:
        print("statuses atlas already has ER status labels; nothing to do.")
        return

    base = Image.open(PNG).convert("RGBA")
    w, h = base.size
    new_h = h + ROW_H * len(todo)
    canvas = Image.new("RGBA", (w, new_h), (0, 0, 0, 0))
    canvas.paste(base, (0, 0))

    y = h
    for name, text, color in todo:
        label = render_label(text, color)
        canvas.paste(label, (0, y))
        tex["frames"].append(
            {
                "filename": name,
                "rotated": False,
                "trimmed": False,
                "sourceSize": {"w": LABEL_W, "h": ROW_H},
                "spriteSourceSize": {"x": 0, "y": 0, "w": LABEL_W, "h": ROW_H},
                "frame": {"x": 0, "y": y, "w": LABEL_W, "h": ROW_H},
            }
        )
        y += ROW_H

    tex["size"] = {"w": w, "h": new_h}
    canvas.save(PNG)
    json.dump(meta, open(JSON, "w", encoding="utf-8"), indent="\t")
    print(f"appended {[n[0] for n in todo]} to statuses atlas ({w}x{new_h})")


if __name__ == "__main__":
    main()
