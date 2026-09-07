"""Remote-only bounded excerpts of one immutable upstream source blob; no game qualification."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

REPO = "Heraklines/elite-redux"
PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
PATH = "src/data/elite-redux/moody/moody-runtime-game-adapter.ts"
OID = "9f336d8e09e5472a7873b30deed59645783eb88b"
BRANCH = "codex/m9e-xp-coordinator-source-20260907"
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-xp-coordinator-source"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    require(os.environ.get("GITHUB_REPOSITORY") == REPO
            and os.environ.get("GITHUB_REF") == "refs/heads/" + BRANCH,
            "exact source-only branch required")
    require(not OUT.exists(), "fresh owned output required")
    OUT.mkdir()
    receipt = {"status": "failed", "qualification": "source inspection only; no runtime tests",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "oracle_sha": PIN, "path": PATH, "git_blob": OID}
    try:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/git/blobs/{OID}",
            headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                     "User-Agent": "m9e-bounded-source-inspection",
                     "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                require(response.status == 200, "unexpected source API status")
                body = response.read((2 << 20) + 1)
            require(len(body) <= 2 << 20, "source API response exceeds bound")
        except Exception:
            raise RuntimeError("bounded immutable source request failed") from None
        value = json.loads(body)
        require(value.get("sha") == OID and value.get("encoding") == "base64"
                and type(value.get("size")) is int and 0 < value["size"] <= 1 << 20,
                "immutable source metadata differs")
        raw = base64.b64decode("".join(value["content"].splitlines()), validate=True)
        require(len(raw) == value["size"]
                and hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest() == OID,
                "actual source blob differs")
        lines = raw.decode("utf-8").splitlines(keepends=True)
        matches = [i for i, line in enumerate(lines) if re.search(r"experience|\bexp\b|expMultiplier", line, re.I)]
        require(1 <= len(matches) <= 80, "review exact source selector before expanding")
        selected = set(range(min(80, len(lines))))
        for index in matches:
            selected.update(range(max(0, index - 24), min(len(lines), index + 42)))
        indices = sorted(selected)
        groups = []
        for index in indices:
            if not groups or index != groups[-1][-1] + 1:
                groups.append([])
            groups[-1].append(index)
        excerpt = "".join(
            f"\n// {PATH}: lines {group[0] + 1}-{group[-1] + 1}\n"
            + "".join(f"{i + 1:05d}: {lines[i]}" for i in group) for group in groups).encode()
        require(len(excerpt) <= 49152, "selected source excerpts exceed local routine bound")
        (OUT / "source-excerpt.txt").write_bytes(excerpt)
        receipt.update(status="passed", bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                       total_lines=len(lines), matched_lines=[i + 1 for i in matches],
                       ranges=[[group[0] + 1, group[-1] + 1] for group in groups],
                       excerpt_bytes=len(excerpt), excerpt_sha256=hashlib.sha256(excerpt).hexdigest())
        receipt["producer"] = {"sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        receipt["workflow"] = {"sha256": hashlib.sha256(
            (ROOT / ".github/workflows/m9e-xp-coordinator-source.yml").read_bytes()).hexdigest()}
    except Exception as error:
        receipt["failure"] = str(error)[:512] if isinstance(error, RuntimeError) else "bounded source inspection failed"
    finally:
        encoded = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
        require(len(encoded) <= 8192, "compact source receipt bound")
        (OUT / "receipt.json").write_bytes(encoded)
    require(receipt["status"] == "passed", "source inspection failed; see compact receipt")


if __name__ == "__main__":
    main()
