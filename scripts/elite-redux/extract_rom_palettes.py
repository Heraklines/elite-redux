#!/usr/bin/env python
# =============================================================================
# Elite Redux ROM — extract GBA palette tables (16-color, RGB555).
#
# A GBA 16-color palette is 32 bytes (16 × 2-byte RGB555). Tables of
# palettes are stored contiguously. Heuristics for detecting palettes:
#   - All values must be valid RGB555 (high bit clear in each 16-bit word)
#   - At least N distinct colors
#   - Avoid all-zero / all-FF blocks (terminators)
#
# Output: vendor/elite-redux/rom-extracted/palettes/
#   - pal_0xXXXXXXXX.gpl (Gimp Palette format)
#
# Usage: python scripts/elite-redux/extract_rom_palettes.py
# =============================================================================

from __future__ import annotations

import sys
from pathlib import Path

ROM_PATH = Path("vendor/elite-redux/rom-extracted/er-v2.65.3b.gba")
OUT_DIR = Path("vendor/elite-redux/rom-extracted/palettes")


def rgb555_to_rgb888(v: int) -> tuple[int, int, int]:
    r = v & 0x1F
    g = (v >> 5) & 0x1F
    b = (v >> 10) & 0x1F
    # Expand 5 → 8 bits
    return (r << 3 | r >> 2, g << 3 | g >> 2, b << 3 | b >> 2)


def main() -> int:
    if not ROM_PATH.exists():
        print(f"ROM not found: {ROM_PATH}", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rom = ROM_PATH.read_bytes()

    found = 0
    palettes_seen = set()
    for off in range(0, len(rom) - 32, 4):
        # Read 16 16-bit RGB555 words.
        words = [rom[off + i] | (rom[off + i + 1] << 8) for i in range(0, 32, 2)]
        # All words must have high bit clear (valid RGB555).
        if any(w & 0x8000 for w in words):
            continue
        # Must have at least 6 distinct colors (avoid mostly-zero).
        distinct = len(set(words))
        if distinct < 6:
            continue
        # Avoid duplicate palettes.
        sig = tuple(words)
        if sig in palettes_seen:
            continue
        palettes_seen.add(sig)
        # Heuristic: skip if too many words are 0xFFFF (likely text/ASCII).
        if sum(1 for w in words if w == 0xFFFF) > 8:
            continue
        # Save as GIMP .gpl
        if found < 500:  # cap at 500 palettes
            with (OUT_DIR / f"pal_0x{off:08x}.gpl").open("w", encoding="ascii") as f:
                f.write(f"GIMP Palette\nName: ER_pal_{off:08x}\nColumns: 16\n#\n")
                for w in words:
                    r, g, b = rgb555_to_rgb888(w)
                    f.write(f"{r:3d} {g:3d} {b:3d}\tColor_{w:04x}\n")
        found += 1
        if found % 1000 == 0:
            print(f"  ... {found} palette candidates so far @ {off:#x}")
        if found >= 5000:
            print("(stopping at 5000)")
            break

    print(f"\nFound {found} unique palette candidates (saved first 500)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
