# Upload generated black-shiny atlases to Heraklines/er-assets via the GitHub
# contents API (no clone needed). Prints the final commit SHA for _redirects.
#
# Usage: GH_TOKEN env must be set.
#   python upload_to_er_assets.py <local-dir>
# Files in <local-dir>/{*.png,*.json} -> images/pokemon/black/...
# Files in <local-dir>/back/...      -> images/pokemon/black/back/...
import base64
import io
import json
import os
import sys
import urllib.request

REPO = "Heraklines/er-assets"
TOKEN = os.environ["GH_TOKEN"].strip()


def api(method, path, body=None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=json.dumps(body).encode() if body else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "er-black-shiny-upload",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or "{}"), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or "{}"), e.code


def upload(local, remote):
    with open(local, "rb") as f:
        content = base64.b64encode(f.read()).decode()
    # Need the existing sha to overwrite.
    existing, status = api("GET", f"/repos/{REPO}/contents/{remote}")
    body = {"message": f"black-shiny: {remote} (#349 t4 pipeline)", "content": content}
    if status == 200 and isinstance(existing, dict) and existing.get("sha"):
        body["sha"] = existing["sha"]
    resp, status = api("PUT", f"/repos/{REPO}/contents/{remote}", body)
    if status not in (200, 201):
        print("FAILED", remote, status, str(resp)[:200])
        sys.exit(1)
    sha = resp.get("commit", {}).get("sha", "?")
    print("uploaded", remote, "->", sha[:12])
    return sha


def main():
    src = sys.argv[1]
    last = None
    for sub, prefix in [("", "images/pokemon/black"), ("back", "images/pokemon/black/back")]:
        d = os.path.join(src, sub) if sub else src
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            full = os.path.join(d, name)
            if not os.path.isfile(full) or not (name.endswith(".png") or name.endswith(".json")):
                continue
            last = upload(full, f"{prefix}/{name}")
    print("FINAL_COMMIT_SHA", last)


if __name__ == "__main__":
    main()
