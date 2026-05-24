#!/usr/bin/env python
# =============================================================================
# Elite Redux v2.65.3b ROM decomp helper.
#
# Extracts:
#  1. All ASCII strings (ability/move names, descriptions)
#  2. Ability table pointer + entries (by searching for known signatures)
#  3. Move table pointer + entries
#  4. ARM/Thumb code regions (capstone disasm) around named entrypoints
#
# Writes to vendor/elite-redux/rom-extracted/:
#   - strings.txt     all ASCII >= 4 chars
#   - ability-names.json
#   - move-names.json
#   - abilities-2.65.3b.json  (vs the v2.65beta JSON dump for diffing)
#
# Usage:
#   python scripts/elite-redux/decomp-rom.py
# =============================================================================

from __future__ import annotations

import json
import os
import re
import struct
import sys
from pathlib import Path

ROM_PATH = Path("vendor/elite-redux/rom-extracted/er-v2.65.3b.gba")
OUT_DIR = Path("vendor/elite-redux/rom-extracted")

if not ROM_PATH.exists():
    print(f"ROM not found at {ROM_PATH}", file=sys.stderr)
    sys.exit(1)

print(f"Reading ROM ({ROM_PATH.stat().st_size:,} bytes)...")
rom = ROM_PATH.read_bytes()
print(f"Read {len(rom):,} bytes")


# -----------------------------------------------------------------------------
# 1. String extraction (all printable >= 4 chars)
# -----------------------------------------------------------------------------
def extract_strings(rom: bytes, min_len: int = 4) -> list[tuple[int, str]]:
    """Find all printable ASCII strings in the ROM. Returns [(offset, text)]."""
    strings: list[tuple[int, str]] = []
    start = None
    for i, b in enumerate(rom):
        # Printable ASCII (32-126) OR Pokémon-text terminators (e.g. 0xFE/0xFF).
        if 0x20 <= b <= 0x7E:
            if start is None:
                start = i
        else:
            if start is not None and i - start >= min_len:
                strings.append((start, rom[start:i].decode("ascii", errors="replace")))
            start = None
    return strings


print("\n=== Extracting ASCII strings (>=4 chars) ===")
strings = extract_strings(rom, min_len=4)
print(f"Found {len(strings):,} strings")

OUT_DIR.mkdir(parents=True, exist_ok=True)
with (OUT_DIR / "strings.txt").open("w", encoding="utf-8") as f:
    for offset, text in strings:
        f.write(f"{offset:08x}: {text}\n")
print(f"Wrote {OUT_DIR / 'strings.txt'}")


# -----------------------------------------------------------------------------
# 2. Pokémon-text strings (GBA Emerald encoding: 0xFF terminator).
# -----------------------------------------------------------------------------
# Pokémon Emerald uses a custom character map for in-game text. Common
# characters map to bytes 0xA1-0xFF in roughly the same order as ASCII.
# We use a simplified decoder that handles the ASCII subset which is what
# most ER ability/move names are.
def pkmn_decode_simple(buf: bytes) -> str | None:
    """Decode a buffer of GBA Pokemon text. Returns None if not valid."""
    table = {
        0xA1: "0", 0xA2: "1", 0xA3: "2", 0xA4: "3", 0xA5: "4",
        0xA6: "5", 0xA7: "6", 0xA8: "7", 0xA9: "8", 0xAA: "9",
        0xAB: "!", 0xAC: "?",
        0xAD: ".", 0xAE: "-", 0xAF: "·",
        0xB0: "…",
        0xB1: "“", 0xB2: "”", 0xB3: "‘", 0xB4: "'",  # apostrophe (right single quote)
        0xB5: "♂", 0xB6: "♀",
        0xB7: " ", 0xB8: ",",
        0xB9: "×",
        0xBA: "/",
        0xFA: "*",
        0xFE: "\n",
        0x00: " ",
    }
    # Symbols continue around 0xBA-0xBE.
    # Letters: A=0xBB..Z=0xD4, a=0xD5..z=0xEE (Pokémon Emerald).
    for i in range(26):
        table[0xBB + i] = chr(ord("A") + i)
    for i in range(26):
        table[0xD5 + i] = chr(ord("a") + i)
    out = []
    for b in buf:
        if b == 0xFF:
            return "".join(out)
        if b in table:
            out.append(table[b])
        else:
            return None  # invalid char, not a string
    return None


