"""Build recolored vitamin-bottle icons for ER's custom consumables.

Takes the existing `protein` item sprite (a red-liquid vitamin bottle) and
produces two recolors:
  - `move_slot_expander`  -> black liquid  (5th move slot consumable)
  - `ability_randomizer`  -> violet liquid (ability randomizer consumable)

Also builds the #387/#392 community item icons:
  - `frostbite_orb` -> icy-blue recolor of `flame_orb`
  - `dex_nav`       -> green recolor of `scanner` (the IV Scanner device)
  - `omni_gem`      -> WHITE recolor of the ROM hack's elemental `gem.png`
                       (vendor icon, 24x24, padded centered into a 32x32 frame)

The recolored 32x32 frames are appended to the `items` texture atlas
(items.png + items.json) so the modifier icons can reference them by frame name
via `setTexture("items", iconImage)`. Re-running is idempotent: existing frames
of the same name are replaced in place.
"""

import json
import os

from PIL import Image

ITEMS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "images")
PNG_PATH = os.path.join(ITEMS_DIR, "items.png")
JSON_PATH = os.path.join(ITEMS_DIR, "items.json")
PROTEIN_PATH = os.path.join(ITEMS_DIR, "items", "protein.png")
FLAME_ORB_PATH = os.path.join(ITEMS_DIR, "items", "flame_orb.png")
SCANNER_PATH = os.path.join(ITEMS_DIR, "items", "scanner.png")
ROM_GEM_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "vendor", "elite-redux", "source", "graphics", "items", "icons", "gem.png"
)

# protein's three red-liquid shades (light / mid / dark) -> recolor targets.
RED_LIGHT = (246, 164, 164, 255)
RED_MID = (197, 98, 98, 255)
RED_DARK = (139, 65, 65, 255)

BLACK_MAP = {
    RED_LIGHT: (110, 110, 110, 255),
    RED_MID: (60, 60, 60, 255),
    RED_DARK: (28, 28, 28, 255),
}
VIOLET_MAP = {
    RED_LIGHT: (201, 150, 235, 255),
    RED_MID: (140, 80, 190, 255),
    RED_DARK: (90, 45, 130, 255),
}


# flame_orb's warm fire shades -> icy blues (outline/white highlight kept).
FROSTBITE_MAP = {
    (248, 56, 56, 255): (72, 144, 248, 255),
    (248, 136, 96, 255): (128, 192, 248, 255),
    (248, 136, 136, 255): (152, 204, 248, 255),
    (248, 200, 104, 255): (192, 228, 252, 255),
    (248, 248, 104, 255): (224, 244, 255, 255),
    (240, 192, 184, 255): (216, 232, 248, 255),
}
# scanner's blue casing -> Dex Nav green (screen LEDs/accents kept).
DEX_NAV_MAP = {
    (156, 180, 238, 255): (132, 216, 148, 255),
    (82, 106, 164, 255): (62, 150, 86, 255),
    (41, 65, 115, 255): (30, 104, 52, 255),
    (197, 222, 255, 255): (188, 240, 198, 255),
    (238, 238, 255, 255): (238, 255, 240, 255),
}


def whiten(src: Image.Image) -> Image.Image:
    """Desaturate to a white/silver gem: each pixel becomes a gray at its
    brightest channel's level, keeping the dark outline intact."""
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    src_px = src.load()
    out_px = out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = src_px[x, y]
            if a == 0:
                continue
            v = max(r, g, b)
            out_px[x, y] = (v, v, v, a)
    return out


def pad_center(src: Image.Image, size: int = 32) -> Image.Image:
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(src, ((size - src.width) // 2, (size - src.height) // 2))
    return out


def recolor(src: Image.Image, mapping: dict) -> Image.Image:
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    src_px = src.load()
    out_px = out.load()
    for y in range(src.height):
        for x in range(src.width):
            px = src_px[x, y]
            out_px[x, y] = mapping.get(px, px)
    return out


def add_frame(sheet: Image.Image, atlas: dict, name: str, frame_img: Image.Image) -> Image.Image:
    """Place a 32x32 frame in the atlas, appending a new bottom strip if needed."""
    frames = atlas["textures"][0]["frames"]
    w, h = frame_img.size
    # Reuse an existing same-named frame slot if present (idempotent rebuilds).
    existing = next((f for f in frames if f["filename"] == name), None)
    if existing is not None:
        fx, fy = existing["frame"]["x"], existing["frame"]["y"]
        sheet.paste(frame_img, (fx, fy))
        return sheet
    # Otherwise grow the sheet downward by 32px and drop the frame at the left.
    new_h = sheet.height + h
    grown = Image.new("RGBA", (sheet.width, new_h), (0, 0, 0, 0))
    grown.paste(sheet, (0, 0))
    fx, fy = 0, sheet.height
    grown.paste(frame_img, (fx, fy))
    atlas["textures"][0]["size"]["h"] = new_h
    frames.append(
        {
            "filename": name,
            "rotated": False,
            "trimmed": False,
            "sourceSize": {"w": w, "h": h},
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "frame": {"x": fx, "y": fy, "w": w, "h": h},
        }
    )
    return grown


def main() -> None:
    protein = Image.open(PROTEIN_PATH).convert("RGBA")
    black = recolor(protein, BLACK_MAP)
    violet = recolor(protein, VIOLET_MAP)

    sheet = Image.open(PNG_PATH).convert("RGBA")
    with open(JSON_PATH, encoding="utf-8") as fh:
        atlas = json.load(fh)

    frostbite = recolor(Image.open(FLAME_ORB_PATH).convert("RGBA"), FROSTBITE_MAP)
    dex_nav = recolor(Image.open(SCANNER_PATH).convert("RGBA"), DEX_NAV_MAP)

    sheet = add_frame(sheet, atlas, "move_slot_expander", black)
    sheet = add_frame(sheet, atlas, "ability_randomizer", violet)
    omni_gem = pad_center(whiten(Image.open(ROM_GEM_PATH).convert("RGBA")))

    sheet = add_frame(sheet, atlas, "frostbite_orb", frostbite)
    sheet = add_frame(sheet, atlas, "dex_nav", dex_nav)
    sheet = add_frame(sheet, atlas, "omni_gem", omni_gem)

    sheet.save(PNG_PATH)
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(atlas, fh, indent="\t")
    print("wrote move_slot_expander + ability_randomizer + frostbite_orb + dex_nav + omni_gem frames; sheet now", sheet.size)


if __name__ == "__main__":
    main()
