"""Remote F for current owned natural setup; cross-entry integration remains separate."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-coop-choices-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
os.environ["CARGO_TARGET_DIR"] = str(TARGET)
DEADLINE = time.monotonic() + 1800
RUST_SOURCES = ["rust/crates/er-game/src/m9e_new_run_v6.rs", "rust/crates/er-kernel/tests/m9e_natural_coop_campaign_v7.rs",
                "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-kernel/src/snapshot_v7.rs",
                "rust/crates/er-kernel/src/current_coop_setup_v7.rs", "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-battle/src/m7_resolver.rs"]
TEST_TARGET = "m9e_natural_coop_campaign_v7"
TEST_IDS = ["natural_owned_cooperative_campaign_reaches_wave_200_victory"]
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


def execute_target(summary, test_target, test_source, test_ids, name_prefix=""):
    run(["cargo", "clippy", "--locked", "-p", "er-kernel", "--test", test_target, "--no-deps", "--", "-D", "warnings"], name_prefix + "clippy-test")
    build = run(["cargo", "test", "--locked", "-p", "er-kernel", "--test", test_target,
                 "--no-run", "--message-format=json"], name_prefix + "build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == test_target]
    if len(matches) != 1:
        raise RuntimeError("exact test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / "rust/crates/er-kernel/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / test_source)
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or artifact["profile"].get("opt_level") != "1"
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(test_target + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], name_prefix + "list", seconds=30, bound=16384).read_text()
    if listing != "".join(name + ": test\n" for name in test_ids):
        raise RuntimeError("exact test inventory differs")
    artifact_receipt = {"sha256": binary_hash, "bytes": binary.stat().st_size, "profile": artifact["profile"],
                                "source_sha256": summary["source_hashes"][test_source], "ids": test_ids}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], name_prefix + "execute",
                 cwd=ROOT / "rust/crates/er-kernel", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("exact test completion differs")
    campaign = re.findall(r"M9E_NATURAL_COOP_CAMPAIGN wave=200 outcome=Victory decisions=(\d+) proposals=(\d+) materials=(\d+) presentations=(\d+) rewards=(\d+) progression=(\d+)", output)
    if len(campaign) != 1:
        raise RuntimeError("one complete natural cooperative Victory receipt required")
    summary["natural_cooperative_campaign"] = dict(zip(("decisions", "proposals", "materials", "presentations", "rewards", "progression"), map(int, campaign[0])))
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    return artifact_receipt


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    sources = [*RUST_SOURCES, "rust/crates/er-kernel/tests/m9e_game_kernel_v7.rs", "rust/crates/er-kernel/tests/m9e_ai_command_transaction_v7.rs", "rust/crates/er-kernel/tests/m9e_natural_replacement_v7.rs", "rust/crates/er-battle/src/m7_resolver.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-progression/src/progression.rs", "rust/crates/er-progression/src/current_growth_pow.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-kernel/src/snapshot_v7.rs",
               "rust/crates/er-game/src/m72_bootstrap.rs", "rust/crates/er-types/src/m72_bootstrap.rs",
               "rust/crates/er-state/src/m9e_state_v6.rs", "rust/crates/er-state/src/m7_state.rs",
               "rust/crates/er-rng/src/phaser.rs", "rust/crates/er-rng/src/battle.rs", "rust/Cargo.lock", "rust/Cargo.toml", "rust/rust-toolchain.toml",
               "rust/crates/er-game/Cargo.toml", "rust/crates/er-kernel/Cargo.toml",
               "scripts/ci/m9e_current_cost.py", "scripts/ci/m9e_coop_choices_diagnostic.py",
               ".github/workflows/m9e-coop-choices-focused.yml",
               "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json"]
    summary["source_hashes"] = {name: digest(ROOT / name) for name in sources}
    bundle = ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
    summary["bundle_sha256"] = digest(bundle)
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary["formatted_hashes"] = {name: digest(ROOT / name) for name in RUST_SOURCES}
        summary["format_patch_bytes"] = patch.stat().st_size
        summary["format_patch_sha256"] = digest(patch)
        raise RuntimeError("pinned formatting changes required; no game qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    run(["cargo", "clippy", "--locked", "-p", "er-game", "--lib", "--no-deps", "--", "-D", "warnings"], "clippy-game")
    summary["test_artifact"] = execute_target(summary, TEST_TARGET, RUST_SOURCES[1], TEST_IDS)
    if (digest(bundle) != summary["bundle_sha256"]
            or any(digest(ROOT / name) != value for name, value in summary["source_hashes"].items())):
        raise RuntimeError("actual source/content/executable changed")
    summary["tests"] = {"executed": 1, "passed": 1, "failed": 0, "skipped": 0}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "qualification": "optimized native natural 200-wave co-op with duplicate delivery and same-generation restore; no generation-two or browser qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": "09f76be5daabbcda3b2d70e60e7a927837e2165f"}
    try:
        main(summary)
        if TARGET.exists():
            shutil.rmtree(TARGET)
        if TARGET.exists() or time.monotonic() > DEADLINE:
            raise RuntimeError("owned build cleanup exceeded deadline")
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                stream.seek(max(0, failed_log.stat().st_size - 245000))
                tail = stream.read(245000)
        (FULL / "failure.txt").write_bytes((str(error) + "\nBounded tail; complete logs remain remote.\n").encode() + tail)
    finally:
        if TARGET.exists():
            shutil.rmtree(TARGET)
    summary["logs"] = logs
    encoded = (json.dumps(summary, sort_keys=True, indent=2) + "\n").encode()
    if len(encoded) > 16384:
        raise RuntimeError("focused compact result exceeds bound")
    (COMPACT / "summary.json").write_bytes(encoded)
    print(json.dumps({key: summary[key] for key in ("status", "qualification", "source_sha", "run_id")}))
    raise SystemExit(0 if summary["status"] == "passed" else 1)
