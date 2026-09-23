"""Bounded remote qualification of both whole current Worker/CLI reload witnesses."""

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
BRANCH = "codex/m9e-reload-probe-20260923"
OWNED = {
    ".github/workflows/m9e-host-phase-probe.yml",
    "scripts/ci/m9e_host_phase_probe.py",
}
TARGETS = {"m9e_current_reload": ("er-cli", [
    "actual_worker_cli_reload_replays_held_timer_tail_and_preserves_failed_ticket",
    "actual_worker_cli_rejects_bad_artifacts_then_forks_and_restores",
])}
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-reload-probe"
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
        "tests_expected": 2, "tests_passed": 0, "targets": [],
        "commands": COMMANDS,
        "scope": "both whole native Worker/CLI reload witnesses on exact main-candidate source; no rulechange or aggregate M9 acceptance",
    }
    try:
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH, "isolated branch")
        require(result["branch"] == BRANCH and os.environ["GITHUB_EVENT_NAME"] == "push", "push identity")
        require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "ambient Rust flags")
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
        hosts = re.findall(rb"^host: ([a-zA-Z0-9_-]+)$", output, re.M)
        require(len(hosts) == 1, "actual build target")
        os.environ["CARGO_TARGET_DIR"] = str(OUT / "target")
        worker_log, built = run("worker-build", [
            "cargo", "build", "--locked", "-p", "er-kernel-worker", "--bin", "er-kernel-worker",
            "--message-format=json"], ROOT / "rust", 900)
        require(built["returncode"] == 0, "complete Worker build")
        worker_rows = [json.loads(line) for line in worker_log.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in worker_rows if row.get("reason") == "build-finished"] == [True], "Worker build-finished")
        matches = [row for row in worker_rows if row.get("reason") == "compiler-artifact"
                   and row.get("target", {}).get("name") == "er-kernel-worker"
                   and row.get("target", {}).get("kind") == ["bin"]]
        require(len(matches) == 1, "sole Worker executable")
        artifact = matches[0]
        worker = Path(artifact.get("executable") or "")
        require(artifact.get("manifest_path") == str(ROOT / "rust/crates/er-kernel-worker/Cargo.toml")
                and artifact.get("features") == [] and artifact.get("profile", {}).get("test") is False
                and artifact["profile"].get("debug_assertions") is True
                and artifact["profile"].get("opt_level") == "1"
                and worker == OUT / "target/debug/er-kernel-worker"
                and worker.is_file() and not worker.is_symlink() and worker.resolve() == worker
                and 0 < worker.stat().st_size <= 128 << 20, "exact Worker artifact/profile")
        worker_hash = sha(worker.read_bytes())
        result["worker_artifact"] = {"sha256": worker_hash, "bytes": worker.stat().st_size,
                                     "profile": artifact["profile"], "host": hosts[0].decode()}
        os.environ.update({"ER_M9E_WORKER_EXECUTABLE": str(worker),
                           "ER_M9E_WORKER_EXECUTABLE_SHA256": worker_hash,
                           "ER_M9E_WORKER_SOURCE_SHA": result["source_sha"],
                           "ER_M9E_WORKER_BUILD_TARGET": hosts[0].decode(),
                           "ER_M9E_WORKER_BUILD_PROFILE": "debug"})
        for target, (crate, ids) in TARGETS.items():
            base = ["cargo", "test", "--locked", "-p", crate, "--test", target, "--"]
            listing, listed = run(target + "-list", base + ["--list", "--format", "terse"], ROOT / "rust")
            require(listed["returncode"] == 0, target + " list")
            actual = re.findall(rb"^([A-Za-z0-9_:]+): test$", listing, re.M)
            require(sorted(value.decode() for value in actual) == sorted(ids), target + " whole test identity")
            require(sha(worker.read_bytes()) == worker_hash, "Worker changed before reload")
            output, executed = run(target + "-execute", base + ["--format", "terse", "--test-threads=1", "--nocapture"], ROOT / "rust", 1800)
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
        require(sha(worker.read_bytes()) == worker_hash and sha(bundle.read_bytes()) == result["content_sha256"], "Worker/content changed during reload")
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
