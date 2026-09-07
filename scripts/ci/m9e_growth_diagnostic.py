"""Remote F for natural current campaign characterization; final qualification remains separate."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-growth-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
os.environ["CARGO_TARGET_DIR"] = str(TARGET)
DEADLINE = time.monotonic() + 1800
RUST_SOURCES = ["rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-progression/tests/m9e_growth_levels.rs",
                "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-progression/src/progression.rs", "rust/crates/er-game/src/m9e_new_run_v6.rs", "rust/crates/er-battle/src/m7_resolver.rs", "rust/crates/er-kernel/src/snapshot_v7.rs", "rust/crates/er-progression/src/current_growth_pow.rs"]
TEST_TARGET = "m9e_growth_levels"
TEST_IDS = ["current_growth_matches_pinned_javascript_for_every_u16_level", "current_growth_rejects_zero_level_unknown_rate_and_incomplete_table"]
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


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    sources = [*RUST_SOURCES, "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-kernel/src/snapshot_v7.rs",
               "rust/crates/er-game/src/m72_bootstrap.rs", "rust/crates/er-types/src/m72_bootstrap.rs",
               "rust/crates/er-ai/src/authority_v2.rs", "rust/crates/er-ai/src/full_surface.rs",
               "rust/crates/er-kernel/src/current_coop_setup_v7.rs", "rust/crates/er-game/src/m9e_new_run_v6.rs",
               "rust/crates/er-state/src/m9e_state_v6.rs", "rust/crates/er-state/src/m7_state.rs",
               "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-game/src/m9e_material_v6.rs",
               "rust/Cargo.lock", "rust/Cargo.toml", "rust/rust-toolchain.toml",
               "rust/crates/er-game/Cargo.toml", "rust/crates/er-kernel/Cargo.toml",
               "src/data/exp.ts", "rust/crates/er-progression/Cargo.toml", "scripts/ci/m9e_current_cost.py", "scripts/ci/m9e_growth_diagnostic.py",
               ".github/workflows/m9e-growth-focused.yml",
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
    oracle_blob = run(["git", "hash-object", "src/data/exp.ts"], "oracle-source", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if oracle_blob != "7100a23e24cc7f5fa29742da8f95300b4fceb57a":
        raise RuntimeError("growth oracle source differs from pinned 399d5d3")
    node_version = run(["node", "--version"], "node-version", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    oracle_script = REPORT / "growth-oracle.mjs"
    oracle_script.write_text(r"""
import fs from 'node:fs';
import vm from 'node:vm';
const raw = fs.readFileSync(process.argv[2], 'utf8');
const end = raw.indexOf('export function getLevelRelExp(');
if (end < 0) throw new Error('oracle function boundary absent');
const source = raw.slice(0, end)
  .replace(/export enum GrowthRate \{[\s\S]*?\}/,
    'const GrowthRate = Object.freeze({ ERRATIC: 0, FAST: 1, MEDIUM_FAST: 2, MEDIUM_SLOW: 3, SLOW: 4, FLUCTUATING: 5 });')
  .replace('export function getLevelTotalExp(level: number, growthRate: GrowthRate): number',
    'function getLevelTotalExp(level, growthRate)')
  .replace('let ret: number;', 'let ret;');
const oracle = vm.runInNewContext(source + '\ngetLevelTotalExp;', Object.create(null), { timeout: 1000 });
const rows = [];
for (let rate = 0; rate < 6; rate++) {
  for (let level = 1; level <= 65535; level++) {
    const value = oracle(level, rate);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('unsafe oracle value');
    rows.push([rate, level, value]);
  }
}
const bytes = Buffer.from(JSON.stringify(rows) + '\n');
if (rows.length !== 393210 || bytes.length >= 16 * 1024 * 1024) throw new Error('oracle corpus bound');
fs.writeFileSync(process.argv[3], bytes, { flag: 'wx' });
console.log(JSON.stringify({ cases: rows.length, bytes: bytes.length }));
""")
    oracle_path = REPORT / "growth-oracle.json"
    oracle_result = json.loads(run(["node", str(oracle_script), str(ROOT / "src/data/exp.ts"), str(oracle_path)],
                                  "oracle-corpus", cwd=ROOT, seconds=60, bound=16384).read_text())
    if oracle_result["cases"] != 393210 or oracle_result["bytes"] != oracle_path.stat().st_size:
        raise RuntimeError("oracle corpus receipt differs")
    summary["growth_oracle"] = {"source_blob": oracle_blob, "node_version": node_version,
                                "cases": oracle_result["cases"], "bytes": oracle_path.stat().st_size,
                                "sha256": digest(oracle_path)}
    os.environ["M9E_GROWTH_ORACLE"] = str(oracle_path)
    run(["cargo", "clippy", "--locked", "-p", "er-game", "--lib", "--no-deps", "--", "-D", "warnings"], "clippy-game")
    run(["cargo", "clippy", "--locked", "-p", "er-progression", "--test", TEST_TARGET, "--no-deps", "--", "-D", "warnings"], "clippy-test")
    build = run(["cargo", "test", "--locked", "-p", "er-progression", "--test", TEST_TARGET,
                 "--no-run", "--message-format=json"], "build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == TEST_TARGET]
    if len(matches) != 1:
        raise RuntimeError("exact test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / "rust/crates/er-progression/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / RUST_SOURCES[1])
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(TEST_TARGET + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], "list", seconds=30, bound=16384).read_text()
    if listing != "".join(name + ": test\n" for name in TEST_IDS):
        raise RuntimeError("exact two-test inventory differs")
    summary["test_artifact"] = {"sha256": binary_hash, "bytes": binary.stat().st_size, "profile": artifact["profile"],
                                "source_sha256": summary["source_hashes"][RUST_SOURCES[1]], "ids": TEST_IDS}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], "execute",
                 cwd=ROOT / "rust/crates/er-progression", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [("2", "0", "0", "0", "0")]:
        raise RuntimeError("exact two-test completion differs")
    if (digest(oracle_path) != summary["growth_oracle"]["sha256"] or digest(binary) != binary_hash or digest(bundle) != summary["bundle_sha256"]
            or any(digest(ROOT / name) != value for name, value in summary["source_hashes"].items())):
        raise RuntimeError("actual source/content/executable changed")
    summary["tests"] = {"executed": 2, "passed": 2, "failed": 0, "skipped": 0}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "qualification": "pinned growth formulas across every u16 level only; no campaign or full M9 qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": "928b7cb38ef98fe22741b6d5deb6d9181c8edb9d"}
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
