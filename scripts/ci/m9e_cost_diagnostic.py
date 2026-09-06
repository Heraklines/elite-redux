"""Remote focused measurement only; not native/platform integration qualification."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
RUST = ROOT / "rust"
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-cost-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
SOURCE = "rust/crates/er-repro/tests/m9e_current_cost_probe.rs"
TARGET = "m9e_current_cost_probe"
TEST = "current_native_phase_costs_preserve_semantics"
BUILD = RUST / "target/m9e-cost-focused"
DEADLINE = time.monotonic() + 1800
PREFIX = b"M9E_CURRENT_COST_PROBE "


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(command, name, seconds, bound=16 << 20, cwd=RUST):
    path = FULL / name
    deadline = min(DEADLINE, time.monotonic() + seconds)
    with path.open("wb") as output:
        child = subprocess.Popen(command, cwd=cwd, stdout=output, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        try:
            while child.poll() is None:
                if time.monotonic() >= deadline or path.stat().st_size > bound:
                    raise RuntimeError(f"bounded command failed: {name}")
                time.sleep(0.1)
            if child.returncode or path.stat().st_size > bound:
                raise RuntimeError(f"command failed: {name}, exit={child.returncode}")
        finally:
            # Reap the command and its process group even after a timeout/failure.
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
    return path


def measurements(value):
    expected = {"schema_version", "probe", "warmups_per_phase", "samples_per_phase",
                "debug_assertions", "architecture", "os", "bundle_bytes", "content_identity",
                "content_phases", "checkpoints", "limitations"}
    if (set(value) != expected or value["schema_version"] != 1 or value["probe"] != TEST
            or value["warmups_per_phase"] != 1 or value["samples_per_phase"] != 3
            or value["debug_assertions"] is not False or value["os"] != "linux"
            or value["architecture"] != platform.machine()
            or value["bundle_bytes"] != (RUST / "fixtures/m9/engineering/game-content-bundle-v2.json").stat().st_size):
        raise RuntimeError("measurement source/profile/schema mismatch")
    checkpoint_names = ["title", "mode", "starter", "active"]
    phases = ["fork", "snapshot", "validate", "observe", "canonical_encode_snapshot",
              "canonical_digest_snapshot", "blake3_preencoded_snapshot", "apply_effectful_raw_input",
              "recorder_append"]
    if [row["checkpoint"] for row in value["checkpoints"]] != checkpoint_names:
        raise RuntimeError("natural checkpoint inventory mismatch")
    groups = [(value["content_phases"], ["content_decode", "content_prepare_and_arc"])]
    groups += [(row["phases"], phases) for row in value["checkpoints"]]
    for rows, names in groups:
        if [row["phase"] for row in rows] != names:
            raise RuntimeError("measurement phase inventory mismatch")
        for row in rows:
            if (set(row) != {"phase", "min_ns", "median_ns"}
                    or any(type(row[key]) is not int for key in ("min_ns", "median_ns"))
                    or not 0 <= row["min_ns"] <= row["median_ns"]):
                raise RuntimeError("invalid measured duration")
    # Rust owns the 38 full state/effect/capsule/replay assertions. These metadata
    # checks do not replace them or establish the final cross-phase cost gate.
    return value


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() != sha:
        raise RuntimeError("checkout identity mismatch")
    sources = [SOURCE, "scripts/ci/m9e_cost_diagnostic.py", ".github/workflows/m9e-current-cost-focused.yml",
               "rust/Cargo.lock", "rust/Cargo.toml", "rust/rust-toolchain.toml",
               "rust/crates/er-repro/Cargo.toml", "rust/crates/er-env/src/current.rs",
               "rust/crates/er-repro/src/current.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs"]
    summary["source_hashes"] = {name: digest(ROOT / name) for name in sources}
    summary["bundle_sha256"] = digest(RUST / "fixtures/m9/engineering/game-content-bundle-v2.json")
    run(["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true", "--check", str(ROOT / SOURCE)],
        "format.log", 60, 262144)
    os.environ["CARGO_TARGET_DIR"] = str(BUILD)
    base = ["--locked", "--release", "-p", "er-repro", "--test", TARGET]
    run(["cargo", "clippy", *base, "--no-deps", "--", "-D", "warnings"], "clippy.log", 600)
    build = run(["cargo", "test", *base, "--no-run", "--message-format=json"], "build.jsonl", 1200)
    artifacts = []
    for line in build.read_text().splitlines():
        if not line.startswith("{"):
            continue
        record = json.loads(line)
        target = record.get("target", {})
        if (record.get("reason") == "compiler-artifact" and target.get("name") == TARGET
                and target.get("kind") == ["test"] and record.get("executable")):
            artifacts.append(record)
    if len(artifacts) != 1:
        raise RuntimeError("missing or ambiguous release test executable")
    artifact = artifacts[0]
    profile = artifact["profile"]
    executable = Path(artifact["executable"])
    if (Path(artifact["manifest_path"]).resolve() != (RUST / "crates/er-repro/Cargo.toml").resolve()
            or Path(artifact["target"]["src_path"]).resolve() != (ROOT / SOURCE).resolve()
            or profile.get("test") is not True or profile.get("debug_assertions") is not False
            or profile.get("opt_level") != "3" or not executable.is_absolute()
            or executable.is_symlink() or not executable.is_file()
            or not executable.resolve().is_relative_to(BUILD.resolve())
            or not os.access(executable, os.X_OK) or not 0 < executable.stat().st_size <= 128 << 20):
        raise RuntimeError("release executable identity/profile mismatch")
    before = digest(executable)
    listing = run([str(executable), "--list", "--format", "terse"], "list.log", 30, 65536).read_text()
    if [line[:-6] for line in listing.splitlines() if line.endswith(": test")] != [TEST]:
        raise RuntimeError("focused test identity mismatch")
    output = run([str(executable), "--format", "terse", "--nocapture", "--test-threads=1"],
                 "execute.log", 600, 262144).read_bytes()
    if (not re.search(rb"test result: ok\. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;", output)
            or before != digest(executable)):
        raise RuntimeError("test completion or executable conservation mismatch")
    lines = [line for line in output.splitlines(keepends=True) if line.startswith(PREFIX)]
    if len(lines) != 1 or len(lines[0]) >= 8192 or not lines[0].endswith(b"\n"):
        raise RuntimeError("bounded measurement line mismatch")
    evidence = measurements(json.loads(lines[0][len(PREFIX):]))
    if any(digest(ROOT / name) != value for name, value in summary["source_hashes"].items()):
        raise RuntimeError("source changed during measurement")
    summary.update(status="passed", tests={"selected": 1, "executed": 1, "passed": 1, "failed": 0, "skipped": 0},
                   release_profile=profile, executable_sha256=before, executable_bytes=executable.stat().st_size,
                   evidence_line_sha256=hashlib.sha256(lines[0]).hexdigest(), evidence_line_bytes=len(lines[0]),
                   evidence=evidence)


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "qualification": "focused release measurement only; no integrated native/platform/Q qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": "5b2c068883db862f21e30a06480aeb5bda57cb4a"}
    try:
        main(summary)
    except Exception as error:
        summary["failure"] = str(error)
        logs = sorted(FULL.iterdir(), key=lambda path: path.stat().st_mtime)
        tail = b""
        if logs:
            with logs[-1].open("rb") as stream:
                stream.seek(max(0, logs[-1].stat().st_size - 245000))
                tail = stream.read(245000)
        (COMPACT / "failure.txt").write_bytes((str(error) + "\nNamed diagnostic tail; complete log remains remote.\n").encode() + tail)
    encoded = (json.dumps(summary, sort_keys=True, indent=2) + "\n").encode()
    if len(encoded) > 16384:
        raise RuntimeError("compact measurement metadata exceeds 16 KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    print(json.dumps({key: summary[key] for key in ("status", "qualification", "source_sha", "run_id")}))
    raise SystemExit(0 if summary["status"] == "passed" else 1)
