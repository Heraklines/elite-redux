"""Remote-only, source-bound whole-target feedback for the normal current CLI."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

BASE = "3996f232030ca3d26064263ee7a9303a120dbebf"
BRANCH = "codex/m9e-entry-recheck-20260923"
OWNED = {
    ".github/workflows/m9e-current-entry-focused.yml",
    "scripts/ci/m9e_current_entry_diagnostic.py",
}
TARGETS = {
    "m9e_current_entry": [
        "normal_new_run_resume_and_simulate_use_current_session_events",
        "normal_commands_report_v2_content_and_reject_historical_state_injection",
        "public_agent_natural_start_owns_v7_content_and_raw_controls",
        "public_agent_rejects_old_snapshot_schema_without_replacing_current_session",
        "public_agent_fork_time_restore_and_close_preserve_current_session_identity",
        "public_agent_rejected_external_results_do_not_commit_partial_state",
        "current_session_rolls_back_when_adapter_completion_rejects",
    ],
    "m9e_current_batch": [
        "actual_current_batch_preserves_order_timers_rollback_and_fork",
        "actual_current_batch_import_reset_limits_and_global_quota_are_atomic",
    ],
    "m9e_current_native_capture": [
        "actual_native_capture_replays_natural_events_rejections_and_imported_history",
        "actual_native_capture_rotation_fork_restore_and_byte_gaps_are_explicit",
        "actual_native_capture_late_response_and_rejected_ingress_preserve_gameplay",
        "actual_native_capture_browser_import_declares_native_suffix_at_original_frontier",
    ],
}
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-current-entry"
COMMANDS = []


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def command(name, argv, cwd=ROOT, seconds=600):
    started = time.monotonic()
    try:
        completed = subprocess.run(
            argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=seconds, check=False,
        )
        output, code = completed.stdout, completed.returncode
    except subprocess.TimeoutExpired as error:
        output, code = error.stdout or b"", -1
    require(len(output) <= 8 << 20, name + " exceeded remote log bound")
    record = {
        "name": name, "argv": argv, "returncode": code,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "log_bytes": len(output), "log_sha256": sha(output),
    }
    COMMANDS.append(record)
    (OUT / (name + ".log")).write_bytes(output)
    return output, record


def main():
    OUT.mkdir()
    (OUT / "compact").mkdir()
    result = {
        "status": "failed", "source_sha": os.environ["GITHUB_SHA"],
        "branch": os.environ["GITHUB_REF_NAME"], "base_sha": BASE,
        "harness_sha256": sha(Path(__file__).read_bytes()),
        "targets": [], "tests_expected": sum(map(len, TARGETS.values())),
        "tests_passed": 0, "commands": COMMANDS,
        "scope": "three complete current er-cli test targets; no whole-game or final M9 claim",
    }
    try:
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH, "isolated branch")
        require(result["branch"] == BRANCH and os.environ["GITHUB_EVENT_NAME"] == "push", "push identity")
        require(os.name == "posix" and os.uname().machine == "x86_64", "runner platform")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "ambient Rust flags")
        output, record = command("head", ["git", "rev-parse", "HEAD"])
        require(record["returncode"] == 0 and output.decode().strip() == result["source_sha"], "checked out SHA")
        output, record = command("delta", ["git", "diff", "--name-only", BASE, "HEAD"])
        require(record["returncode"] == 0 and set(output.decode().splitlines()) == OWNED, "source-only focused delta")
        output, record = command("base", ["git", "rev-parse", "HEAD^"])
        require(record["returncode"] == 0 and output.decode().strip() == BASE, "exact product parent")
        fixture = ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
        result["content_bytes"] = fixture.stat().st_size
        result["content_sha256"] = sha(fixture.read_bytes())
        output, record = command("toolchain", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal"])
        require(record["returncode"] == 0, "pinned toolchain install")
        output, record = command("rustc", ["rustc", "-Vv"])
        require(record["returncode"] == 0 and b"release: 1.97.1\n" in output, "pinned compiler")
        target_dir = OUT / "target"
        os.environ["CARGO_TARGET_DIR"] = str(target_dir)
        for target, ids in TARGETS.items():
            base = ["cargo", "test", "-p", "er-cli", "--test", target, "--"]
            listing, listed = command(target + "-list", base + ["--list", "--format", "terse"], ROOT / "rust")
            require(listed["returncode"] == 0, target + " list")
            actual = re.findall(rb"^([A-Za-z0-9_:]+): test$", listing, re.M)
            require(sorted(row.decode() for row in actual) == sorted(ids), target + " exact whole-target IDs")
            output, execution = command(target + "-execute", base + ["--format", "terse"], ROOT / "rust")
            counts = re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
            passed = execution["returncode"] == 0 and counts == [(str(len(ids)).encode(), b"0", b"0", b"0", b"0")]
            result["targets"].append({
                "name": target, "ids": ids, "passed": passed,
                "listing_sha256": listed["log_sha256"], "execution_sha256": execution["log_sha256"],
                "reported_counts": [[int(value) for value in row] for row in counts],
            })
            if passed:
                result["tests_passed"] += len(ids)
            else:
                result.setdefault("failures", []).append(target)
        require(not result.get("failures"), "whole current entry targets failed")
        require(result["tests_passed"] == result["tests_expected"] == 13, "exact test count")
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        result["elapsed_ms"] = sum(row["elapsed_ms"] for row in COMMANDS)
        raw = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
        require(len(raw) <= 65536, "compact summary bound")
        (OUT / "compact/summary.json").write_bytes(raw)
        if result["status"] != "passed":
            failed = next((row for row in reversed(COMMANDS) if row["returncode"] != 0), COMMANDS[-1] if COMMANDS else None)
            log = (OUT / (failed["name"] + ".log")).read_bytes() if failed else b""
            excerpt = log[-22000:]
            prefix = (result.get("first_failure", "qualification failed") + "\n").encode()
            (OUT / "compact/failure.txt").write_bytes(prefix + excerpt)
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
