#!/usr/bin/env python
# =============================================================================
# Elite Redux ROM graphics extractor.
#
# Scans the ROM for LZ77-compressed graphics blocks (GBA bios decompressor
# header 0x10 followed by 24-bit decompressed-length). Decompresses each
# valid block and writes raw 4bpp tile data to a per-offset file.
#
# Then renders each into a 16-color PNG tile atlas (no palette known, uses
# greyscale).
#
# Usage:
#   python scripts/elite-redux/extract_rom_graphics.py
# =============================================================================

from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

ROM_PATH = Path("vendor/elite-redux/rom-extracted/er-v2.65.3b.gba")
OUT_DIR = Path("vendor/elite-redux/rom-extracted/graphics")
TILES_PER_ROW = 16


def lz77_decompress(rom: bytes, offset: int) -> bytes | None:
    """Decompress an LZ77 block starting at offset. Returns None if invalid."""
    if offset + 4 > len(rom):
        return None
    header = rom[offset]
    if header != 0x10:
        return None
    decomp_size = rom[offset + 1] | (rom[offset + 2] << 8) | (rom[offset + 3] << 16)
    if decomp_size == 0 or decomp_size > 0x40000:  # cap at 256KB
        return None
    out = bytearray()
    pos = offset + 4
    try:
        while len(out) < decomp_size:
            if pos >= len(rom):
                return None
            flag = rom[pos]
            pos += 1
            for bit in range(8):
                if len(out) >= decomp_size:
                    break
                if pos >= len(rom):
                    return None
                if flag & (0x80 >> bit):
                    # compressed: 16-bit (disp + len)
                    if pos + 1 >= len(rom):
                        return None
                    b1 = rom[pos]
                    b2 = rom[pos + 1]
                    pos += 2
                    length = (b1 >> 4) + 3
                    disp = ((b1 & 0x0F) << 8) | b2
                    src = len(out) - disp - 1
                    if src < 0:
                        return None
                    for _ in range(length):
                        out.append(out[src])
                        src += 1
                else:
                    # raw byte
                    out.append(rom[pos])
                    pos += 1
        return bytes(out[:decomp_size])
    except (IndexError, ValueError):
        return None


def render_4bpp_pgm(tiles_4bpp: bytes, path: Path) -> None:
    """Render raw 4bpp GBA tile data as a greyscale PGM tile atlas."""
    # GBA 4bpp: 32 bytes/tile, 8x8 pixels, two pixels per byte (low nibble = left)
    tile_count = len(tiles_4bpp) // 32
    if tile_count == 0:
        return
    rows = (tile_count + TILES_PER_ROW - 1) // TILES_PER_ROW
    width = TILES_PER_ROW * 8
    height = rows * 8
    img = bytearray(width * height)
    for t in range(tile_count):
        row = t // TILES_PER_ROW
        col = t % TILES_PER_ROW
        for y in range(8):
            for x in range(0, 8, 2):
                b = tiles_4bpp[t * 32 + y * 4 + x // 2]
                lo = b & 0x0F
                hi = (b >> 4) & 0x0F
                # Map 0-15 to 0-255 greyscale.
                px_lo = lo * 17
                px_hi = hi * 17
                px = (row * 8 + y) * width + (col * 8 + x)
                img[px] = px_lo
                img[px + 1] = px_hi
    with path.open("wb") as f:
        f.write(f"P5\n{width} {height}\n255\n".encode("ascii"))
        f.write(img)


def main() -> int:
    if not ROM_PATH.exists():
        print(f"ROM not found: {ROM_PATH}", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    rom = ROM_PATH.read_bytes()
    print(f"Read {len(rom):,} bytes")

    found = 0
    sizes: list[int] = []
    # Scan every 4-byte boundary for 0x10 LZ77 headers.
    for off in range(0, len(rom) - 4, 4):
        if rom[off] != 0x10:
            continue
        size = rom[off + 1] | (rom[off + 2] << 8) | (rom[off + 3] << 16)
        # Only consider plausible tile data (multiple of 32 bytes, reasonable size).
        if size == 0 or size % 32 != 0 or size < 64 or size > 0x4000:
            continue
        data = lz77_decompress(rom, off)
        if data is None or len(data) != size:
            continue
        # Reject all-zero or near-zero entropy.
        nonzero = sum(1 for b in data if b != 0)
        if nonzero < len(data) // 4:
            continue
        out_path = OUT_DIR / f"gfx_0x{off:08x}.4bpp"
        out_path.write_bytes(data)
        # Also render greyscale PGM atlas (no palette).
        render_4bpp_pgm(data, OUT_DIR / f"gfx_0x{off:08x}.pgm")
        sizes.append(size)
        found += 1
        if found % 100 == 0:
            print(f"  ...{found} decompressed (latest @ {off:#x}, {size} bytes)")
        if found >= 2000:
            print("(stopping at 2000 blocks)")
            break

    print(f"\nDecompressed {found} LZ77 graphics blocks")
    if sizes:
        print(f"  Size range: {min(sizes)} - {max(sizes)} bytes")
        print(f"  Total: {sum(sizes):,} bytes uncompressed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