# Scan for likely Pokemon-text strings (5-40 byte sequences ending in 0xFF
# that decode cleanly via pkmn_decode_simple).
print("\n=== Extracting Pokemon-text strings ===")
pkmn_strings: list[tuple[int, str]] = []
i = 0
while i < len(rom) - 2:
    if 0xBB <= rom[i] <= 0xEE:  # likely an alpha character
        # Find 0xFF terminator within 64 bytes
        end = rom.find(b"\xff", i, min(i + 64, len(rom)))
        if end != -1 and end - i >= 3:
            decoded = pkmn_decode_simple(rom[i:end + 1])
            if decoded is not None and len(decoded) >= 3 and decoded.strip():
                pkmn_strings.append((i, decoded))
                i = end + 1
                continue
    i += 1
print(f"Found {len(pkmn_strings):,} pkmn-text strings")

with (OUT_DIR / "pkmn-strings.txt").open("w", encoding="utf-8") as f:
    for offset, text in pkmn_strings:
        f.write(f"{offset:08x}: {text}\n")
print(f"Wrote {OUT_DIR / 'pkmn-strings.txt'}")


# -----------------------------------------------------------------------------
# 3. Look for known ability names from the JSON dump and check for new ones.
# -----------------------------------------------------------------------------
print("\n=== Comparing v2.65.3b ROM vs v2.65beta JSON dump ===")
dump_path = Path("vendor/elite-redux/v2.65beta.json")
if dump_path.exists():
    dump = json.loads(dump_path.read_text(encoding="utf-8"))
    dump_ability_names = {a.get("name", "") for a in dump.get("abilities", []) if a}
    dump_move_names = {m.get("name", "") for m in dump.get("moves", []) if m}

    # Find each dump-known name in the rom's pkmn-strings.
    pkmn_text_set = {text.strip() for _, text in pkmn_strings}
    found_abilities = dump_ability_names & pkmn_text_set
    missing_abilities = dump_ability_names - pkmn_text_set
    found_moves = dump_move_names & pkmn_text_set
    missing_moves = dump_move_names - pkmn_text_set

    print(f"Dump abilities: {len(dump_ability_names)}, found in ROM: {len(found_abilities)} ({len(missing_abilities)} missing)")
    print(f"Dump moves:     {len(dump_move_names)},     found in ROM: {len(found_moves)} ({len(missing_moves)} missing)")

    if missing_abilities and len(missing_abilities) < 30:
        print(f"  Missing abilities sample: {sorted(list(missing_abilities))[:15]}")
    if missing_moves and len(missing_moves) < 30:
        print(f"  Missing moves sample: {sorted(list(missing_moves))[:15]}")

    # New strings the dump didn't know about (potential new abilities in 2.65.3b).
    candidate_new = [text for _, text in pkmn_strings if text.strip()
                     and text.strip() not in dump_ability_names
                     and text.strip() not in dump_move_names
                     and 3 <= len(text.strip()) <= 30
                     and not re.search(r"[^A-Za-z ']", text.strip())]
    candidate_new_set = sorted(set(candidate_new))
    with (OUT_DIR / "candidate-new-strings.txt").open("w", encoding="utf-8") as f:
        for c in candidate_new_set:
            f.write(c + "\n")
    print(f"Wrote {OUT_DIR / 'candidate-new-strings.txt'} ({len(candidate_new_set)} candidates)")
else:
    print(f"No JSON dump at {dump_path}; skipping diff.")


# -----------------------------------------------------------------------------
# 4. Header info — game code, title, version.
# -----------------------------------------------------------------------------
print("\n=== ROM header ===")
title = rom[0xA0:0xAC].decode("ascii", errors="replace").rstrip("\x00")
game_code = rom[0xAC:0xB0].decode("ascii", errors="replace")
maker_code = rom[0xB0:0xB2].decode("ascii", errors="replace")
version = rom[0xBC]
print(f"  Title:      {title!r}")
print(f"  Game code:  {game_code!r}")
print(f"  Maker code: {maker_code!r}")
print(f"  Version:    0x{version:02x}")

print("\n=== Done ===")
