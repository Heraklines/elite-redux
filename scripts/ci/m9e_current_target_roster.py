"""Bounded remote observation of actual current bootstrap; no qualification claim."""
import hashlib
import json
import os
from pathlib import Path
import time

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-target-roster"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
START = int(os.environ["M9E_STARTED_AT"])
DEADLINE = time.monotonic() + 1180 - (time.time() - START)
BASE = "d9a6391a94cae965eaa2c5af5f910002631d5254"
EXAMPLE = "rust/crates/er-kernel/examples/m9e_current_target_roster.rs"
OWNED = [EXAMPLE, "scripts/ci/m9e_current_target_roster.py", ".github/workflows/m9e-target-roster.yml"]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(summary):
    logs = summary["logs"]

    def run(args, name, seconds=900):
        path = FULL / (name + ".log")
        result = run_bounded(args, cwd=ROOT, environment=dict(os.environ), output=path,
                             seconds=seconds, byte_limit=8 << 20, global_deadline=DEADLINE)
        logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
        return path

    if run(["git", "rev-parse", "HEAD"], "identity", 30).read_text().strip() != os.environ["GITHUB_SHA"]:
        raise RuntimeError("exact source required")
    changed = run(["git", "diff", "--name-only", BASE, "HEAD"], "paths", 30).read_text().splitlines()
    if sorted(changed) != sorted(OWNED):
        raise RuntimeError("only the declared diagnostic source may change")
    summary["source_hashes"] = {path: digest(ROOT / path) for path in OWNED + ["scripts/ci/m9e_current_cost.py"]}
    run(["cargo", "run", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-kernel",
         "--example", "m9e_current_target_roster", "--", str(COMPACT / "roster.json")], "actual-roster")
    output = COMPACT / "roster.json"
    if not 0 < output.stat().st_size <= 32768:
        raise RuntimeError("bounded actual roster required")
    roster = json.loads(output.read_text())
    if roster["source_sha"] != os.environ["GITHUB_SHA"] or len(roster["rows"]) != 3:
        raise RuntimeError("three same-candidate actual rosters required")
    summary["roster"] = {"bytes": output.stat().st_size, "sha256": digest(output)}
    if any(digest(ROOT / path) != value for path, value in summary["source_hashes"].items()):
        raise RuntimeError("source changed during diagnostic")


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "base_sha": BASE,
               "run_id": os.environ["GITHUB_RUN_ID"], "logs": {},
               "qualification": "diagnostic actual bootstrap observation only; no gameplay qualification"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)
        tail = b""
        files = sorted(FULL.glob("*.log"), key=lambda path: path.stat().st_mtime)
        if files:
            with files[-1].open("rb") as stream:
                stream.seek(max(0, files[-1].stat().st_size - 24000))
                tail = stream.read(24000)
        (FULL / "failure.txt").write_text(str(error) + "\nBounded tail; full logs remain remote.\n" + tail.decode("utf-8", errors="replace"))
    finally:
        summary["elapsed_seconds_including_checkout"] = time.time() - START
        raw = json.dumps(summary, sort_keys=True).encode()
        if len(raw) > 16384:
            raise RuntimeError("compact metadata exceeds bound")
        (COMPACT / "summary.json").write_bytes(raw)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
