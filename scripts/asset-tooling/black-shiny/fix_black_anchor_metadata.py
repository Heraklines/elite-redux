# =============================================================================
# ER Black Shiny (#349) - anchor metadata migration (scheme 1 -> 2).
#
# Scheme 1 (original generator output): sourceSize grown by PADDING on each
# side, spriteSourceSize offsets unchanged. Correct for CENTER-anchored
# rendering, but pokerogue battle sprites are BOTTOM-anchored (origin 0.5,1),
# so black battle sprites floated PADDING px (16) too high.
#
# Scheme 2: sourceSize = the ORIGINAL sprite geometry; the halo overflows the
# source box via negative trim offsets (spriteSourceSize x/y - PADDING). The
# mon renders exactly where the base sprite does under ANY anchor. PNGs are
# untouched - this is a JSON-only rewrite.
#
# Usage: python fix_black_anchor_metadata.py <er-assets>/images/pokemon/black
# Idempotent: atlases carrying the "erAnchor": 2 marker are skipped.
# =============================================================================

import json
import os
import sys

PADDING = 16


def fix_atlas(path: str) -> bool:
    with open(path, encoding="utf-8") as f:
        atlas = json.load(f)
    if atlas.get("erAnchor") == 2:
        return False
    for tex in atlas.get("textures", []):
        for fr in tex.get("frames", []):
            fr["sourceSize"] = {
                "w": fr["sourceSize"]["w"] - 2 * PADDING,
                "h": fr["sourceSize"]["h"] - 2 * PADDING,
            }
            fr["spriteSourceSize"]["x"] -= PADDING
            fr["spriteSourceSize"]["y"] -= PADDING
    atlas["erAnchor"] = 2
    # Re-key so the marker leads (cosmetic only).
    out = {"erAnchor": 2, **{k: v for k, v in atlas.items() if k != "erAnchor"}}
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, separators=(",", ":"))
    return True


def main() -> None:
    root = sys.argv[1]
    fixed = skipped = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith(".json"):
                continue
            if fix_atlas(os.path.join(dirpath, name)):
                fixed += 1
            else:
                skipped += 1
    print(f"fixed {fixed}, already-current {skipped}")


if __name__ == "__main__":
    main()
