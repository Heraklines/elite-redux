"""Bounded remote feedback for the complete current native cost witness."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

BASE = "d0ee75314e8a272b54777665da012b2d17bef873"
PROBE_PARENT = BASE
BRANCH = "codex/m9e-cost-probe-20260923"
OWNED = {
    ".github/workflows/m9e-host-phase-probe.yml",
    "scripts/ci/m9e_host_phase_probe.py",
}
TARGETS = {"m9e_current_cost_probe": ("er-repro", ["current_native_phase_costs_preserve_semantics"])}
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-cost-probe"
COMMANDS = []


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(name, args, cwd=ROOT, seconds=600):
    started = time.monotonic()
    try:
        completed = subprocess.run(
            args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=seconds, check=False,
        )
        output, code = completed.stdout, completed.returncode
    except subprocess.TimeoutExpired as error:
        output, code = error.stdout or b"", -1
    require(len(output) <= 8 << 20, name + " exceeded remote log bound")
    record = {
        "name": name, "argv": args, "returncode": code,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "log_bytes": len(output), "log_sha256": sha(output),
    }
    COMMANDS.append(record)
    (OUT / "diagnostics" / (name + ".log")).write_bytes(output)
    return output, record


def main():
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    result = {
        "status": "failed", "source_sha": os.environ["GITHUB_SHA"],
        "base_sha": BASE, "branch": os.environ["GITHUB_REF_NAME"],
        "harness_sha256": sha(Path(__file__).read_bytes()),
        "tests_expected": 1, "tests_passed": 0, "targets": [],
        "commands": COMMANDS,
        "scope": "one complete native cost witness on exact main-candidate source; no optimized benchmark threshold or aggregate M9 acceptance",
    }
    try:
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH, "isolated branch")
        require(result["branch"] == BRANCH and os.environ["GITHUB_EVENT_NAME"] == "push", "push identity")
        require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "ambient Rust flags")
        output, row = run("head", ["git", "rev-parse", "HEAD"])
        require(row["returncode"] == 0 and output.decode().strip() == result["source_sha"], "exact HEAD")
        output, row = run("delta", ["git", "diff", "--name-only", BASE, "HEAD"])
        require(row["returncode"] == 0 and set(output.decode().splitlines()) == OWNED, "exact focused repair and harness delta")
        output, row = run("parent", ["git", "rev-parse", "HEAD^"])
        require(row["returncode"] == 0 and output.decode().strip() == PROBE_PARENT, "exact probe parent")
        bundle = ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
        result["content_bytes"] = bundle.stat().st_size
        result["content_sha256"] = sha(bundle.read_bytes())
        output, row = run("toolchain", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal"])
        require(row["returncode"] == 0, "pinned toolchain")
        output, row = run("rustc", ["rustc", "-Vv"])
        require(row["returncode"] == 0 and b"release: 1.97.1\n" in output, "pinned compiler")
        os.environ["CARGO_TARGET_DIR"] = str(OUT / "target")
        for target, (crate, ids) in TARGETS.items():
            base = ["cargo", "test", "--locked", "-p", crate, "--test", target, "--"]
            listing, listed = run(target + "-list", base + ["--list", "--format", "terse"], ROOT / "rust")
            require(listed["returncode"] == 0, target + " list")
            actual = re.findall(rb"^([A-Za-z0-9_:]+): test$", listing, re.M)
            require(sorted(value.decode() for value in actual) == sorted(ids), target + " whole test identity")
            output, executed = run(target + "-execute", base + ["--format", "terse"], ROOT / "rust", 1800)
            counts = re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
            passed = executed["returncode"] == 0 and counts == [(str(len(ids)).encode(), b"0", b"0", b"0", b"0")]
            result["targets"].append({
                "name": target, "crate": crate, "ids": ids, "passed": passed,
                "listing_sha256": listed["log_sha256"], "execution_sha256": executed["log_sha256"],
                "reported_counts": [[int(value) for value in values] for values in counts],
                "execution_returncode": executed["returncode"],
            })
            if passed:
                result["tests_passed"] += len(ids)
        require(result["tests_passed"] == result["tests_expected"], "whole targets failed")
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        result["elapsed_ms"] = sum(row["elapsed_ms"] for row in COMMANDS)
        raw = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
        require(len(raw) <= 65536, "compact summary bound")
        (OUT / "compact/summary.json").write_bytes(raw)
        if result["status"] != "passed":
            prefix = (result.get("first_failure", "qualification failed") + "\n").encode()
            failed = [row for row in COMMANDS if row["returncode"] != 0]
            excerpts = []
            for row in failed[-2:]:
                raw_log = (OUT / "diagnostics" / (row["name"] + ".log")).read_bytes()
                excerpts.append((row["name"] + "\n").encode() + raw_log[-22000:])
            (OUT / "compact/failure.txt").write_bytes((prefix + b"\n".join(excerpts))[:49152])
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
