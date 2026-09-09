"""Remote-only named constructor source inspection; no game execution."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.request

PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
OID = "b88d78bbcf0e36c937af4fa30e45e73d7e5aea90"
RAW_SHA = "16a69ee97d552e16ab6bb6bb2504d358a05fcf1ca80a6d53c38a4f3d1910e89f"
PATH = "src/system/game-data.ts"
BRANCH = "codex/m9e-fresh-friendship-source-20260909"
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-fresh-friendship-source"

def require(value, message):
    if not value:
        raise RuntimeError(message)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def main():
    started = time.monotonic()
    require(os.environ.get("GITHUB_REPOSITORY") == "Heraklines/elite-redux"
            and os.environ.get("GITHUB_REF") == "refs/heads/" + BRANCH,
            "exact isolated source branch")
    require(not OUT.exists(), "fresh source output")
    OUT.mkdir()
    receipt = dict(status="failed", oracle_sha=PIN, path=PATH, git_blob=OID,
                   source_sha=os.environ["GITHUB_SHA"], run_id=os.environ["GITHUB_RUN_ID"],
                   run_attempt=os.environ["GITHUB_RUN_ATTEMPT"], qualification="source inspection only")
    try:
        request = urllib.request.Request(
            f"https://api.github.com/repos/Heraklines/elite-redux/git/blobs/{OID}",
            headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                     "User-Agent": "m9e-named-source-inspection",
                     "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                require(response.status == 200, "source status")
                body = response.read(524289)
            require(len(body) <= 524288, "bounded source API response")
        except Exception:
            raise RuntimeError("bounded immutable source request failed") from None
        value = json.loads(body)
        require(value.get("sha") == OID and value.get("encoding") == "base64"
                and type(value.get("size")) is int and value["size"] == 325510, "source metadata")
        raw = base64.b64decode("".join(value["content"].splitlines()), validate=True)
        require(len(raw) == 325510 and hashlib.sha256(raw).hexdigest() == RAW_SHA
                and hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest() == OID,
                "immutable source bytes")
        lines = raw.decode("utf-8").splitlines(keepends=True)
        method = re.compile(r"^  (?:(?:public|private|protected) )?(constructor|createStarterDataEntry|initStarterData)\(")
        starts = [(i, method.search(line).group(1)) for i, line in enumerate(lines) if method.search(line)]
        require(any(name == "constructor" for _, name in starts)
                and any(name == "createStarterDataEntry" for _, name in starts)
                and len(starts) <= 8, "exact constructor selector")
        selected = set()
        methods = []
        for start, name in starts:
            ends = [i for i in range(start + 1, len(lines)) if re.match(r"^  }\s*$", lines[i])]
            require(ends and ends[0] - start <= 250, "bounded complete method")
            end = ends[0]
            methods.append(dict(name=name, start=start+1, end=end+1))
            selected.update(range(start, end+1))
        assignments = [i for i, line in enumerate(lines) if re.search(r"this\.starterData\s*=", line)]
        require(len(assignments) <= 8, "bounded starter initialization assignments")
        for index in assignments:
            selected.update(range(max(0, index-8), min(len(lines), index+30)))
        excerpt = "".join(f"{i+1:05d}: {lines[i]}" for i in sorted(selected)).encode()
        require(len(excerpt) <= 24576, "named constructor excerpt exceeds 24 KiB")
        require(time.monotonic() - started <= 120, "source diagnostic total bound")
        (OUT / "source-excerpt.txt").write_bytes(excerpt)
        receipt.update(status="passed", bytes=len(raw), sha256=RAW_SHA,
                       excerpt_bytes=len(excerpt), excerpt_sha256=hashlib.sha256(excerpt).hexdigest(),
                       methods=methods, assignments=[i+1 for i in assignments],
                       elapsed_seconds=time.monotonic()-started)
        receipt["source_hashes"] = {path: hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in (
            "scripts/ci/m9e_fresh_friendship_source.py", ".github/workflows/m9e-fresh-friendship-source.yml")}
    except Exception as error:
        receipt["failure"] = str(error)[:512] if isinstance(error, RuntimeError) else "bounded source inspection failed"
    finally:
        encoded = (json.dumps(receipt, sort_keys=True, separators=(",", ":"))+"\n").encode()
        require(len(encoded) <= 8192, "compact source receipt")
        (OUT / "receipt.json").write_bytes(encoded)
    require(receipt["status"] == "passed", "source inspection failed; inspect compact receipt")

if __name__ == "__main__":
    main()
