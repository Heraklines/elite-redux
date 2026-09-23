"""Remote exact-source Worker rulechange reload witness on a harness-only child."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

import m9e_current_cost as cost
import m9e_rulechange as rule

ROOT = Path(__file__).resolve().parents[2]
BASE = "d0ee75314e8a272b54777665da012b2d17bef873"
BRANCH = "codex/m9e-rulechange-probe-20260923"
OWNED = {"scripts/ci/m9e_current_rulechange_probe.py", ".github/workflows/m9e-current-rulechange-probe.yml"}
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-current-rulechange-probe"
COMMANDS = []


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def capture(args):
    completed = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, timeout=60, check=False)
    require(completed.returncode == 0 and len(completed.stdout) <= 16384, "source metadata command")
    return completed.stdout.decode().strip()


def run(name, args, deadline, *, cwd=ROOT, environment=None, seconds=900, bound=16 << 20):
    result = cost.run_bounded(args, cwd=cwd, environment=dict(os.environ) if environment is None else environment,
                              output=OUT / "diagnostics" / (name + ".log"), seconds=seconds,
                              byte_limit=bound, global_deadline=deadline)
    COMMANDS.append({"name": name, "argv": args, "bytes": result["bytes"],
                     "sha256": result["sha256"], "elapsed_seconds": result["elapsed_seconds"]})
    return result["path"]


def sole_artifact(path, name, kind):
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.startswith("{")]
    require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True],
            "complete Cargo artifact stream")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == name and row.get("target", {}).get("kind") == kind]
    require(len(matches) == 1, "sole exact Cargo artifact " + name)
    return matches[0]


def main():
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    source_sha = os.environ["GITHUB_SHA"]
    result = {"status": "failed", "source_sha": source_sha, "base_sha": BASE,
              "branch": os.environ["GITHUB_REF_NAME"], "commands": COMMANDS,
              "scope": "whole actual CLI changed-rule reload with isolated one-file derived Worker on source-equivalent candidate; no aggregate M9 acceptance",
              "harness_sha256": digest(Path(__file__))}
    try:
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH
                and result["branch"] == BRANCH and os.environ["GITHUB_EVENT_NAME"] == "push", "isolated push")
        require(os.name == "posix" and os.uname().machine == "x86_64", "native Linux host")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "ambient Rust flags")
        require(capture(["git", "rev-parse", "HEAD"]) == source_sha
                and capture(["git", "rev-parse", "HEAD^"]) == BASE, "exact source parent")
        require(set(capture(["git", "diff", "--name-only", BASE, "HEAD"]).splitlines()) == OWNED,
                "only probe harness differs from product source")
        started = float(os.environ["M9E_STARTED_AT"])
        deadline = time.monotonic() + min(1800, started + 1950 - time.time())
        require(deadline > time.monotonic() + 120, "shared qualification deadline")
        run("toolchain", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal"],
            deadline, seconds=120, bound=16384)
        compiler = run("rustc", ["rustc", "-vV"], deadline, seconds=30, bound=16384).read_text()
        hosts = re.findall(r"^host: ([a-zA-Z0-9_-]+)$", compiler, re.M)
        require(len(hosts) == 1 and "release: 1.97.1\n" in compiler, "pinned native compiler")
        host = hosts[0]
        version = run("rustc-version", ["rustc", "--version"], deadline, seconds=30, bound=16384).read_text().strip()
        os.environ["CARGO_TARGET_DIR"] = str(OUT / "target")
        worker_log = run("clean-worker-build", ["cargo", "build", "--locked", "--profile", "test", "--target", host,
                         "-p", "er-kernel-worker", "--bin", "er-kernel-worker", "--message-format=json"],
                         deadline, cwd=ROOT / "rust")
        worker_artifact = sole_artifact(worker_log, "er-kernel-worker", ["bin"])
        worker = Path(worker_artifact.get("executable") or "")
        require(worker_artifact.get("manifest_path") == str(ROOT / "rust/crates/er-kernel-worker/Cargo.toml")
                and worker_artifact.get("profile", {}).get("test") is False
                and worker.is_absolute() and worker.is_file() and not worker.is_symlink()
                and worker.resolve().is_relative_to(OUT / "target")
                and worker.name == "er-kernel-worker" and 0 < worker.stat().st_size <= 128 << 20,
                "exact clean Worker artifact")
        clean_worker = {"path": str(worker), "source_sha": source_sha, "target": host,
                        "profile": "test", "cargo_profile": worker_artifact["profile"],
                        "manifest_path": "rust/crates/er-kernel-worker/Cargo.toml",
                        "cargo_package_id": worker_artifact["package_id"],
                        "bytes": worker.stat().st_size, "sha256": digest(worker)}
        test_log = run("cli-test-build", ["cargo", "test", "--locked", "-p", "er-cli", "--test", rule.RULE_TARGET,
                       "--no-run", "--message-format=json"], deadline, cwd=ROOT / "rust")
        test_artifact = sole_artifact(test_log, rule.RULE_TARGET, ["test"])
        binary = Path(test_artifact.get("executable") or "")
        require(test_artifact.get("manifest_path") == str(ROOT / "rust/crates/er-cli/Cargo.toml")
                and test_artifact.get("profile", {}).get("test") is True
                and binary.is_absolute() and binary.is_file() and not binary.is_symlink()
                and binary.resolve().is_relative_to(OUT / "target")
                and re.fullmatch(rule.RULE_TARGET + r"-[0-9a-f]{16}", binary.name) is not None,
                "exact CLI rulechange test artifact")
        binary_hash = digest(binary)
        listing = run("cli-test-list", [str(binary), "--list", "--format", "terse"],
                      deadline, cwd=ROOT / "rust", seconds=30, bound=16384).read_text()
        require(listing == rule.RULE_TEST + ": test\n", "whole one-test rulechange inventory")
        policy = rule.make_rule_policy(ROOT, source_sha)
        summary = {"product_sha": source_sha, "target": host, "toolchain": version,
                   "plan": {"rule_worker": policy}}
        feedback = SimpleNamespace(ROOT=ROOT, RUST=ROOT / "rust", REPORT=OUT,
                                   FULL=OUT / "diagnostics", TIMINGS={}, Path=Path,
                                   os=os, re=re, json=json, hashlib=hashlib,
                                   shutil=shutil, tempfile=tempfile, digest=digest)
        bounded = rule.bounded_rule_feedback(feedback, deadline)
        with rule.current_rule_worker(bounded, summary, clean_worker) as (test_env, evidence):
            output = run("cli-test-execute", [str(binary), "--exact", rule.RULE_TEST, "--format", "terse",
                                               "--test-threads=1", "--nocapture"], deadline,
                         cwd=ROOT / "rust/crates/er-cli", environment=test_env)
            counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out",
                                output.read_text())
            require(counts == [("1", "0", "0", "0", "0")], "whole changed-rule witness")
            evidence.update({"status": "passed", "target": rule.RULE_TARGET, "test": rule.RULE_TEST,
                             "tests": {"executed": 1, "passed": 1, "failed": 0, "skipped": 0}})
        identity = {"product_sha": source_sha, "target": host, "toolchain": version,
                    "files": {"lock": digest(ROOT / "rust/Cargo.lock"),
                              "rule_workspace": digest(ROOT / "rust/Cargo.toml"),
                              "rule_worker_manifest": digest(ROOT / "rust/crates/er-kernel-worker/Cargo.toml"),
                              "rule_toolchain": digest(ROOT / "rust/rust-toolchain.toml"),
                              "rule_test": digest(ROOT / rule.RULE_TEST_SOURCE),
                              "rule_source": digest(ROOT / rule.RULE_SOURCE)}}
        rule.validate_rule_evidence(evidence, policy, identity, clean_worker)
        require(digest(binary) == binary_hash and digest(worker) == clean_worker["sha256"],
                "actual CLI or base Worker changed")
        result.update({"status": "passed", "tests": evidence["tests"], "rule_evidence": evidence,
                       "clean_worker": {key: clean_worker[key] for key in ("sha256", "bytes", "target", "profile", "cargo_profile")},
                       "test_artifact_sha256": binary_hash, "rule_timings": feedback.TIMINGS})
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    raw = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(raw) <= 65536, "compact rulechange result bound")
    (OUT / "compact/summary.json").write_bytes(raw)
    if result["status"] != "passed":
        (OUT / "compact/failure.txt").write_text(result["first_failure"] + "\n")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
