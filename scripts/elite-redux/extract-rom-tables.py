#!/usr/bin/env python
# =============================================================================
# Elite Redux ROM — extract NAME→DESCRIPTION tables via pointer-table scan.
#
# Strategy:
#   1. Find ASCII/pkmn-text strings of plausible ability/move names.
#   2. Find their offsets in ROM.
#   3. Scan for ARM-ROM-pointer (uint32_LE, MSB ≈ 0x08) at every 4-byte
#      boundary, looking for tables where N consecutive pointers each
#      resolve to a string offset that, when paired with its NEXT string
#      in the strings file, gives a coherent (name, description) pair.
#
# Output:
#   vendor/elite-redux/rom-extracted/extracted-ability-table.json
#   vendor/elite-redux/rom-extracted/extracted-move-table.json
# =============================================================================

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

ROM_PATH = Path("vendor/elite-redux/rom-extracted/er-v2.65.3b.gba")
OUT_DIR = Path("vendor/elite-redux/rom-extracted")

ROM_BASE = 0x08000000

def main() -> int:
    if not ROM_PATH.exists():
        print(f"ROM not found: {ROM_PATH}", file=sys.stderr)
        return 1
    rom = ROM_PATH.read_bytes()
    print(f"Read {len(rom):,} bytes")

    # Load the JSON dump to know ability/move name lists.
    dump_path = Path("vendor/elite-redux/v2.65beta.json")
    if not dump_path.exists():
        print(f"Need {dump_path} for known-name list", file=sys.stderr)
        return 1
    dump = json.loads(dump_path.read_text(encoding="utf-8"))
    ability_names = [a.get("name", "") for a in dump.get("abilities", [])]
    move_names = [m.get("name", "") for m in dump.get("moves", [])]
    print(f"Known abilities: {len(ability_names)}, moves: {len(move_names)}")

    # Pokemon-Emerald text encoder so we can search for raw byte strings.
    def encode_pkmn(s: str) -> bytes:
        out = bytearray()
        for c in s:
            if c == "'": out.append(0xB4)
            elif c == " ": out.append(0x00)
            elif "A" <= c <= "Z": out.append(0xBB + (ord(c) - ord("A")))
            elif "a" <= c <= "z": out.append(0xD5 + (ord(c) - ord("a")))
            elif c == "-": out.append(0xAE)
            elif c == ".": out.append(0xAD)
            elif c == ",": out.append(0xB8)
            elif c == "!": out.append(0xAB)
            elif c == "?": out.append(0xAC)
            elif c == "/": out.append(0xBA)
            else:
                return b""  # unsupported char
        out.append(0xFF)  # terminator
        return bytes(out)

    # For each ability name, find ALL byte-offsets in the ROM where the
    # encoded name appears (as a complete pkmn-text string ending with 0xFF).
    print("\n=== Locating ability name byte-offsets ===")
    name_offsets: dict[str, list[int]] = {}
    found_count = 0
    for name in ability_names:
        if not name or name.startswith("-"):
            continue
        encoded = encode_pkmn(name)
        if not encoded:
            continue
        offsets: list[int] = []
        start = 0
        while True:
            idx = rom.find(encoded, start)
            if idx == -1:
                break
            offsets.append(idx)
            start = idx + 1
        if offsets:
            name_offsets[name] = offsets
            found_count += 1
    print(f"  Located {found_count}/{sum(1 for n in ability_names if n)} ability name offsets")

    # For each move name, same.
    print("=== Locating move name byte-offsets ===")
    move_offsets: dict[str, list[int]] = {}
    found_move = 0
    for name in move_names:
        if not name or name.startswith("-"):
            continue
        encoded = encode_pkmn(name)
        if not encoded:
            continue
        offsets: list[int] = []
        start = 0
        while True:
            idx = rom.find(encoded, start)
            if idx == -1:
                break
            offsets.append(idx)
            start = idx + 1
        if offsets:
            move_offsets[name] = offsets
            found_move += 1
    print(f"  Located {found_move}/{sum(1 for m in move_names if m)} move name offsets")

    # Look for the AbilityNames pointer table: a sequence of 32-bit pointers
    # where each pointer maps to a known-ability-name offset.
    # Pointer is (offset | 0x08000000).
    print("\n=== Scanning for AbilityNames pointer table ===")
    all_ability_offset_set = {off for offs in name_offsets.values() for off in offs}

    best_table_start = -1
    best_table_count = 0
    for table_start in range(0, len(rom) - 4 * 200, 4):
        # Read up to 200 consecutive pointers at this offset
        match_count = 0
        for i in range(200):
            p_off = table_start + i * 4
            if p_off + 4 > len(rom):
                break
            ptr = struct.unpack_from("<I", rom, p_off)[0]
            if ptr < ROM_BASE or ptr > ROM_BASE + len(rom):
                break  # not a ROM pointer, stop chain
            target = ptr - ROM_BASE
            if target in all_ability_offset_set:
                match_count += 1
            else:
                # non-name target — break unless this is a 0xFFFFFFFF separator
                if match_count == 0:
                    break
                # else: stop; we have a table candidate of length match_count
                break
        if match_count > best_table_count:
            best_table_count = match_count
            best_table_start = table_start
            if match_count >= 100:
                print(f"  Strong candidate @ {table_start:#x}: {match_count} name ptrs")

    if best_table_start >= 0:
        print(f"  Best table: @ {best_table_start:#x} with {best_table_count} name pointers")

        # Read the table and decode names.
        extracted: list[tuple[int, int, str]] = []
        for i in range(best_table_count + 5):
            p_off = best_table_start + i * 4
            ptr = struct.unpack_from("<I", rom, p_off)[0]
            if ptr < ROM_BASE or ptr > ROM_BASE + len(rom):
                break
            target = ptr - ROM_BASE
            # decode name at target
            end = rom.find(b"\xff", target, min(target + 64, len(rom)))
            if end == -1:
                break
            # Try decode
            from decimal import Decimal
            decoded = []
            ok = True
            for b in rom[target:end]:
                if 0xBB <= b <= 0xD4:
                    decoded.append(chr(ord("A") + b - 0xBB))
                elif 0xD5 <= b <= 0xEE:
                    decoded.append(chr(ord("a") + b - 0xD5))
                elif b == 0x00:
                    decoded.append(" ")
                elif b == 0xB4:
                    decoded.append("'")
                elif b == 0xAE:
                    decoded.append("-")
                else:
                    ok = False
                    break
            if not ok:
                break
            extracted.append((i, target, "".join(decoded)))
        print(f"  Extracted {len(extracted)} names from the table:")
        for i, tgt, name in extracted[:10]:
            print(f"    [{i:4d}] @0x{tgt:08x}: {name}")
        if len(extracted) > 10:
            print(f"    ... ({len(extracted) - 10} more)")

        # Save the table.
        with (OUT_DIR / "ability-name-table.json").open("w", encoding="utf-8") as f:
            json.dump([{"index": i, "offset": tgt, "name": name}
                       for i, tgt, name in extracted], f, indent=2)
        print(f"  Wrote ability-name-table.json")
    else:
        print("  No table found.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
