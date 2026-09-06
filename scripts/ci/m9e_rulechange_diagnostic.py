"""Actual focused changed-rule reload; not integrated native/platform/Q evidence."""
import hashlib
import json
import os
from pathlib import Path
import re
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-rule-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
os.environ["M9E_REPORT_DIR"] = str(REPORT)
os.environ["CARGO_TARGET_DIR"] = str(REPORT / "target")

import m9e_feedback as feedback
from m9e_current_cost import run_bounded
from m9e_rulechange import (RULE_INPUTS, RULE_SOURCE, RULE_TARGET, RULE_TEST, RULE_TEST_SOURCE,
                            current_rule_worker, make_rule_policy, validate_rule_evidence)

DEADLINE = time.monotonic() + 1800
sequence = 0
timings = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, cwd=None, env=None, *, seconds=900, bound=16 << 20):
    global sequence, failed_log
    sequence += 1
    output = FULL / f"{sequence:03}-{name}.log"
    try:
        result = run_bounded(args, cwd=feedback.RUST if cwd is None else cwd,
                             environment=dict(os.environ) if env is None else env,
                             output=output, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE)
    except Exception:
        failed_log = output
        raise
    timings[f"{sequence:03}-{name}"] = round(result["elapsed_seconds"] * 1000)
    if "--message-format=json" in args:
        rows = cargo_records(result["path"])
        finished = [row for row in rows if row.get("reason") == "build-finished"]
        if len(finished) != 1 or finished[0].get("success") is not True:
            raise RuntimeError("complete successful Cargo artifact stream required")
    return result["path"]


def cargo_records(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.startswith("{")]


