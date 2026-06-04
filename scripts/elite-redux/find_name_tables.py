#!/usr/bin/env python
# Find inline fixed-width name tables (13-byte slots) by scanning for runs
# of consecutive name-encoded blocks each terminated by 0xFF and padded.

from __future__ import annotations

import json
import sys
from pathlib import Path

ROM_PATH = Path("vendor/elite-redux/rom-extracted/er-v2.65.3b.gba")
OUT_DIR = Path("vendor/elite-redux/rom-extracted")


def decode_pkmn(buf: bytes) -> str | None:
    out = []
    for b in buf:
        if b == 0xFF:
            return "".join(out)
        if 0xBB <= b <= 0xD4:
            out.append(chr(ord("A") + b - 0xBB))
        elif 0xD5 <= b <= 0xEE:
            out.append(chr(ord("a") + b - 0xD5))
        elif b == 0x00:
            out.append(" ")
        elif b == 0xB4:
            out.append("'")
        elif b == 0xAE:
            out.append("-")
        elif b == 0xAD:
            out.append(".")
        else:
            return None
    return None


def scan_table(rom: bytes, slot_width: int) -> list[tuple[int, list[str]]]:
    """Find runs of >= 200 consecutive slot_width-byte slots that each
    decode to a valid pkmn-text string."""
    runs: list[tuple[int, list[str]]] = []
    i = 0
    while i + slot_width * 200 < len(rom):
        # Try slot_width-aligned start
        names: list[str] = []
        j = i
        while j + slot_width <= len(rom):
            decoded = decode_pkmn(rom[j:j + slot_width])
            if decoded is None or not decoded.strip():
                break
            names.append(decoded)
            j += slot_width
        if len(names) >= 200:
            runs.append((i, names))
            i = j  # skip past this run
        else:
            i += 4  # slide forward 4 bytes (ARM alignment)
    return runs


def main() -> int:
    if not ROM_PATH.exists():
        print(f"ROM not found: {ROM_PATH}", file=sys.stderr)
        return 1
    rom = ROM_PATH.read_bytes()
    print(f"Read {len(rom):,} bytes")

    # Common slot widths in Pokemon Emerald: 13 (ability/move name), 17 (move long),
    # 11 (pokemon name).
    for slot_width in (13, 11, 17, 25, 33):
        print(f"\n=== Scanning for {slot_width}-byte name slots ===")
        runs = scan_table(rom, slot_width)
        for start, names in runs:
            print(f"  @ {start:#x}: {len(names)} names, first 5: {names[:5]}")
            # Save the first 1100 names for slots that look like abilities/moves.
            if 13 <= slot_width <= 17 and len(names) >= 500:
                out_path = OUT_DIR / f"inline-names-w{slot_width}-@{start:08x}.json"
                with out_path.open("w", encoding="utf-8") as f:
                    json.dump({"start": start, "slot_width": slot_width, "names": names[:1100]}, f, indent=2)
                print(f"    → wrote {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
