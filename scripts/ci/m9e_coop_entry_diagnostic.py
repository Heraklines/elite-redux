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
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-coop-entry-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
os.environ["CARGO_TARGET_DIR"] = str(TARGET)
DEADLINE = time.monotonic() + 1800
RUST_SOURCES = ["rust/crates/er-env/src/current.rs", "rust/crates/er-cli/tests/m9e_current_coop_startup.rs",
                "rust/crates/er-cli/src/current_agent.rs", "rust/crates/er-web/src/contracts_v2.rs",
                "rust/crates/er-web/src/host_v2.rs", "rust/crates/er-agent-protocol/src/lib.rs",
                "rust/crates/er-cli/tests/support/m9e_coop_cli_process.rs"]
TEST_TARGET = "m9e_current_coop_startup"
TEST_IDS = ["current_native_cli_owned_coop_retry_replay_matches_browser_host",
            "current_process_worker_owned_coop_retry_replay_matches_browser_host"]
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
               "rust/crates/er-kernel/src/current_coop_setup_v7.rs", "rust/crates/er-game/src/m9e_new_run_v6.rs",
               "rust/crates/er-kernel-worker/src/runtime.rs", "rust/crates/er-cli/src/current_worker_agent.rs",
               "rust/crates/er-cli/src/current_native_capture.rs", "rust/crates/er-repro/src/current.rs",
               "rust/crates/er-cli/Cargo.toml", "rust/crates/er-env/Cargo.toml", "rust/crates/er-web/Cargo.toml",
               "rust/crates/er-game/src/m72_bootstrap.rs", "rust/crates/er-types/src/m72_bootstrap.rs",
               "rust/crates/er-state/src/m9e_state_v6.rs", "rust/crates/er-state/src/m7_state.rs",
               "rust/Cargo.lock", "rust/Cargo.toml", "rust/rust-toolchain.toml",
               "rust/crates/er-game/Cargo.toml", "rust/crates/er-kernel/Cargo.toml",
               "scripts/ci/m9e_current_cost.py", "scripts/ci/m9e_coop_entry_diagnostic.py",
               ".github/workflows/m9e-coop-entry-focused.yml",
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
    run(["cargo", "clippy", "--locked", "-p", "er-env", "-p", "er-web", "-p", "er-agent-protocol", "--lib", "--no-deps", "--", "-D", "warnings"], "clippy-entry")
    run(["cargo", "clippy", "--locked", "-p", "er-cli", "--test", TEST_TARGET, "--no-deps", "--", "-D", "warnings"], "clippy-test")
    compiler_verbose = run(["rustc", "-vV"], "compiler-host", seconds=30, bound=16384).read_text()
    hosts = re.findall(r"^host: ([a-zA-Z0-9_-]+)$", compiler_verbose, re.M)
    if len(hosts) != 1:
        raise RuntimeError("actual build target required")
    worker_build = run(["cargo", "build", "--locked", "-p", "er-kernel-worker", "--bin", "er-kernel-worker",
                        "--message-format=json"], "worker-build")
    worker_rows = [json.loads(line) for line in worker_build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in worker_rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete Worker build required")
    worker_matches = [row for row in worker_rows if row.get("reason") == "compiler-artifact"
                      and row.get("target", {}).get("name") == "er-kernel-worker" and row.get("target", {}).get("kind") == ["bin"]]
    if len(worker_matches) != 1:
        raise RuntimeError("sole Worker executable required")
    worker_artifact = worker_matches[0]
    worker_binary = Path(worker_artifact.get("executable") or "")
    if (worker_artifact.get("manifest_path") != str(ROOT / "rust/crates/er-kernel-worker/Cargo.toml")
            or worker_artifact.get("features") != [] or worker_artifact.get("profile", {}).get("test") is not False
            or worker_artifact["profile"].get("debug_assertions") is not True
            or worker_artifact["profile"].get("opt_level") != "1"
            or worker_binary != TARGET / "debug/er-kernel-worker" or not worker_binary.is_file()
            or worker_binary.is_symlink() or worker_binary.resolve() != worker_binary
            or not 0 < worker_binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual Worker executable/profile/ownership differs")
    worker_hash = digest(worker_binary)
    summary["worker_artifact"] = {"sha256": worker_hash, "bytes": worker_binary.stat().st_size,
                                  "profile": worker_artifact["profile"], "host": hosts[0], "source_sha": sha}
    os.environ.update({"ER_M9E_WORKER_EXECUTABLE": str(worker_binary), "ER_M9E_WORKER_EXECUTABLE_SHA256": worker_hash,
                       "ER_M9E_WORKER_SOURCE_SHA": sha, "ER_M9E_WORKER_BUILD_TARGET": hosts[0], "ER_M9E_WORKER_BUILD_PROFILE": "debug"})
    build = run(["cargo", "test", "--locked", "-p", "er-cli", "--test", TEST_TARGET,
                 "--no-run", "--message-format=json"], "build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == TEST_TARGET]
    if len(matches) != 1:
        raise RuntimeError("exact test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / "rust/crates/er-cli/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / RUST_SOURCES[1])
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or artifact["profile"].get("opt_level") != "1"
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(TEST_TARGET + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    cli_matches = [row for row in rows if row.get("reason") == "compiler-artifact"
                   and row.get("target", {}).get("name") == "er-cli" and row.get("target", {}).get("kind") == ["bin"]
                   and row.get("profile", {}).get("test") is False]
    if len(cli_matches) != 1:
        raise RuntimeError("sole current CLI executable required")
    cli_artifact = cli_matches[0]
    cli_binary = Path(cli_artifact.get("executable") or "")
    if (cli_artifact.get("manifest_path") != str(ROOT / "rust/crates/er-cli/Cargo.toml")
            or cli_binary != TARGET / "debug/er-cli" or not cli_binary.is_file() or cli_binary.is_symlink()
            or cli_binary.resolve() != cli_binary or not 0 < cli_binary.stat().st_size <= 128 << 20
            or cli_artifact.get("profile", {}).get("debug_assertions") is not True
            or cli_artifact["profile"].get("opt_level") != "1"):
        raise RuntimeError("actual CLI executable ownership differs")
    cli_hash = digest(cli_binary)
    summary["cli_artifact"] = {"sha256": cli_hash, "bytes": cli_binary.stat().st_size, "profile": cli_artifact["profile"]}
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], "list", seconds=30, bound=16384).read_text()
    if listing != "".join(name + ": test\n" for name in TEST_IDS):
        raise RuntimeError("exact two-test inventory differs")
    summary["test_artifact"] = {"sha256": binary_hash, "bytes": binary.stat().st_size, "profile": artifact["profile"],
                                "source_sha256": summary["source_hashes"][RUST_SOURCES[1]], "ids": TEST_IDS}
    executions = []
    for index, test_id in enumerate(TEST_IDS):
        output = run([str(binary), "--exact", test_id, "--format", "terse", "--nocapture", "--test-threads=1"],
                     f"execute-{index + 1}", cwd=ROOT / "rust/crates/er-cli", seconds=600, bound=16384).read_text()
        counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
        if counts != [("1", "0", "0", "0", "1")]:
            raise RuntimeError("exact individual backend test completion differs")
        executions.append(test_id)
    if executions != TEST_IDS:
        raise RuntimeError("both mandatory backend executions required")
    summary["executed_test_ids"] = executions
    if (digest(worker_binary) != worker_hash or digest(cli_binary) != cli_hash or digest(binary) != binary_hash or digest(bundle) != summary["bundle_sha256"]
            or any(digest(ROOT / name) != value for name, value in summary["source_hashes"].items())):
        raise RuntimeError("actual source/content/executable changed")
    summary["tests"] = {"executed": 2, "passed": 2, "failed": 0, "skipped": 0}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "qualification": "focused actual CLI/native/process-Worker with native browser-host mirror; no Wasm/WebRTC or M9 qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": "56fa6b4518adfd8091a58d29c87666d7c49d374d"}
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
