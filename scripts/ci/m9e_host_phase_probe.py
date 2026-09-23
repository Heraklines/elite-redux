"""Bounded remote feedback for exact whole phase and host binaries."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

BASE = "2f124b450b5c118191bf0d0775ac42a7d27c00cc"
PROBE_PARENT = "69e04e67cc7a97d16dcde193866aaa861029992a"
BRANCH = "codex/m9e-host-phase-probe-20260923"
OWNED = {
    ".github/workflows/m9e-host-phase-probe.yml",
    "scripts/ci/m9e_host_phase_probe.py",
    "rust/crates/er-kernel/tests/m9e_current_phase_execution.rs",
    "rust/crates/er-state/src/current_source_progression.rs",
    "rust/crates/er-web/src/host_v2.rs",
}
TARGETS = {
    "m9e_current_phase_execution": (
        "er-kernel",
        [
            "controlled_early_ko_flash_owns_clock_egg_candy_and_canceled_suffix",
            "controlled_raw_initial_victory_tail_settles_once_and_retains_boundary",
            "epoch_zero_max_unlock_does_not_request_or_repeat_achievement_reward",
            "raw_knockout_waits_for_xp_prompt_then_level_stats_with_exact_material_restore",
        ],
    ),
    "m9e_host_v2": (
        "er-web",
        [
            "all_five_initialization_modes_and_repro_effect_are_live",
            "browser_host_survives_request_window",
            "browser_network_and_transport_requests_execute_protocol_state",
            "browser_requests_are_atomic_and_conflicting_retries_fail_closed",
            "browser_storage_results_apply_cas_and_loaded_state",
            "browser_time_and_lifecycle_requests_execute_kernel_state_changes",
            "current_repro_exact_cached_retry_does_not_record_twice",
            "current_session_and_browser_match_natural_input_and_external_outcomes",
            "exported_current_repro_replays_raw_non_key_rejection_and_continues",
            "invalid_current_capsule_initialization_is_atomic_and_can_retry",
            "natural_browser_route_produces_typed_ui_transport_presentation_audio_and_assets",
            "presentation_failure_retains_barrier_until_successful_settlement",
            "rejected_browser_sequence_preserves_state_and_exact_cached_response",
            "save_and_terminal_controls_produce_storage_and_terminal_effects",
        ],
    ),
}
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-host-phase-probe"
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
        "tests_expected": 18, "tests_passed": 0, "targets": [],
        "commands": COMMANDS,
        "scope": "two complete native binaries on a focused source repair; not whole-game qualification",
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
            output, executed = run(target + "-execute", base + ["--format", "terse"], ROOT / "rust")
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
