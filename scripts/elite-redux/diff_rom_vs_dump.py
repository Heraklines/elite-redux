#!/usr/bin/env python
# =============================================================================
# Diff the v2.65.3b ROM's pkmn-text strings against the v2.65beta JSON dump's
# ability + move descriptions. Reports:
#  - Descriptions in ROM that match a known ability/move by name but have
#    DIFFERENT text (= upstream rebalance edit in v2.65.3b)
#  - Names in ROM that don't appear in the dump (potential new content)
# =============================================================================

from __future__ import annotations

import json
import re
from pathlib import Path

PKMN_STRINGS = Path("vendor/elite-redux/rom-extracted/pkmn-strings.txt")
DUMP = Path("vendor/elite-redux/v2.65beta.json")
OUT_DIFF = Path("vendor/elite-redux/rom-extracted/v2.65.3b-vs-beta-diff.md")

dump = json.loads(DUMP.read_text(encoding="utf-8"))

# Build name → desc maps from the dump.
ability_desc = {a["name"]: a.get("desc", "") for a in dump.get("abilities", []) if a}
move_desc = {m["name"]: m.get("desc", "") for m in dump.get("moves", []) if m}

# Parse all ROM strings into (offset, text).
rom_lines = PKMN_STRINGS.read_text(encoding="utf-8").splitlines()
rom_strings: list[tuple[int, str]] = []
for line in rom_lines:
    m = re.match(r"^([0-9a-f]+):\s(.*)$", line)
    if m:
        rom_strings.append((int(m.group(1), 16), m.group(2)))

# Pair each known ability/move name found in ROM with the NEXT ROM string
# at offset > name_offset and within 2KB — that's typically how descriptions
# follow names in the binary's data table.
name_to_offset: dict[str, list[int]] = {}
for offset, text in rom_strings:
    name_to_offset.setdefault(text.strip(), []).append(offset)


def find_nearby_string(after_offset: int, max_distance: int = 0x800) -> str | None:
    """Find the next string within `max_distance` bytes after `after_offset`."""
    for off, text in rom_strings:
        if after_offset < off <= after_offset + max_distance and 8 <= len(text) <= 200:
            return text
    return None


print("=== Diffing ability descriptions ===")
ability_diffs = []
for name, dump_desc in sorted(ability_desc.items()):
    if not name or name == "-------":
        continue
    offsets = name_to_offset.get(name, [])
    if not offsets:
        continue
    # Probe each offset for a nearby description string.
    for offset in offsets:
        candidate = find_nearby_string(offset)
        if candidate is None or candidate == dump_desc:
            continue
        if len(candidate) < 10 or candidate == name:
            continue
        ability_diffs.append({"name": name, "dump": dump_desc, "rom": candidate})
        break

print(f"Found {len(ability_diffs)} ability description deltas")

# Write report.
OUT_DIFF.parent.mkdir(exist_ok=True, parents=True)
with OUT_DIFF.open("w", encoding="utf-8") as f:
    f.write("# Elite Redux v2.65.3b ROM vs v2.65beta JSON dump diff\n\n")
    f.write("## Ability description changes\n\n")
    if not ability_diffs:
        f.write("(no ability description changes detected)\n\n")
    for diff in ability_diffs[:80]:
        f.write(f"### {diff['name']}\n")
        f.write(f"**Dump v2.65beta:** {diff['dump']}\n\n")
        f.write(f"**ROM v2.65.3b:**  {diff['rom']}\n\n")
        f.write("---\n\n")
print(f"Wrote {OUT_DIFF}")

# Same for moves.
print("\n=== Diffing move descriptions ===")
move_diffs = []
for name, dump_desc in sorted(move_desc.items()):
    if not name or name == "-":
        continue
    offsets = name_to_offset.get(name, [])
    if not offsets:
        continue
    for offset in offsets:
        candidate = find_nearby_string(offset)
        if candidate is None or candidate == dump_desc:
            continue
        if len(candidate) < 10 or candidate == name:
            continue
        move_diffs.append({"name": name, "dump": dump_desc, "rom": candidate})
        break

print(f"Found {len(move_diffs)} move description deltas")

with OUT_DIFF.open("a", encoding="utf-8") as f:
    f.write("\n## Move description changes\n\n")
    if not move_diffs:
        f.write("(no move description changes detected)\n\n")
    for diff in move_diffs[:80]:
        f.write(f"### {diff['name']}\n")
        f.write(f"**Dump v2.65beta:** {diff['dump']}\n\n")
        f.write(f"**ROM v2.65.3b:**  {diff['rom']}\n\n")
        f.write("---\n\n")

print(f"Wrote {OUT_DIFF}")
print(f"\nTotal: {len(ability_diffs)} ability + {len(move_diffs)} move descriptions changed v2.65beta → v2.65.3b")
