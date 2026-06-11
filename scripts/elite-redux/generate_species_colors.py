"""Generate src/data/elite-redux/er-species-colors.ts from the vendor dump.

Every ER species (vanilla, custom, Redux) carries an OFFICIAL dex color in
the ROM data (species[].stats.col, decoded via top-level colT). The monocolor
challenge (#388) uses this as its single source of truth - no palette
heuristics. Re-run after a vendor dump update:
    python scripts/elite-redux/generate_species_colors.py
"""

import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
VENDOR = os.path.join(ROOT, "vendor", "elite-redux", "v2.65beta.json")
OUT = os.path.join(ROOT, "src", "data", "elite-redux", "er-species-colors.ts")


def main() -> None:
    with open(VENDOR, encoding="utf-8") as f:
        d = json.load(f)
    col_t = d["colT"]
    # Dedupe by ER species id (forms can share an id) - first entry wins.
    by_id: dict[int, int] = {}
    for sp in d["species"]:
        col = (sp.get("stats") or {}).get("col")
        sid = sp.get("id")
        if isinstance(col, int) and isinstance(sid, int) and sid >= 0 and 0 <= col < len(col_t) and sid not in by_id:
            by_id[sid] = col
    rows = sorted(by_id.items())
    lines = [
        "// =============================================================================",
        "// AUTO-GENERATED FILE - DO NOT EDIT BY HAND.",
        "// Source: vendor/elite-redux/v2.65beta.json (species[].stats.col + colT).",
        "// Regenerate with: python scripts/elite-redux/generate_species_colors.py",
        "//",
        "// Official ROM dex color for EVERY ER species (vanilla, custom, Redux).",
        "// Keyed by ER SPECIES ID - resolve to pokerogue ids via ER_ID_MAP.species.",
        "// =============================================================================",
        "",
        "/** The ten official dex colors, in ROM table order. */",
        "export const ER_COLOR_NAMES = [" + ", ".join(f'"{c}"' for c in col_t) + "] as const;",
        "",
        "export type ErDexColor = (typeof ER_COLOR_NAMES)[number];",
        "",
        "/** ER species id -> index into ER_COLOR_NAMES. */",
        "export const ER_SPECIES_COLORS: Readonly<Record<number, number>> = {",
        "  " + " ".join(f"{sid}: {col}," for sid, col in rows),
        "};",
        "",
    ]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"wrote {len(rows)} species colors -> {OUT}")


if __name__ == "__main__":
    main()