def main(summary):
    feedback.run = run
    sha = os.environ["GITHUB_SHA"]
    if run(["git", "rev-parse", "HEAD"], "identity", ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate checkout mismatch")
    sources = [RULE_TEST_SOURCE, RULE_SOURCE, *RULE_INPUTS.values(), "rust/crates/er-cli/Cargo.toml",
               "rust/crates/er-cli/src/current_agent.rs", "rust/crates/er-cli/tests/m9e_current_reload.rs",
               "scripts/ci/m9e_feedback.py", "scripts/ci/m9e_current_cost.py", "scripts/ci/m9e_rulechange.py",
               "scripts/ci/m9e_rulechange_diagnostic.py", ".github/workflows/m9e-rulechange-focused.yml",
               "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json"]
    summary["source_hashes"] = {name: digest(ROOT / name) for name in sources}
    summary["bundle_sha256"] = digest(ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json")
    run(["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true", "--check", str(ROOT / RULE_TEST_SOURCE)],
        "format", seconds=60, bound=262144)
    compiler_output = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    # The first rustup proxy call can emit component installation diagnostics on
    # stderr. Bind its sole compiler identity line, preserving the complete log.
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler_output, re.M)
    if len(versions) != 1:
        raise RuntimeError("exact pinned compiler identity line required")
    toolchain = versions[0]
    host = next(line.split(": ", 1)[1] for line in run(["rustc", "-vV"], "host", seconds=30, bound=16384).read_text().splitlines()
                if line.startswith("host: "))
    build_summary = {"product_sha": sha, "target": host, "toolchain": toolchain, "profile": "test"}
    run(["cargo", "clippy", "--locked", "-p", "er-cli", "--test", RULE_TARGET, "--no-deps", "--", "-D", "warnings"], "clippy-test")
    run(["cargo", "clippy", "--locked", "-p", "er-kernel-worker", "--bin", "er-kernel-worker", "--no-deps", "--", "-D", "warnings"], "clippy-worker")
    built = cargo_records(run(["cargo", "test", "--locked", "-p", "er-cli", "--test", RULE_TARGET,
                               "--no-run", "--message-format=json"], "build-test"))
    workers = cargo_records(run(["cargo", "build", "--locked", "--profile", "test", "-p", "er-kernel-worker",
                                 "--bin", "er-kernel-worker", "--message-format=json"], "build-worker"))
    cli = feedback.discover_cli_executable(built, build_summary)
    worker = feedback.discover_worker_executable(workers, build_summary)
    manifest = ROOT / "rust/crates/er-cli/Cargo.toml"
    matches = [row for row in built if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == RULE_TARGET]
    if len(matches) != 1:
        raise RuntimeError("exact one rule test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(manifest) or artifact.get("features") != []
            or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / RULE_TEST_SOURCE)
            or artifact.get("profile", {}).get("test") is not True
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != REPORT / "target/debug/deps"
            or not re.fullmatch(RULE_TARGET + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("test executable source/profile/path binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], "listing", seconds=30, bound=16384).read_text()
    if listing != RULE_TEST + ": test\n":
        raise RuntimeError("exact single rule test listing differs")
    policy = make_rule_policy(ROOT, sha)
    build_summary["plan"] = {"rule_worker": policy}
    summary.update(policy=policy, target=host, toolchain=toolchain,
                   test_artifact={"sha256": binary_hash, "bytes": binary.stat().st_size, "profile": artifact["profile"]},
                   cli={key: value for key, value in cli.items() if key not in ("path", "root")},
                   worker={key: value for key, value in worker.items() if key != "path"})
    with current_rule_worker(feedback, build_summary, worker) as (environment, evidence):
        summary["derived_prepared"] = evidence
        if digest(binary) != binary_hash or digest(Path(cli["path"])) != cli["sha256"]:
            raise RuntimeError("ordinary executable changed before actual test")
        output = run([str(binary), RULE_TEST, "--exact", "--format", "terse", "--nocapture", "--test-threads=1"],
                     "execute", ROOT / "rust/crates/er-cli", environment, seconds=600, bound=16384).read_text()
        counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
        if counts != [("1", "0", "0", "0", "0")]:
            raise RuntimeError("exact-one real CLI test completion differs")
    evidence.update(status="passed", target=RULE_TARGET, test=RULE_TEST,
                    tests={"executed": 1, "passed": 1, "failed": 0, "skipped": 0})
    files = {"lock": summary["source_hashes"][RULE_INPUTS["lock"]],
             "rule_workspace": summary["source_hashes"][RULE_INPUTS["workspace"]],
             "rule_worker_manifest": summary["source_hashes"][RULE_INPUTS["manifest"]],
             "rule_toolchain": summary["source_hashes"][RULE_INPUTS["toolchain"]],
             "rule_source": summary["source_hashes"][RULE_SOURCE], "rule_test": summary["source_hashes"][RULE_TEST_SOURCE]}
    validate_rule_evidence(evidence, policy, {"product_sha": sha, "toolchain": toolchain, "target": host, "files": files}, worker)
    if (digest(binary) != binary_hash or digest(Path(cli["path"])) != cli["sha256"]
            or any(digest(ROOT / name) != value for name, value in summary["source_hashes"].items())
            or digest(ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json") != summary["bundle_sha256"]):
        raise RuntimeError("candidate source/content/executable changed during witness")
    del summary["derived_prepared"]
    summary.update(status="passed", rule_worker=evidence, tests=evidence["tests"])


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "qualification": "focused actual changed-rule reload only; no integrated native/platform/Q qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": "d31411fad6cc0367ff28b8eedb2f717fb8a1b419"}
    try:
        main(summary)
    except Exception as error:
        summary["failure"] = str(error)
        logs = sorted(FULL.iterdir(), key=lambda path: path.stat().st_mtime)
        tail = b""
        last = failed_log if failed_log is not None and failed_log.is_file() else logs[-1] if logs else None
        if last is not None:
            with last.open("rb") as stream:
                stream.seek(max(0, last.stat().st_size - 245000))
                tail = stream.read(245000)
        (COMPACT / "failure.txt").write_bytes((str(error) + "\nNamed bounded tail; full logs remain remote.\n").encode() + tail)
    summary["timing_ms"] = timings
    encoded = (json.dumps(summary, sort_keys=True, indent=2) + "\n").encode()
    if len(encoded) > 16384:
        raise RuntimeError("focused rule summary exceeds 16 KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    print(json.dumps({key: summary[key] for key in ("status", "qualification", "source_sha", "run_id")}))
    raise SystemExit(0 if summary["status"] == "passed" else 1)
