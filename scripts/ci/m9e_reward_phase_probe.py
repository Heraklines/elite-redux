"""Focused remote whole-phase qualification for the generator-probed fixture."""

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
BRANCH = "codex/m9e-reward-phase-probe-20260923"
OWNED = {"rust/crates/er-kernel/tests/m9e_current_phase_execution.rs",
         "scripts/ci/m9e_reward_phase_probe.py", ".github/workflows/m9e-reward-phase-probe.yml"}
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-reward-phase-probe"
IDS = [
    "controlled_early_ko_flash_owns_clock_egg_candy_and_canceled_suffix",
    "controlled_raw_initial_victory_tail_settles_once_and_retains_boundary",
    "epoch_zero_max_unlock_does_not_request_or_repeat_achievement_reward",
    "raw_knockout_waits_for_xp_prompt_then_level_stats_with_exact_material_restore",
]
COMMANDS = []


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def run(name, argv, seconds=900, cwd=ROOT):
    begun = time.monotonic()
    try:
        completed = subprocess.run(argv, cwd=cwd, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, timeout=seconds, check=False)
        raw, code = completed.stdout, completed.returncode
    except subprocess.TimeoutExpired as error:
        raw, code = error.stdout or b"", -1
    require(len(raw) <= 8 << 20, "bounded remote command output")
    (OUT / "diagnostics" / (name + ".log")).write_bytes(raw)
    COMMANDS.append({"name": name, "argv": argv, "returncode": code,
                     "elapsed_ms": int((time.monotonic() - begun) * 1000),
                     "log_bytes": len(raw), "log_sha256": hashlib.sha256(raw).hexdigest()})
    return raw, code


def main():
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    result = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"],
              "base_sha": BASE, "branch": os.environ["GITHUB_REF_NAME"],
              "scope": "source-equivalent clean product; all four whole native phase tests; no aggregate M9 acceptance",
              "commands": COMMANDS, "expected_ids": IDS, "tests_passed": 0}
    try:
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH
                and result["branch"] == BRANCH and os.environ["GITHUB_EVENT_NAME"] == "push", "isolated push")
        require(os.name == "posix" and os.uname().machine == "x86_64", "native Linux host")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "ambient Rust flags")
        head, code = run("head", ["git", "rev-parse", "HEAD"], 30)
        require(code == 0 and head.decode().strip() == result["source_sha"], "exact HEAD")
        parent, code = run("parent", ["git", "merge-base", "HEAD", BASE], 30)
        require(code == 0 and parent.decode().strip() == BASE, "exact product parent")
        delta, code = run("delta", ["git", "diff", "--name-only", BASE, "HEAD"], 30)
        require(code == 0 and set(delta.decode().splitlines()) == OWNED, "sole fixture and harness delta")
        _, code = run("toolchain", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal", "--component", "rustfmt"], 120)
        require(code == 0, "pinned toolchain")
        version, code = run("rustc", ["rustc", "-Vv"], 30)
        require(code == 0 and b"release: 1.97.1\n" in version, "pinned compiler")
        _, code = run("format", ["cargo", "fmt", "--all", "--", "--check"], 120, ROOT / "rust")
        require(code == 0, "workspace Rust formatting")
        bundle = ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
        result["content_sha256"] = hashlib.sha256(bundle.read_bytes()).hexdigest()
        os.environ["CARGO_TARGET_DIR"] = str(OUT / "target")
        base = ["cargo", "test", "--locked", "-p", "er-kernel", "--test", "m9e_current_phase_execution", "--"]
        listing, code = run("whole-list", base + ["--list", "--format", "terse"], 600, ROOT / "rust")
        require(code == 0, "complete target compilation/list")
        actual = [item.decode() for item in re.findall(rb"^([A-Za-z0-9_:]+): test$", listing, re.M)]
        require(sorted(actual) == IDS, "all four exact phase test IDs")
        output, code = run("whole-execute", base + ["--format", "terse", "--test-threads=1", "--nocapture"],
                           900, ROOT / "rust")
        counts = re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
        result["reported_counts"] = [[int(value) for value in row] for row in counts]
        require(code == 0 and counts == [(b"4", b"0", b"0", b"0", b"0")], "whole phase target failed")
        require(hashlib.sha256(bundle.read_bytes()).hexdigest() == result["content_sha256"], "content changed")
        result.update({"status": "passed", "tests_passed": 4})
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(encoded) <= 32768, "compact phase result bound")
    (OUT / "compact/summary.json").write_bytes(encoded)
    if result["status"] != "passed":
        failed = [row for row in COMMANDS if row["returncode"] != 0]
        tail = (OUT / "diagnostics" / (failed[-1]["name"] + ".log")).read_bytes()[-22000:] if failed else b""
        (OUT / "compact/failure.txt").write_bytes((result["first_failure"] + "\n").encode() + tail)
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
