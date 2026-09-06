"""Remote focused measurement only; not native/platform integration qualification."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import time

from m9e_current_cost import check_executable, discover_release, parse_line, read_content, run_bounded, validate_listing

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
    result = run_bounded(command, cwd=cwd, environment=dict(os.environ), output=FULL / name,
                         seconds=seconds, byte_limit=bound, global_deadline=DEADLINE)
    return result["path"]


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() != sha:
        raise RuntimeError("checkout identity mismatch")
    sources = [SOURCE, "scripts/ci/m9e_cost_diagnostic.py", "scripts/ci/m9e_current_cost.py",
               "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json", "rust/crates/er-game/src/m9e_content_v2.rs", ".github/workflows/m9e-current-cost-focused.yml",
               "rust/Cargo.lock", "rust/Cargo.toml", "rust/rust-toolchain.toml",
               "rust/crates/er-repro/Cargo.toml", "rust/crates/er-env/src/current.rs",
               "rust/crates/er-repro/src/current.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs"]
    summary["source_hashes"] = {name: digest(ROOT / name) for name in sources}
    summary["bundle_sha256"] = digest(RUST / "fixtures/m9/engineering/game-content-bundle-v2.json")
    run(["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true", "--check", str(ROOT / SOURCE)],
        "format.log", 60, 262144)
    content = read_content(ROOT)
    summary["content_binding"] = content
    os.environ["CARGO_TARGET_DIR"] = str(BUILD)
    base = ["--locked", "--release", "-p", "er-repro", "--test", TARGET]
    run(["cargo", "clippy", *base, "--no-deps", "--", "-D", "warnings"], "clippy.log", 600)
    build = run(["cargo", "test", *base, "--no-run", "--message-format=json"], "build.jsonl", 900)
    records = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    executable, artifact = discover_release(records, repository=ROOT, target_directory=BUILD.resolve())
    summary["release_artifact"] = artifact
    profile = artifact["cargo_profile"]
    before = artifact["sha256"]
    check_executable(executable, artifact)
    listing = run([str(executable), "--list", "--format", "terse"], "list.log", 30, 16384).read_bytes()
    validate_listing(listing, [TEST])
    check_executable(executable, artifact)
    output = run([str(executable), TEST, "--exact", "--format", "terse", "--nocapture", "--test-threads=1"],
                 "execute.log", 600, 16384).read_bytes()
    if (not re.search(rb"test result: ok\. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;", output)
            or before != digest(executable)):
        raise RuntimeError("test completion or executable conservation mismatch")
    lines = [line for line in output.splitlines(keepends=True) if line.startswith(PREFIX)]
    if len(lines) != 1 or len(lines[0]) >= 8192 or not lines[0].endswith(b"\n"):
        raise RuntimeError("bounded measurement line mismatch")
    evidence = parse_line(lines[0], architecture=platform.machine(), operating_system=platform.system().lower(),
                          bundle_bytes=content["bundle"]["bytes"], content_identity=content["identity"])
    check_executable(executable, artifact)
    if read_content(ROOT) != content:
        raise RuntimeError("content bytes changed during release measurement")
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
