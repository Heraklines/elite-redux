"""Temporary source-equivalent generator probe; deliberately not acceptance."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = "d0ee75314e8a272b54777665da012b2d17bef873"
BRANCH = "codex/m9e-reward-seed-probe-20260923"
OWNED = {"rust/crates/er-game/src/lib.rs", "rust/crates/er-game/src/current_reward_selection.rs",
         "rust/crates/er-kernel/tests/m9e_current_phase_execution.rs",
         "scripts/ci/m9e_reward_seed_probe.py", ".github/workflows/m9e-reward-seed-probe.yml"}
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-reward-seed-probe"


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def run(name, args, seconds, cwd=ROOT):
    started = time.monotonic()
    try:
        completed = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, timeout=seconds, check=False)
        output, code = completed.stdout, completed.returncode
    except subprocess.TimeoutExpired as error:
        output, code = error.stdout or b"", -1
    require(len(output) <= 8 << 20, "remote diagnostic log bound")
    (OUT / "diagnostics" / (name + ".log")).write_bytes(output)
    return output, code, {"name": name, "argv": args, "returncode": code,
                          "elapsed_ms": int((time.monotonic() - started) * 1000),
                          "log_bytes": len(output), "log_sha256": hashlib.sha256(output).hexdigest()}


def main():
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    result = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"],
              "base_sha": BASE, "branch": os.environ["GITHUB_REF_NAME"],
              "scope": "temporary generator seed search; original reward test remains deliberately red; no qualification",
              "commands": []}
    try:
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH
                and result["branch"] == BRANCH and os.environ["GITHUB_EVENT_NAME"] == "push", "probe branch")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "ambient Rust flags")
        head, code, row = run("head", ["git", "rev-parse", "HEAD"], 30)
        result["commands"].append(row)
        require(code == 0 and head.decode().strip() == result["source_sha"], "exact HEAD")
        parent, code, row = run("parent", ["git", "merge-base", "HEAD", BASE], 30)
        result["commands"].append(row)
        require(code == 0 and parent.decode().strip() == BASE, "exact product parent")
        delta, code, row = run("delta", ["git", "diff", "--name-only", BASE, "HEAD"], 30)
        result["commands"].append(row)
        require(code == 0 and set(delta.decode().splitlines()) == OWNED, "exact temporary probe delta")
        _, code, row = run("toolchain", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal"], 120)
        result["commands"].append(row)
        require(code == 0, "pinned toolchain")
        os.environ["CARGO_TARGET_DIR"] = str(OUT / "target")
        test = "controlled_early_ko_flash_owns_clock_egg_candy_and_canceled_suffix"
        output, code, row = run("seed-search", ["cargo", "test", "--locked", "-p", "er-kernel",
                                                "--test", "m9e_current_phase_execution", test, "--",
                                                "--exact", "--nocapture", "--test-threads=1"],
                                900, ROOT / "rust")
        result["commands"].append(row)
        matches = re.findall(rb"M9E_REWARD_SEED_PROBE seed=(m9e-reward-fullslot-[0-9]+) offers=(\[[^\n]+\])",
                             output, re.M)
        require(len(matches) == 1, "exact successful actual-generator seed marker")
        seed = matches[0][0].decode()
        require(0 <= int(seed.rsplit("-", 1)[1]) < 20_000, "bounded seed corpus")
        require(code == 101 and b"full-slot TM raw witness did not reach an actual TM offer" in output
                and b"test result: FAILED. 0 passed; 1 failed" in output,
                "original test must remain red on original seed")
        result.update({"status": "found", "candidate_seed": seed, "offers": matches[0][1].decode(),
                       "original_test_passed": False})
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    raw = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(raw) <= 16384, "compact seed result bound")
    (OUT / "compact/summary.json").write_bytes(raw)
    if result["status"] != "found":
        (OUT / "compact/failure.txt").write_text(result["first_failure"] + "\n")
    return 0 if result["status"] == "found" else 1


if __name__ == "__main__":
    sys.exit(main())
