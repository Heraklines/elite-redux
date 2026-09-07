"""Remote F for foundational normal Classic neutral XP; no runtime/oracle claim."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-xp-source-award-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
DEADLINE = time.monotonic() + 1800
BASE_SHA = "806e52ab24d29c389c705b444351ecf30409f015"
TEST_TARGET = "m9e_current_experience"
TEST_SOURCE = "rust/crates/er-progression/tests/m9e_current_experience.rs"
RUST_SOURCES = ["rust/crates/er-progression/src/lib.rs",
                "rust/crates/er-progression/src/current_experience.rs", TEST_SOURCE]
TEST_IDS = ["capped_addition_preserves_multi_level_gains_discards_new_excess_and_keeps_old_experience",
            "invalid_and_overflowing_experience_inputs_leave_borrowed_source_state_unchanged",
            "neutral_defeat_values_preserve_form_trainer_and_distribution_floor_order",
            "neutral_distribution_retains_full_participant_denominator_and_recipient_eligibility",
            "normal_classic_caps_cover_every_wave_and_each_decade_boundary"]
GROWTH_INPUTS = {
    "rust/crates/er-progression/src/progression.rs": (27646, "842400cd68f24a2f431c62c64813c3600735e86dd8acdeea42dc6ba10d7baacd"),
    "rust/crates/er-progression/src/current_growth_pow.rs": (5846, "3bb274b506f4861a18f51a1e358e73f0cec9c30d890886ed9d9c0e8d1a042152"),
    "rust/crates/er-progression/tests/fixtures/m9e_growth_oracle.json": (10123, "2d667e9aabe6ca83e852db87f62cd3d9e3b733faaf269e3df8cad86741501dbe"),
}
SOURCES = [*RUST_SOURCES, *GROWTH_INPUTS, "rust/crates/er-progression/Cargo.toml",
           "rust/crates/er-types/src/run_ids.rs", "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
           "scripts/ci/m9e_current_cost.py", "scripts/ci/m9e_xp_source_award_diagnostic.py",
           ".github/workflows/m9e-xp-source-award-focused.yml"]
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


def execute_target(summary):
    run(["cargo", "clippy", "--locked", "-p", "er-progression", "--test", TEST_TARGET,
         "--no-deps", "--", "-D", "warnings"], "clippy-test")
    build = run(["cargo", "test", "--locked", "-p", "er-progression", "--test", TEST_TARGET,
                 "--no-run", "--message-format=json"], "build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == TEST_TARGET]
    if len(matches) != 1:
        raise RuntimeError("exact current experience test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / "rust/crates/er-progression/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / TEST_SOURCE)
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or artifact["profile"].get("opt_level") != "0"
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(TEST_TARGET + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], "list", seconds=30, bound=16384)
    if listing.read_text() != "".join(name + ": test\n" for name in TEST_IDS):
        raise RuntimeError("exact five sorted test IDs required")
    receipt = {"sha256": binary_hash, "bytes": binary.stat().st_size, "profile": artifact["profile"],
               "source_sha256": summary["source_hashes"][TEST_SOURCE], "ids": TEST_IDS,
               "listing_bytes": listing.stat().st_size, "listing_sha256": digest(listing)}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], "execute",
                 cwd=ROOT / "rust/crates/er-progression", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [("5", "0", "0", "0", "0")]:
        raise RuntimeError("all five actual tests must pass without ignored or filtered cases")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
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
    summary["growth_inputs"] = {}
    for name, (length, expected) in GROWTH_INPUTS.items():
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != length or digest(path) != expected:
            raise RuntimeError("existing exact base growth input differs")
        summary["growth_inputs"][name] = {"bytes": length, "sha256": expected, "base_sha": BASE_SHA}
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(formatted_hashes={name: digest(ROOT / name) for name in RUST_SOURCES},
                       format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch))
        raise RuntimeError("pinned formatting changes required; no XP qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    summary["test_artifact"] = execute_target(summary)
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()):
        raise RuntimeError("actual source or growth fixture changed during execution")
    summary["tests"] = {"executed": 5, "passed": 5, "failed": 0, "skipped": 0, "ids": TEST_IDS}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "qualification": "five foundational normal Classic neutral experience calculation tests using existing growth inputs; no runtime, full modifier or fresh source oracle qualification"}
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