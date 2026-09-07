"""Remote F for current owned natural setup; cross-entry integration remains separate."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-rng-surrogate-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
os.environ["CARGO_TARGET_DIR"] = str(TARGET)
DEADLINE = time.monotonic() + 1800
RUST_SOURCES = ["rust/crates/er-rng/tests/m9e_shifted_utf16.rs", "rust/crates/er-rng/src/phaser.rs", "rust/crates/er-rng/src/battle.rs"]
TEST_TARGET = "m9e_shifted_utf16"
TEST_IDS = ["shifted_utf16_battle_draws_and_initialization_match_pinned_phaser", "shifted_utf16_speed_shuffle_matches_pinned_phaser_and_restores_outer_rng"]
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
    run(["cargo", "clippy", "--locked", "-p", "er-rng", "--test", test_target, "--no-deps", "--", "-D", "warnings"], name_prefix + "clippy-test")
    build = run(["cargo", "test", "--locked", "-p", "er-rng", "--test", test_target,
                 "--no-run", "--message-format=json"], name_prefix + "build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == test_target]
    if len(matches) != 1:
        raise RuntimeError("exact test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / "rust/crates/er-rng/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / test_source)
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
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
                 cwd=ROOT / "rust/crates/er-rng", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("exact test completion differs")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    return artifact_receipt


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    sources = [*RUST_SOURCES, "rust/crates/er-rng/src/lib.rs", "rust/crates/er-rng/src/audit.rs",
               "rust/crates/er-rng/Cargo.toml", "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
               "scripts/ci/m9e_current_cost.py", "scripts/ci/m9e_rng_surrogate_diagnostic.py",
               "scripts/ci/m9e_rng_surrogate_oracle.cjs", ".github/workflows/m9e-rng-surrogate-focused.yml"]
    summary["source_hashes"] = {name: digest(ROOT / name) for name in sources}
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(formatted_hashes={name: digest(ROOT / name) for name in RUST_SOURCES}, format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch))
        raise RuntimeError("pinned formatting changes required; no RNG qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    node = run(["node", "--version"], "node", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if not node.startswith("v22."):
        raise RuntimeError("declared Node 22 reference required")
    commit = "a9965625f49cf366584f454556b039e06e8adad6"
    references = [("src/math/random-data-generator/RandomDataGenerator.js", 13070, "105b4086d5784b33375d597acce4e0ceb2fa1fc644190481c5ba74da5276cbd5"),
                  ("src/utils/Class.js", 6420, "02f503a747ba7834f38b6118e0e0a8441e9482ae3b73a641f400bc3c61362389")]
    for name, length, expected in references:
        path = REPORT / "reference" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"https://raw.githubusercontent.com/phaserjs/phaser/{commit}/{name}", timeout=30) as response:
            data = response.read(length + 1)
        if len(data) != length or hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError("pinned Phaser reference source mismatch")
        path.write_bytes(data)
    os.environ["M9E_PHASER_REFERENCE"] = str(REPORT / "reference" / references[0][0])
    os.environ["M9E_RNG_ORACLE_PATH"] = str(FULL / "rng-oracle.json")
    run(["node", "scripts/ci/m9e_rng_surrogate_oracle.cjs"], "oracle", cwd=ROOT, seconds=30, bound=16384)
    oracle = FULL / "rng-oracle.json"
    if not 0 < oracle.stat().st_size < 65536:
        raise RuntimeError("bounded reference oracle required")
    vectors = json.loads(oracle.read_bytes())
    if vectors["commit"] != commit or [len(vectors[key]) for key in ("shuffle", "battle", "initialize")] != [30, 21, 18]:
        raise RuntimeError("complete independent reference case inventory required")
    summary["oracle"] = {"sha256": digest(oracle), "bytes": oracle.stat().st_size, "cases": 69, "node": node, "phaser_commit": commit,
                         "reference_sha256": {name: expected for name, _, expected in references}}
    summary["test_artifact"] = execute_target(summary, TEST_TARGET, RUST_SOURCES[0], TEST_IDS)
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()) or digest(oracle) != summary["oracle"]["sha256"]:
        raise RuntimeError("source or reference changed during execution")
    summary["tests"] = {"executed": 2, "passed": 2, "failed": 0, "skipped": 0}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "qualification": "69 pinned Phaser shifted-UTF16 cases on three RNG entry points only; no full M9 qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": "2bfe69d0179f342583335b056dc5393055c368d3"}
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
