"""Source-equivalent remote release-cost qualification for the current candidate."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import m9e_current_cost as cost

ROOT = Path(__file__).resolve().parents[2]
BASE = "d0ee75314e8a272b54777665da012b2d17bef873"
BRANCH = "codex/m9e-release-cost-probe-20260923"
OWNED = {"scripts/ci/m9e_current_release_probe.py", ".github/workflows/m9e-current-release-probe.yml"}
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-current-release-probe"


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def capture(args):
    completed = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, timeout=60, check=False)
    require(completed.returncode == 0 and len(completed.stdout) <= 16384, "source metadata command")
    return completed.stdout.decode().strip()


def main():
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    result = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"],
              "base_sha": BASE, "branch": os.environ["GITHUB_REF_NAME"],
              "scope": "optimized native release-cost witness on source-equivalent isolated harness child; no aggregate M9 acceptance",
              "harness_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    try:
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH
                and result["branch"] == BRANCH and os.environ["GITHUB_EVENT_NAME"] == "push", "isolated push")
        require(os.name == "posix" and os.uname().machine == "x86_64", "native Linux host")
        require(re.fullmatch(r"[0-9a-f]{40}", result["source_sha"]) is not None, "source SHA")
        require(capture(["git", "rev-parse", "HEAD"]) == result["source_sha"], "exact HEAD")
        require(capture(["git", "rev-parse", "HEAD^"]) == BASE, "exact product parent")
        require(set(capture(["git", "diff", "--name-only", BASE, "HEAD"]).splitlines()) == OWNED,
                "only release harness differs from product source")
        identity = {"product_sha": result["source_sha"], "workflow_sha": result["source_sha"],
                    "profile": "test", "features": "default", "target": "x86_64-unknown-linux-gnu"}
        binding = cost.build_source_binding(ROOT, result["source_sha"])
        deadline = time.monotonic() + min(1800, float(os.environ["M9E_STARTED_AT"]) + 1950 - time.time())
        require(deadline > time.monotonic() + 120, "release measurement deadline")
        _, proof = cost.execute_release(ROOT, OUT, OUT / "diagnostics", identity=identity,
                                        source_binding=binding, discovered_ids=[cost.TEST_ID],
                                        global_deadline=deadline)
        result["proof"] = proof
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(encoded) <= 32768, "compact result byte bound")
    (OUT / "compact/summary.json").write_bytes(encoded)
    if result["status"] != "passed":
        (OUT / "compact/failure.txt").write_text(result["first_failure"] + "\n")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
