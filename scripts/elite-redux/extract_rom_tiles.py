#!/usr/bin/env python
# =============================================================================
# Extract GBA 4bpp tile graphics from a region of the ROM into PNGs.
#
# GBA stores tiles as 8x8 4-bit-per-pixel chunks; palettes are 16-color RGB555
# (5 bits per channel, packed into 16-bit halfwords). Most of the ROM is
# LZ77-compressed, but raw uncompressed tilesheets exist for character/font
# data, status icons, UI elements.
#
# This script scans the ROM for plausible 4bpp tile blocks and dumps them as
# atlas PNGs (16 tiles per row, indexed-color). Useful for finding sprites,
# tilesets, and UI elements that need extraction.
#
# Output: vendor/elite-redux/rom-extracted/tiles/region-<hex>.png
#
# Usage: python scripts/elite-redux/extract_rom_tiles.py
#        python scripts/elite-redux/extract_rom_tiles.py --offset 0x400000 --count 1024
# =============================================================================

from __future__ import annotations

import argparse
import os
import struct
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("PIL not installed. Install with: pip install pillow")
    raise SystemExit(1)

ROM_PATH = Path("vendor/elite-redux/rom-extracted/er-v2.65.3b.gba")
OUT_DIR = Path("vendor/elite-redux/rom-extracted/tiles")

# Default 16-color grayscale palette (used when no palette is known).
DEFAULT_PALETTE = []
for i in range(16):
    v = i * 17  # 0, 17, 34, ..., 255
    DEFAULT_PALETTE.extend([v, v, v])


def decode_4bpp_tile(buf: bytes) -> list[list[int]]:
    """Decode a 32-byte 4bpp tile (8x8) into an 8-row list of 8 pixel indices."""
    rows = []
    for r in range(8):
        row = []
        for c in range(4):
            b = buf[r * 4 + c]
            row.append(b & 0xF)
            row.append((b >> 4) & 0xF)
        rows.append(row)
    return rows


def build_atlas(rom: bytes, offset: int, tile_count: int, tiles_per_row: int = 16) -> Image.Image:
    rows = (tile_count + tiles_per_row - 1) // tiles_per_row
    img = Image.new("P", (tiles_per_row * 8, rows * 8))
    img.putpalette(DEFAULT_PALETTE)
    pixels = img.load()
    for i in range(tile_count):
        tile_offset = offset + i * 32
        if tile_offset + 32 > len(rom):
            break
        tile = decode_4bpp_tile(rom[tile_offset:tile_offset + 32])
        tx = (i % tiles_per_row) * 8
        ty = (i // tiles_per_row) * 8
        for r in range(8):
            for c in range(8):
                pixels[tx + c, ty + r] = tile[r][c]
    return img


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offset", type=lambda x: int(x, 0), default=0x300000)
    parser.add_argument("--count", type=int, default=512)
    parser.add_argument("--tiles-per-row", type=int, default=16)
    parser.add_argument("--scan", action="store_true", help="Dump multiple regions")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rom = ROM_PATH.read_bytes()
    print(f"ROM: {len(rom):,} bytes")

    if args.scan:
        # Sample 8 regions across the ROM.
        for offset in [0x200000, 0x400000, 0x600000, 0x800000, 0xA00000, 0xC00000, 0xE00000, 0x1000000]:
            if offset >= len(rom):
                continue
            img = build_atlas(rom, offset, args.count, args.tiles_per_row)
            out = OUT_DIR / f"region-{offset:08x}.png"
            img.save(out)
            print(f"  Wrote {out}")
    else:
        img = build_atlas(rom, args.offset, args.count, args.tiles_per_row)
        out = OUT_DIR / f"region-{args.offset:08x}.png"
        img.save(out)
        print(f"Wrote {out}")


if __name__ == "__main__":
    main()
