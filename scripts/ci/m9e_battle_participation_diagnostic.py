"""Remote observation-owner F; thirteen real target tests, no XP award or production entry claim."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-battle-participation-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
DEADLINE = time.monotonic() + 1800
BASE_SHA = "5dff3c6f2f858c5e78beba201cdfc69acf9869f8"
TARGETS = [
  [
    "er-game",
    "m9e_battle_participation",
    "rust/crates/er-game/tests/m9e_battle_participation.rs",
    [
      "current_faint_membership_uses_stable_ids_and_removes_player_after_recording",
      "historical_owner_absence_preserves_canonical_bytes",
      "malformed_evidence_capacity_and_counter_failures_roll_back",
      "natural_bootstrap_switch_and_ko_preserve_legacy_gameplay",
      "next_natural_battle_retains_occurrence_highwater",
      "observed_save_snapshot_and_material_replay_preserve_ownership"
    ]
  ],
  [
    "er-game",
    "m9e_new_run_v6",
    "rust/crates/er-game/tests/m9e_new_run_v6.rs",
    [
      "complete_bootstrap_builds_a_deterministic_playable_v6_state"
    ]
  ],
  [
    "er-kernel",
    "m9e_snapshot_v7",
    "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
    [
      "active_snapshot_round_trips_at_a_quiescent_boundary",
      "quiescent_v6_snapshot_migrates_without_gameplay_side_effects",
      "terminal_lifecycle_requires_complete_control_and_terminal_identity",
      "typed_pending_effects_cross_validate_allocator_and_content"
    ]
  ],
  [
    "er-kernel",
    "m9e_material_retention_v7",
    "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
    [
      "v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots",
      "v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix"
    ]
  ]
]
RUST_SOURCES = [
  "rust/crates/er-state/src/lib.rs",
  "rust/crates/er-state/src/m9e_state_v6.rs",
  "rust/crates/er-state/src/current_battle_participation.rs",
  "rust/crates/er-battle/src/m7_resolver.rs",
  "rust/crates/er-game/src/m9e_new_run_v6.rs",
  "rust/crates/er-game/src/m9e_runtime_v6.rs",
  "rust/crates/er-game/tests/m9e_content_v2.rs",
  "rust/crates/er-game/tests/m9e_material_retention.rs",
  "rust/crates/er-game/tests/m9e_material_v6.rs",
  "rust/crates/er-game/tests/m9e_runtime_v6.rs",
  "rust/crates/er-game/tests/m9e_battle_participation.rs",
  "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
  "rust/crates/er-save/src/m9e_save_v2.rs"
]
FIXTURE_INPUTS = {
  "rust/fixtures/m9/engineering/game-content-bundle-v2.json": [
    15810979,
    "6b435b78bc4d62c7f492142752c91610b914a071",
    "640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4"
  ]
}
SOURCES = [
  "rust/crates/er-state/src/lib.rs",
  "rust/crates/er-state/src/m9e_state_v6.rs",
  "rust/crates/er-state/src/current_battle_participation.rs",
  "rust/crates/er-battle/src/m7_resolver.rs",
  "rust/crates/er-game/src/m9e_new_run_v6.rs",
  "rust/crates/er-game/src/m9e_runtime_v6.rs",
  "rust/crates/er-game/tests/m9e_content_v2.rs",
  "rust/crates/er-game/tests/m9e_material_retention.rs",
  "rust/crates/er-game/tests/m9e_material_v6.rs",
  "rust/crates/er-game/tests/m9e_runtime_v6.rs",
  "rust/crates/er-game/tests/m9e_battle_participation.rs",
  "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
  "rust/crates/er-save/src/m9e_save_v2.rs",
  "rust/crates/er-game/tests/m9e_new_run_v6.rs",
  "rust/crates/er-game/src/lib.rs",
  "rust/crates/er-game/src/m72_bootstrap.rs",
  "rust/crates/er-game/src/m9e_material_v6.rs",
  "rust/crates/er-game/src/m9e_content_v2.rs",
  "rust/crates/er-state/src/m7_state.rs",
  "rust/crates/er-kernel/src/game_kernel_v7.rs",
  "rust/crates/er-kernel/src/current_proposal_v7.rs",
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs",
  "rust/crates/er-kernel/src/snapshot_v7.rs",
  "rust/crates/er-battle/src/lib.rs",
  "rust/crates/er-save/src/lib.rs",
  "rust/crates/er-types/src/battle_ids.rs",
  "rust/crates/er-types/src/run_ids.rs",
  "rust/crates/er-game/Cargo.toml",
  "rust/crates/er-state/Cargo.toml",
  "rust/crates/er-battle/Cargo.toml",
  "rust/crates/er-save/Cargo.toml",
  "rust/crates/er-kernel/Cargo.toml",
  "rust/Cargo.toml",
  "rust/Cargo.lock",
  "rust/rust-toolchain.toml",
  "scripts/ci/m9e_current_cost.py",
  "scripts/ci/m9e_battle_participation_diagnostic.py",
  ".github/workflows/m9e-battle-participation-focused.yml"
]
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0",
           "CARGO_PROFILE_TEST_OPT_LEVEL": "0", "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true",
           "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true", "CARGO_PROFILE_TEST_DEBUG": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
os.environ.update(PROFILE)
os.environ["CARGO_TARGET_DIR"] = str(TARGET)
sequence = 0
logs = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, *, cwd=None, seconds=900, bound=16 << 20):
    global sequence, failed_log
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT / "rust" if cwd is None else cwd,
                             environment=dict(os.environ), output=output, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    return output


def cleanup_target():
    if TARGET.is_symlink() or TARGET.resolve().parent != REPORT.resolve():
        raise RuntimeError("owned target containment differs")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    if TARGET.exists():
        raise RuntimeError("owned target cleanup incomplete")


def fixture_inputs(phase):
    result = {}
    for index, (name, (length, expected_blob, expected_sha)) in enumerate(FIXTURE_INPUTS.items(), 1):
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != length:
            raise RuntimeError("exact unchanged historical fixture size/containment differs")
        actual_sha = digest(path)
        if expected_sha is not None and actual_sha != expected_sha:
            raise RuntimeError("known historical export SHA256 differs")
        tree = run(["git", "ls-tree", "-l", "HEAD", "--", name], f"fixture-{phase}-tree-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text()
        if tree.split() != ["100644", "blob", expected_blob, str(length), name]:
            raise RuntimeError("actual candidate fixture tree differs from unchanged base")
        blob = run(["git", "hash-object", "--", name], f"fixture-{phase}-blob-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text().strip()
        if blob != expected_blob:
            raise RuntimeError("actual fixture bytes differ from unchanged committed blob")
        result[name] = {"bytes": length, "sha256": actual_sha, "git_blob": blob, "base_sha": BASE_SHA}
    return result


def execute_target(summary, crate, test_target, test_source, test_ids):
    label = crate + "-" + test_target
    run(["cargo", "clippy", "--locked", "-p", crate, "--test", test_target,
         "--no-deps", "--", "-D", "warnings"], label + "-clippy")
    build = run(["cargo", "test", "--locked", "-p", crate, "--test", test_target,
                 "--no-run", "--message-format=json"], label + "-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == test_target]
    if len(matches) != 1:
        raise RuntimeError("exact participation or compatibility test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / f"rust/crates/{crate}/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / test_source)
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or artifact["profile"].get("opt_level") != "0" or artifact["profile"].get("debuginfo") != 0
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(test_target + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], label + "-list", seconds=30, bound=16384)
    if listing.read_text() != "".join(name + ": test\n" for name in test_ids):
        raise RuntimeError("exact complete sorted target test IDs required")
    receipt = {"crate": crate, "target": test_target, "sha256": binary_hash, "bytes": binary.stat().st_size,
               "profile": artifact["profile"], "source_sha256": summary["source_hashes"][test_source],
               "ids": list(test_ids), "listing_bytes": listing.stat().st_size, "listing_sha256": digest(listing)}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], label + "-execute",
                 cwd=ROOT / f"rust/crates/{crate}", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("all actual target tests must pass without ignored or filtered cases")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    receipt["tests"] = {"executed": len(test_ids), "passed": len(test_ids), "failed": 0, "skipped": 0}
    return receipt

def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("exact Git candidate identity required")
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    summary["source_hashes"] = {name: digest(ROOT / name) for name in SOURCES}
    summary["compiler_configuration"] = dict(PROFILE)
    summary["fixture_inputs"] = fixture_inputs("before")
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(formatted_hashes={name: digest(ROOT / name) for name in RUST_SOURCES},
                       format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch))
        raise RuntimeError("pinned formatting changes required; no participation qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    summary["test_artifacts"] = {}
    for crate, test_target, test_source, test_ids in TARGETS:
        summary["test_artifacts"][crate + ":" + test_target] = execute_target(
            summary, crate, test_target, test_source, test_ids)
    # These existing literal constructors must still type-check. They are not claimed as executed tests.
    compile_only = ["m9e_content_v2", "m9e_material_retention", "m9e_material_v6", "m9e_runtime_v6"]
    run(["cargo", "test", "--locked", "-p", "er-game",
         *[part for name in compile_only for part in ("--test", name)], "--no-run"], "historical-game-constructors-build")
    run(["cargo", "test", "--locked", "-p", "er-save", "--lib", "--no-run"], "save-inline-constructors-build")
    summary["compile_only_targets"] = [*["er-game:" + name for name in compile_only], "er-save:lib"]
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during execution")
    if fixture_inputs("after") != summary["fixture_inputs"]:
        raise RuntimeError("unchanged historical fixture inputs changed during execution")
    ids = sorted(name for _, _, _, test_ids in TARGETS for name in test_ids)
    summary["tests"] = {"executed": len(ids), "passed": len(ids), "failed": 0, "skipped": 0, "ids": ids}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "qualification": "thirteen current observation and compatibility tests; six scripted natural-domain witnesses plus seven unchanged current regressions; no production CLI/browser ingress, XP award or TS asynchronous phase-order qualification"}
    try:
        main(summary)
        cleanup_target()
        if time.monotonic() > DEADLINE:
            raise RuntimeError("owned build cleanup exceeded shared deadline")
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            cleanup_target()
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:2048]
    if summary["status"] != "passed":
        message = (summary.get("failure", summary.get("cleanup_failure", "focused run failed"))
                   + "\nBounded tail; complete logs remain remote.\n").encode()[:4096]
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                allowance = 24576 - len(message)
                stream.seek(max(0, failed_log.stat().st_size - allowance))
                tail = stream.read(allowance)
        (FULL / "failure.txt").write_bytes(message + tail)
    summary["logs"] = logs
    encoded = (json.dumps(summary, sort_keys=True, indent=2) + "\n").encode()
    if len(encoded) > 32768:
        raise RuntimeError("focused compact result exceeds32KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
