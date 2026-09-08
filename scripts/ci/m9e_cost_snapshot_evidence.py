"""Remote reproduction of exact original cost checkpoints; no new cost claim."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
COHORT = ROOT / "cohort"
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-cost-snapshot"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
SNAPSHOTS = REPORT / "snapshots"
TARGET = REPORT / "target"
START = int(os.environ["M9E_FOCUS_STARTED_AT"])
DEADLINE = time.monotonic() + 1800 - (time.time() - START) - 20
SOURCE = "rust/crates/er-repro/tests/m9e_current_cost_probe.rs"
HELPER = "scripts/ci/m9e_current_cost.py"
ORIGINAL_SHA = "aaa5fe82ecd79baa4905902ea77fb4ba990f3b3d4202cc388c94f0f511554b36"
HELPER_SHA = "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75"
ANCHOR = b"    assert_eq!(session.snapshot()?, snapshot);\n    Ok(json!({\n"
INSTRUMENTATION = b'''    assert_eq!(session.snapshot()?, snapshot);
    if checkpoint.name == "active" {
        std::fs::write(std::env::var("M9E_COST_SNAPSHOT")?, &encoded)?;
    }
    Ok(json!({
'''
LOGS = {}


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(argv, name, seconds, maximum=16 << 20, cwd=None):
    path = FULL / name
    before = time.monotonic()
    deadline = min(DEADLINE, before + seconds)
    need(before < deadline, "shared deadline before command")
    with path.open("xb") as output:
        child = subprocess.Popen(argv, cwd=cwd or COHORT / "rust", stdout=output,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while child.poll() is None:
                need(time.monotonic() < deadline and path.stat().st_size <= maximum,
                     "command deadline/output: " + name)
                time.sleep(0.1)
            need(child.returncode == 0 and path.stat().st_size <= maximum,
                 "command failed: " + name)
        finally:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
    LOGS[name] = dict(bytes=path.stat().st_size, sha256=digest(path),
                      elapsed_seconds=time.monotonic() - before, argv=argv)
    return path


def main(summary):
    inputs_path = ROOT / "scripts/ci/m9e_cost_snapshot_inputs.json"
    inputs = json.loads(inputs_path.read_bytes())
    selected = [row for row in inputs["cohorts"] if row["name"] == os.environ["M9E_COST_COHORT"]]
    need(len(selected) == 1, "unique original cohort")
    cohort = selected[0]
    original = (COHORT / SOURCE).read_bytes()
    need(hashlib.sha256(original).hexdigest() == ORIGINAL_SHA and original.count(ANCHOR) == 1,
         "exact original cost test and unique attachment anchor")
    need(digest(COHORT / HELPER) == HELPER_SHA, "helper pin before import")
    need(run(["git", "rev-parse", "HEAD"], "cohort-head.log", 30, 4096, COHORT).read_text().strip()
         == cohort["source_sha"], "exact original source checkout")
    need(run(["git", "rev-parse", "HEAD"], "supplement-head.log", 30, 4096, ROOT).read_text().strip()
         == os.environ["GITHUB_SHA"], "exact supplemental source")
    run(["git", "diff", "--exit-code", "HEAD", "--"], "clean-before.log", 30, 4096, COHORT)
    need(len(cohort["source_hashes"]) == 16, "original complete cost source inventory")
    for path, expected in cohort["source_hashes"].items():
        need(digest(COHORT / path) == expected, "original cost source: " + path)
    manifests = {str(path.relative_to(COHORT)): digest(path)
                 for path in sorted((COHORT / "rust/crates").glob("*/Cargo.toml"))}
    manifest_bytes = (json.dumps(manifests, sort_keys=True, separators=(",", ":")) + "\n").encode()
    need(len(manifests) == 35 and hashlib.sha256(manifest_bytes).hexdigest()
         == cohort["cargo_manifests"]["sha256"], "all original Cargo manifests")
    spec = importlib.util.spec_from_file_location("m9e_original_cost", COHORT / HELPER)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    content = helper.read_content(COHORT)
    need(content == cohort["content"], "exact original content bytes and all identifiers")
    modified = original.replace(ANCHOR, INSTRUMENTATION)
    snapshot = SNAPSHOTS / (cohort["name"] + "-active.json")
    summary.update(cohort=cohort["name"], cohort_sha=cohort["source_sha"],
                   original_run_id=cohort["run_id"], inputs_sha256=digest(inputs_path),
                   original_source_sha256=ORIGINAL_SHA,
                   instrumented_source_sha256=hashlib.sha256(modified).hexdigest(),
                   source_hashes=cohort["source_hashes"], content=content)
    try:
        (COHORT / SOURCE).write_bytes(modified)
        os.environ.update(CARGO_TARGET_DIR=str(TARGET), CARGO_INCREMENTAL="0",
                          CARGO_PROFILE_DEV_DEBUG="0", CARGO_PROFILE_TEST_DEBUG="0",
                          RUSTUP_TOOLCHAIN="1.97.1", M9E_COST_SNAPSHOT=str(snapshot))
        need(not any(os.environ.get(key) for key in (
            "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER",
            "CARGO_PROFILE_RELEASE_OPT_LEVEL", "CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS",
            "CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS", "CARGO_PROFILE_RELEASE_DEBUG")),
            "unchanged original release configuration")
        base = ["--locked", "--release", "-p", "er-repro", "--test", "m9e_current_cost_probe"]
        run(["cargo", "clippy", *base, "--no-deps", "--", "-D", "warnings"], "clippy.log", 600)
        build = run(["cargo", "test", *base, "--no-run", "--message-format=json"], "build.jsonl", 900)
        records = [json.loads(line) for line in build.read_bytes().splitlines() if line.startswith(b"{")]
        executable, artifact = helper.discover_release(records, repository=COHORT, target_directory=TARGET.resolve())
        summary["artifact"] = artifact
        helper.check_executable(executable, artifact)
        listing = run([str(executable), "--list", "--format", "terse"], "list.log", 30, 16384).read_bytes()
        helper.validate_listing(listing, [helper.TEST_ID])
        output = run([str(executable), "--format", "terse", "--nocapture", "--test-threads=1"],
                     "execute.log", 600, 16384).read_bytes()
        need(re.search(rb"test result: ok\. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;", output),
             "whole original cost case completed")
        lines = [line for line in output.splitlines(keepends=True) if line.startswith(helper.PREFIX)]
        need(len(lines) == 1, "one original cost record")
        measured = helper.parse_line(lines[0], architecture=platform.machine(), operating_system="linux",
                                     bundle_bytes=content["bundle"]["bytes"], content_identity=content["identity"])
        for expected, actual in zip(cohort["checkpoints"], measured["checkpoints"], strict=True):
            need(all(actual[key] == value for key, value in expected.items()),
                 "all four checkpoint digests/sizes reproduce actual original full run")
        active = [row for row in measured["checkpoints"] if row["checkpoint"] == "active"][0]
        for key, expected in cohort["active"].items():
            if key != "phases":
                need(active[key] == expected, "original active semantic metric: " + key)
        need(snapshot.is_file() and not snapshot.is_symlink() and snapshot.stat().st_size == 8416
             and snapshot.stat().st_size == active["snapshot_canonical_bytes"], "actual small active snapshot")
        helper.check_executable(executable, artifact)
        need(helper.read_content(COHORT) == content and (COHORT / SOURCE).read_bytes() == modified,
             "source and content conserved through original cost execution")
        for path, expected in cohort["source_hashes"].items():
            if path != SOURCE:
                need(digest(COHORT / path) == expected, "original source conserved: " + path)
        summary.update(status="passed", tests=dict(passed=1, failed=0, skipped=0),
                       checkpoints=cohort["checkpoints"], active=active,
                       snapshot=dict(file=snapshot.name, bytes=snapshot.stat().st_size,
                                     sha256=digest(snapshot), blake3=active["snapshot_digest"]),
                       actual_record=dict(bytes=len(lines[0]), sha256=hashlib.sha256(lines[0]).hexdigest()))
    finally:
        (COHORT / SOURCE).write_bytes(original)
        need(digest(COHORT / SOURCE) == ORIGINAL_SHA, "original test restored")
        summary["original_source_restored"] = True


if __name__ == "__main__":
    for directory in (FULL, COMPACT, SNAPSHOTS):
        directory.mkdir(parents=True, exist_ok=False)
    result = dict(status="failed", source_sha=os.environ["GITHUB_SHA"], run_id=os.environ["GITHUB_RUN_ID"],
                  run_attempt=os.environ["GITHUB_RUN_ATTEMPT"], started_at=START,
                  qualification="supplemental original checkpoint reproduction; no timing or full M9 qualification")
    try:
        main(result)
    except Exception as error:
        result["status"] = "failed"
        result["failure"] = str(error)[:2048]
    finally:
        cleanup = time.monotonic()
        if TARGET.exists():
            need(TARGET.resolve().parent == REPORT.resolve() and not TARGET.is_symlink(), "owned target cleanup")
            shutil.rmtree(TARGET)
        result.update(logs=LOGS, owned_target_removed=not TARGET.exists(),
                      cleanup_seconds=time.monotonic() - cleanup,
                      elapsed_seconds_including_checkout=time.time() - START)
        if result["cleanup_seconds"] > 20 or result["elapsed_seconds_including_checkout"] > 1800:
            result["status"] = "failed"
            result["failure"] = "original shared budget including cleanup exceeded"
        encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
        need(len(encoded) <= 16384, "compact result limit")
        (COMPACT / "summary.json").write_bytes(encoded)
    raise SystemExit(0 if result["status"] == "passed" else 1)
