"""Remote-only focused Cargo feedback. Full diagnostics stay on the runner.

No cached test result is accepted. Cargo recompiles as needed at the exact SHA,
then every enumerated native test binary is executed. Boundary changes fail
closed until their additional platform checks have an explicit executable map.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import tomllib


ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["M9E_REPORT_DIR"])
COMPACT = REPORT / "compact"
FULL = REPORT / "full"
RUST = ROOT / "rust"
TIMINGS = {}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def capture(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def run(args, name, cwd=RUST, env=None):
    start = time.monotonic()
    path = FULL / (name + ".log")
    with path.open("w") as output:
        result = subprocess.run(args, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
    TIMINGS[name] = round((time.monotonic() - start) * 1000)
    if result.returncode:
        raise RuntimeError(f"{name} exited {result.returncode}; see {path.name}")
    return path


def check_format(selection):
    try:
        run(["cargo", "fmt", "--all", "--", "--check"], "format")
    except RuntimeError:
        # Mutation is confined to the disposable remote checkout. Restore the
        # exact candidate after producing a patch for changed source only.
        paths = [path for path in selection["changed_paths"] if path.endswith(".rs")]
        if paths:
            try:
                run(["cargo", "fmt", "--all"], "format-patch")
                patch = subprocess.check_output(["git", "diff", "--", *paths], cwd=ROOT)
                (FULL / "format.patch").write_bytes(patch)
                if len(patch) <= 32000:
                    (COMPACT / "format.patch").write_bytes(patch)
            finally:
                subprocess.run(["git", "restore", "--worktree", "--", "rust"], cwd=ROOT, check=True)
        raise


def plan():
    config = json.loads((ROOT / "scripts/ci/m9e-targets.json").read_text())
    # Cumulative coverage survives canceled/failed intermediate pushes. Advancing
    # this committed baseline requires an explicit validated checkpoint review.
    base = config["baseline"]
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        raise RuntimeError("invalid comparison SHA")
    # This fetch is REMOTE and only obtains the comparison commit, never all refs.
    if subprocess.run(["git", "cat-file", "-e", base], cwd=ROOT,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        run(["git", "fetch", "--no-tags", "--depth=1", "origin", base], "comparison-fetch", ROOT)
    changed = capture(["git", "diff", "--name-only", base, "HEAD"]).splitlines()
    packages = {}
    for manifest in sorted((RUST / "crates").glob("*/Cargo.toml")):
        data = tomllib.loads(manifest.read_text())
        packages[data["package"]["name"]] = (manifest, data)
    selected = set()
    unknown = []
    boundaries = []
    for path in changed:
        if any(path.startswith(prefix) for prefix in config["boundary_prefixes"]):
            boundaries.append(path)
        match = re.match(r"rust/crates/([^/]+)/", path)
        if match and match[1] in packages:
            selected.add(match[1])
        elif path in config["infrastructure_paths"] or any(
            path.startswith(prefix) for prefix in config["documentation_prefixes"]
        ):
            pass
        else:
            unknown.append(path)
    # Unknown inputs widen the native cone and fail planning, never zero-test green.
    if unknown:
        selected.update(packages)
    dependencies = {}
    for name, (_, data) in packages.items():
        tables = [data.get(key, {}) for key in ("dependencies", "dev-dependencies", "build-dependencies")]
        for target in data.get("target", {}).values():
            tables.extend(target.get(key, {}) for key in ("dependencies", "dev-dependencies", "build-dependencies"))
        dependencies[name] = {
            value.get("package", key) if isinstance(value, dict) else key
            for table in tables for key, value in table.items()
        }
    # Readiness is deliberately small; source changes include reverse dependencies.
    if any(path.startswith("rust/") for path in changed):
        while True:
            widened = selected | {name for name, deps in dependencies.items() if deps & selected}
            if widened == selected:
                break
            selected = widened
    shared = bool(selected & set(config["shared_packages"]))
    current_session = bool(selected & set(config.get("current_session_packages", [])))
    if shared:
        selected.update(config["shared_witness_packages"])
    if not selected:
        selected.update(config["readiness_packages"])
    if current_session:
        selected.add("er-wasm")
    result = {"base_sha": base, "changed_paths": changed, "packages": sorted(selected),
              "unknown_paths": unknown, "boundary_paths": boundaries,
              "requires_wasm": shared or bool(boundaries) or current_session,
              "wasm_test": config.get("current_session_wasm_test") if current_session else None,
              "features": "default"}
    (FULL / "plan.json").write_text(json.dumps(result, indent=2) + "\n")
    if unknown or boundaries or shared:
        raise RuntimeError("planning requires additional mapping: " + json.dumps(result))
    return result


def wasm_checks(selection, summary):
    # Existing V7 eventwise witness; this does not claim shipping browser topology
    # or that the current native facade is already the browser host's entry.
    env = os.environ.copy()
    env["CARGO_TARGET_DIR"] = str(Path(os.environ["RUNNER_TEMP"]) / "m9e-wasm-target")
    env["CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER"] = "wasm-bindgen-test-runner"
    version = capture(["wasm-bindgen", "--version"], RUST) if shutil.which("wasm-bindgen") else ""
    if version != "wasm-bindgen 0.2.127":
        run(["cargo", "install", "wasm-bindgen-cli", "--version", "0.2.127", "--locked", "--force"], "wasm-tools")
    run(["cargo", "check", "--locked", "-p", "er-env", "--target", "wasm32-unknown-unknown"], "current-session-wasm-check", env=env)
    output = run(["cargo", "test", "--locked", "-p", "er-wasm", "--test", selection["wasm_test"],
                  "--target", "wasm32-unknown-unknown"], "wasm-eventwise", env=env)
    text = output.read_text()
    counts = re.search(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored;", text)
    if not counts:
        raise RuntimeError("missing Wasm eventwise result counts")
    passed, failed, skipped = map(int, counts.groups())
    # This pinned test target contains one real wasm_bindgen_test; require its
    # executed name as well as counts so a zero-test cargo invocation cannot pass.
    witness = "wasm_replays_v7_raw_inputs_eventwise"
    summary["wasm_tests"] = {"expected": 1, "passed": passed, "failed": failed, "skipped": skipped,
                             "selected_test_ids": [witness], "scope": "existing V7 eventwise parity"}
    if passed != 1 or failed or skipped or witness not in text:
        raise RuntimeError("Wasm eventwise witness missing or counts disagree")


def main(preflight_failure=None):
    COMPACT.mkdir(parents=True, exist_ok=True)
    FULL.mkdir(parents=True, exist_ok=True)
    summary = {"status": "failed", "product_sha": os.environ.get("GITHUB_SHA"),
               "workflow_sha": os.environ.get("GITHUB_WORKFLOW_SHA"),
               "harness_sha": digest(Path(__file__)),
               "lockfile_hash": digest(RUST / "Cargo.lock"),
               "oracle_sha": "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7",
               "profile": "test", "features": "default", "timing_ms": TIMINGS,
               "diagnostics_truncated": False,
               "tests": {"selected": 0, "executed": 0, "passed": 0, "failed": 0, "skipped": 0}}
    tests = []
    try:
        if preflight_failure:
            raise RuntimeError(preflight_failure)
        if capture(["git", "rev-parse", "HEAD"]) != summary["product_sha"]:
            raise RuntimeError("candidate identity mismatch")
        manifest = RUST / "fixtures/m9/engineering/game-content-bundle-v2-manifest.json"
        summary["content_manifest_hash"] = digest(manifest)
        selection = plan()
        summary["plan"] = selection
        summary["toolchain"] = capture(["rustc", "--version"], RUST)
        summary["target"] = next(line.split(": ", 1)[1] for line in
                                 capture(["rustc", "-vV"], RUST).splitlines() if line.startswith("host: "))
        format_failure = None
        try:
            check_format(selection)
        except RuntimeError as error:
            # Formatting alone need not consume an entire remote feedback turn.
            # check_format restores the original candidate before compilation.
            format_failure = str(error)
            summary["format_failure"] = format_failure
        # --tests includes unit and integration targets without requiring a
        # library target in binary-only packages such as er-cli.
        args = ["cargo", "test", "--locked", "--tests", "--no-run", "--message-format=json"]
        for package in selection["packages"]:
            args.extend(["-p", package])
        build = run(args, "build")
        binaries = {}
        for line in build.read_text().splitlines():
            if not line.startswith("{"):
                continue
            message = json.loads(line)
            if message.get("reason") == "compiler-artifact" and message.get("profile", {}).get("test") and message.get("executable"):
                binaries[message["executable"]] = (message["target"]["name"], Path(message["manifest_path"]).parent)
        if not binaries:
            raise RuntimeError("build emitted no test binaries")
        enumerated = []
        for index, (binary, (name, cwd)) in enumerate(sorted(binaries.items())):
            listing = run([binary, "--list", "--format", "terse"], f"list-{index}", cwd)
            ids = [line[:-6] for line in listing.read_text().splitlines() if line.endswith(": test")]
            tests.extend(f"{name}::{test_id}" for test_id in ids)
            summary["tests"]["selected"] += len(ids)
            enumerated.append((index, binary, name, ids, cwd))
        for index, binary, name, ids, cwd in enumerated:
            # Run even zero-test harnesses and fail if reported counts disagree.
            output = FULL / f"execute-{index}.log"
            start = time.monotonic()
            with output.open("w") as stream:
                code = subprocess.run([binary, "--format", "terse"], cwd=cwd,
                                      stdout=stream, stderr=subprocess.STDOUT).returncode
            TIMINGS[f"execute-{index}"] = round((time.monotonic() - start) * 1000)
            counts = re.search(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored;", output.read_text())
            if not counts:
                raise RuntimeError(f"missing test result: {output.name}")
            passed, failed, skipped = map(int, counts.groups())
            for key, count in (("executed", passed + failed), ("passed", passed), ("failed", failed), ("skipped", skipped)):
                summary["tests"][key] += count
            if code or failed or skipped or passed != len(ids):
                raise RuntimeError(f"test execution/count failure in {name}; see {output.name}")
        if not summary["tests"]["executed"]:
            raise RuntimeError("zero tests executed")
        if selection["requires_wasm"]:
            wasm_checks(selection, summary)
        if format_failure:
            raise RuntimeError(format_failure)
        summary["status"] = "passed"
    except Exception as error:
        summary["first_failure"] = str(error)[:4096]
    finally:
        (FULL / "selected-tests.json").write_text(json.dumps(tests, indent=2) + "\n")
        summary["selected_test_ids"] = {"file": "selected-tests.json", "sha256": digest(FULL / "selected-tests.json")}
        summary["expected_test_count"] = summary["tests"]["selected"]
        summary["evidence"] = [{"file": path.name, "bytes": path.stat().st_size, "sha256": digest(path)}
                               for path in sorted(FULL.iterdir()) if path.is_file()]
        if summary["status"] != "passed":
            excerpt = summary.get("first_failure", "unknown failure") + "\n"
            for path in sorted(FULL.glob("*.log")):
                text = path.read_text(errors="replace")
                # Cargo artifact records contain dependency names like thiserror;
                # those are not compiler failures and must not crowd out diagnostics.
                diagnostics = []
                for line in text.splitlines():
                    if line.startswith("{"):
                        try:
                            message = json.loads(line)
                        except json.JSONDecodeError:
                            diagnostics.append(line)
                            continue
                        if message.get("reason") == "compiler-message":
                            detail = message.get("message", {})
                            if detail.get("level") == "error":
                                diagnostics.append(detail.get("rendered") or detail.get("message", ""))
                    else:
                        diagnostics.append(line)
                text = "\n".join(diagnostics)
                if re.search(r"(?im)^error[:\[]|FAILED|^Traceback", text) or (path.name == "format.log" and text):
                    if len(text) > 12000:
                        summary["diagnostics_truncated"] = True
                    marker = "[TRUNCATED: full log retained remotely]\n" if len(text) > 12000 else ""
                    excerpt += f"\n--- {path.name} ---\n" + marker + text[-12000:]
            encoded = excerpt.encode()
            patch_size = (COMPACT / "format.patch").stat().st_size if (COMPACT / "format.patch").exists() else 0
            diagnostic_limit = 48000 - patch_size
            truncated = len(encoded) > diagnostic_limit
            summary["diagnostics_truncated"] |= truncated
            (COMPACT / "failure.txt").write_bytes(encoded[:diagnostic_limit] + (b"\n[TRUNCATED: see full remote diagnostics]\n" if truncated else b""))
        encoded_summary = (json.dumps(summary, indent=2) + "\n").encode()
        if len(encoded_summary) > 16000:
            (FULL / "full-summary.json").write_bytes(encoded_summary)
            summary["evidence"] = [{"file": "full-summary.json", "sha256": digest(FULL / "full-summary.json")}]
            summary["plan"] = {"file": "plan.json", "sha256": digest(FULL / "plan.json")}
            encoded_summary = (json.dumps(summary, indent=2) + "\n").encode()
        (COMPACT / "summary.json").write_bytes(encoded_summary)
        print(json.dumps({key: summary[key] for key in ("product_sha", "status", "tests")}))
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=True)
    with (FULL / "harness-tests.log").open("w") as stream:
        preflight = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "scripts/ci", "-p", "test_m9e_feedback.py", "-v"],
                                   cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
    sys.exit(main("feedback harness self-tests failed; see harness-tests.log" if preflight.returncode else None))
