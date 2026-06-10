# Regenerate src/data/elite-redux/er-black-sprite-manifest.ts from the actual
# contents of Heraklines/er-assets images/pokemon/black/ (after the
# generate-black-shinies workflow in er-assets lands its commit).
#
# Usage: GH_TOKEN env must be set. Run from the repo root:
#   python scripts/asset-tooling/black-shiny/update_manifest.py
# Then bump the pinned SHA in deploy/cloudflare/_redirects to the er-assets
# commit the workflow printed, commit both, and deploy to staging.
import json
import os
import re
import urllib.request

REPO = "Heraklines/er-assets"
TOKEN = os.environ["GH_TOKEN"].strip()
MANIFEST = "src/data/elite-redux/er-black-sprite-manifest.ts"


def tree():
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/git/trees/main?recursive=1",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "er-black-shiny-manifest",
        },
    )
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
    if data.get("truncated"):
        raise SystemExit("tree truncated - switch to per-directory listing")
    return [e["path"] for e in data["tree"]]


def main():
    fronts, backs = set(), set()
    for p in tree():
        m = re.fullmatch(r"images/pokemon/black/(back/)?(\d+)\.json", p)
        if m:
            (backs if m.group(1) else fronts).add(int(m.group(2)))

    lines = ["  // front"]
    lines += [f'  "{i}",' for i in sorted(fronts)]
    lines += ["  // back"]
    lines += [f'  "back/{i}",' for i in sorted(backs)]
    body = "\n".join(lines)

    with open(MANIFEST, encoding="utf-8") as f:
        src = f.read()
    new = re.sub(
        r"(ER_BLACK_SPRITES: ReadonlySet<string> = new Set\(\[\n).*?(\n\]\);)",
        lambda m: m.group(1) + body + m.group(2),
        src,
        flags=re.S,
    )
    if new == src:
        raise SystemExit("manifest pattern not found / unchanged")
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        f.write(new)
    print(f"manifest updated: {len(fronts)} fronts, {len(backs)} backs")


if __name__ == "__main__":
    main()
