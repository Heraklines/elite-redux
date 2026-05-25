#!/usr/bin/env python
# Parse ER's battle_moves.h to extract canonical move stats (the authoritative
# source). Outputs JSON consumable by the move diff audit.

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SRC = Path("vendor/elite-redux/source/src/data/battle_moves.h")
OUT = Path("vendor/elite-redux/rom-extracted/er-battle-moves.json")


def main() -> int:
    if not SRC.exists():
        print(f"Not found: {SRC}", file=sys.stderr)
        return 1
    text = SRC.read_text(encoding="utf-8", errors="replace")

    # Each move block:
    # [MOVE_XXX] =
    # {
    #     .effect = EFFECT_YYY,
    #     .power = 60,
    #     .type = TYPE_ZZZ,
    #     .accuracy = 100,
    #     .pp = 15,
    #     .secondaryEffectChance = 30,
    #     .target = MOVE_TARGET_SELECTED,
    #     .priority = 0,
    #     .split = SPLIT_PHYSICAL,
    #     .flags = FLAG_X | FLAG_Y,
    # },
    pattern = re.compile(
        r"\[MOVE_([A-Z0-9_]+)\]\s*=\s*\{(.*?)\},\s*",
        re.DOTALL,
    )

    results: list[dict] = []
    for m in pattern.finditer(text):
        name = m.group(1)
        body = m.group(2)

        def find(field: str) -> str | None:
            mm = re.search(rf"\.{field}\s*=\s*([^,\n]+?)\s*(?:,|//|$)", body)
            return mm.group(1).strip() if mm else None

        def find_int(field: str) -> int | None:
            v = find(field)
            if v is None:
                return None
            # Try to parse plain int
            try:
                return int(v)
            except ValueError:
                return None

        # Flags can have #if/#else branches. We prefer the modern GEN_5+ branch
        # if present, else fall back to the only .flags = ... line.
        # First, strip #else/#endif blocks and keep the #if GEN_5 branch:
        cleaned_body = body
        # Strip the #else block + #endif
        cleaned_body = re.sub(r"#else.*?#endif", "", cleaned_body, flags=re.DOTALL)
        # Strip the #if itself (just remove the directive line)
        cleaned_body = re.sub(r"#if\s+[^\n]+\n", "", cleaned_body)
        # Strip any other preproc lines
        cleaned_body = re.sub(r"#(endif|else|ifdef|ifndef)[^\n]*", "", cleaned_body)
        flags_match = re.search(r"\.flags\s*=\s*([^,]+(?:\s*\|\s*[^,|]+)*)\s*,", cleaned_body, re.DOTALL)
        flags_list: list[str] = []
        if flags_match:
            raw = flags_match.group(1)
            for f in raw.split("|"):
                f = f.strip()
                if f.startswith("FLAG_"):
                    flags_list.append(f)
        results.append({
            "name": name,
            "effect": find("effect"),
            "power": find_int("power"),
            "type": find("type"),
            "accuracy": find_int("accuracy"),
            "pp": find_int("pp"),
            "chance": find_int("secondaryEffectChance"),
            "target": find("target"),
            "priority": find_int("priority"),
            "split": find("split"),
            "flags": flags_list,
        })

    print(f"Parsed {len(results)} moves from {SRC}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
