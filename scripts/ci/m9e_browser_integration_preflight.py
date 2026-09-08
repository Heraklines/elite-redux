"""Remote whole-harness feedback only; no native or Browser qualification."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-browser-integration-preflight"
FULL = REPORT / "full"
COMPACT = REPORT / "compact"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir()
    source = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if source != os.environ["GITHUB_SHA"]:
        raise RuntimeError("exact source checkout required")
    paths = sorted({*ROOT.glob("scripts/ci/test_m9e*.py"),
                    *(ROOT / name for name in (
                        "scripts/ci/m9e_feedback.py", "scripts/ci/m9e_phases.py", "scripts/ci/m9e_browser_rebind.py",
                        "scripts/ci/m9e_browser_integration_preflight.py", "scripts/ci/m9e-owned-foundations-inventory.json",
                        "scripts/ci/m9e-targets.json", "scripts/ci/fixtures/m9e-browser-rebind-proof.json",
                        ".github/workflows/m9e-browser-integration-preflight.yml"))})
    before = {str(path.relative_to(ROOT)): digest(path) for path in paths}
    log = FULL / "harness-tests.log"
    argv = [sys.executable, "-m", "unittest", "discover", "-s", "scripts/ci", "-p", "test_m9e*.py", "-v"]
    started = time.monotonic()
    with log.open("wb") as output:
        result = subprocess.run(argv, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, timeout=450, check=False)
    raw = log.read_bytes()
    if not 0 < len(raw) <= 256 << 10:
        raise RuntimeError("bounded whole-harness log required")
    found = re.findall(rb"(?m)^Ran ([0-9]+) tests in ([0-9.]+)s$", raw)
    count = int(found[0][0]) if len(found) == 1 else None
    after = {str(path.relative_to(ROOT)): digest(path) for path in paths}
    elapsed = time.time() - int(os.environ["M9E_PREFLIGHT_STARTED"])
    passed = result.returncode == 0 and count == 477 and before == after and 0 < elapsed <= 540
    summary = {"status": "passed" if passed else "failed", "source_sha": source,
               "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
               "tests": count, "expected_tests": 477, "returncode": result.returncode, "execution_argv": argv,
               "elapsed_seconds": round(time.monotonic() - started, 3), "including_checkout_seconds": round(elapsed, 3),
               "source_hashes": before, "source_unchanged": before == after,
               "log_bytes": len(raw), "log_sha256": hashlib.sha256(raw).hexdigest(),
               "native_qualified": False, "browser_qualified": False, "full_integration_qualified": False}
    payload = (json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(payload) > 16384:
        raise RuntimeError("bounded summary required")
    (COMPACT / "summary.json").write_bytes(payload)
    if not passed:
        (COMPACT / "failure.txt").write_bytes(raw[-60000:])
    print(json.dumps({key: summary[key] for key in ("status", "source_sha", "tests", "expected_tests", "elapsed_seconds")}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
