"""Exercise the integration release wrapper on the actual source-bound cost probe.

Focused producer diagnostic only; no native/platform/Q qualification.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

import m9e_current_cost as cost

ROOT = Path(__file__).resolve().parents[2]
RUST = ROOT / "rust"
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-cost-focused"
FULL, COMPACT = REPORT / "diagnostics", REPORT / "compact"
DEADLINE = time.monotonic() + 1800


def run(command, name, seconds, limit, *, environment, cwd=RUST):
    return cost.run_bounded(command, cwd=cwd, environment=environment, output=FULL / name,
                            seconds=seconds, byte_limit=limit, global_deadline=DEADLINE)


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if (subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() != sha
            or subprocess.check_output(["git", "diff", "--name-only", "HEAD", "--"], cwd=ROOT, text=True).strip()):
        raise RuntimeError("focused checkout identity or tracked source differs")
    binding = cost.build_source_binding(ROOT, sha)
    sources = {**binding["source_hashes"], **{name: cost.file_hash(ROOT / name) for name in (
        "scripts/ci/m9e_cost_diagnostic.py", ".github/workflows/m9e-current-cost-focused.yml")}}
    summary.update(source_hashes=sources, cargo_manifests=binding["cargo_manifests"])
    identity = {"product_sha": sha, "workflow_sha": os.environ["GITHUB_WORKFLOW_SHA"],
                "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
                "profile": "test", "features": "default", "target": "x86_64-unknown-linux-gnu",
                "files": sources}
    # The ordinary test-profile target is built and listed, never executed.
    # This supplies a real global-discovery identity to the release override.
    with tempfile.TemporaryDirectory(prefix="ordinary-discovery-", dir=REPORT) as owned:
        target = Path(owned).resolve() / "target"
        target.mkdir(exist_ok=False)
        environment, _ = cost.release_environment(ROOT, target, dict(os.environ))
        compiler = run(["rustc", "-vV"], "compiler.log", 60, 16384, environment=environment)["path"].read_text()
        if (len(re.findall(r"^rustc 1\.97\.1 .+$", compiler, re.M)) != 1
                or re.findall(r"^host: (.+)$", compiler, re.M) != [identity["target"]]):
            raise RuntimeError("focused compiler or native host identity")
        identity["toolchain"] = re.findall(r"^rustc 1\.97\.1 .+$", compiler, re.M)[0]
        run(["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true", "--check", str(ROOT / cost.SOURCE)],
            "format.log", 60, 262144, environment=environment)
        base = ["--locked", "-p", cost.TARGET[0], "--test", cost.TARGET[1]]
        run(["cargo", "clippy", *base, "--no-deps", "--", "-D", "warnings"], "ordinary-clippy.log", 600, 16 << 20,
            environment=environment)
        build = run(["cargo", "test", *base, "--no-run", "--message-format=json"], "ordinary-build.jsonl", 900, 16 << 20,
                    environment=environment)
        records = [json.loads(line) for line in build["path"].read_text().splitlines() if line.startswith("{")]
        finished = [row for row in records if row.get("reason") == "build-finished"]
        artifacts = [row for row in records if row.get("reason") == "compiler-artifact"
                     and row.get("target", {}).get("name") == cost.TARGET[1] and row.get("executable")]
        if len(finished) != 1 or finished[0].get("success") is not True or len(artifacts) != 1:
            raise RuntimeError("ordinary Cargo discovery is incomplete or ambiguous")
        artifact = artifacts[0]
        binary = Path(artifact["executable"])
        manifest = ROOT / "rust/crates/er-repro/Cargo.toml"
        version = cost.tomllib.loads((RUST / "Cargo.toml").read_text())["workspace"]["package"]["version"]
        package_ids = {"path+" + manifest.parent.as_uri() + "#" + suffix for suffix in (version, "er-repro@" + version)}
        if (artifact.get("manifest_path") != str(manifest) or artifact.get("features") != [] or artifact.get("package_id") not in package_ids
                or artifact.get("target", {}).get("src_path") != str(ROOT / cost.SOURCE)
                or artifact["target"].get("kind") != ["test"] or artifact["target"].get("crate_types") != ["bin"]
                or artifact.get("profile") != {"opt_level": "0", "debuginfo": 0, "debug_assertions": True,
                                                "overflow_checks": True, "test": True}
                or not binary.is_absolute() or binary.resolve() != binary or binary.is_symlink()
                or binary.parent != target / "debug/deps" or not binary.is_file() or not os.access(binary, os.X_OK)
                or re.fullmatch(cost.TARGET[1] + "-[0-9a-f]{16}", binary.name) is None):
            raise RuntimeError("ordinary native test-profile artifact identity")
        ordinary = {"bytes": binary.stat().st_size, "sha256": cost.file_hash(binary)}
        cost.integer(ordinary["bytes"], 1, 128 << 20, "ordinary executable bytes")
        cost.check_executable(binary, ordinary)
        listing = run([str(binary), "--list", "--format", "terse"], "ordinary-list.log", 30, 16384, environment=environment)
        raw = listing["path"].read_bytes()
        ids = [line.removesuffix(": test") for line in raw.decode("utf-8").splitlines()]
        cost.validate_listing(raw, ids)
        cost.check_executable(binary, ordinary)
        summary["ordinary_discovery"] = {"artifact": ordinary, "profile": artifact["profile"], "ids": ids,
                                         "build_log_sha256": build["sha256"], "listing_sha256": listing["sha256"],
                                         "execution_count": 0}
        _, proof = cost.execute_release(ROOT, REPORT, FULL, identity=identity, source_binding=binding,
                                         discovered_ids=ids, global_deadline=DEADLINE)
        cost.check_executable(binary, ordinary)
    # Both independently owned build directories have now been removed.
    if cost.build_source_binding(ROOT, sha) != binding or any(cost.file_hash(ROOT / name) != value for name, value in sources.items()):
        raise RuntimeError("source or manifest conservation after build cleanup")
    if time.monotonic() > DEADLINE:
        raise RuntimeError("focused cleanup exceeded the unchanged total deadline")
    summary.update(status="passed", identity=identity, current_cost_probe=proof,
                   source_binding_sha256=hashlib.sha256(cost.encoded(binding)).hexdigest(),
                   tests={"selected": 1, "executed": 1, "passed": 1, "failed": 0, "skipped": 0})


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "qualification": "focused release-wrapper producer only; no integrated native/platform/Q qualification",
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
    raw = cost.encoded(summary)
    if len(raw) > 16384:
        raise RuntimeError("compact focused metadata exceeds 16 KiB")
    (COMPACT / "summary.json").write_bytes(raw)
    print(json.dumps({key: summary[key] for key in ("status", "qualification", "source_sha", "run_id")}))
    raise SystemExit(0 if summary["status"] == "passed" else 1)
