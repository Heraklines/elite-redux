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
    print(f"[m9e] {name}", flush=True)
    try:
        with path.open("w") as output:
            result = subprocess.run(args, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=900)
    except subprocess.TimeoutExpired as error:
        TIMINGS[name] = round((time.monotonic() - start) * 1000)
        raise RuntimeError(f"{name} exceeded 900 seconds; see {path.name}") from error
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


def verify_worker_lock_change(before_text, after_text):
    """Allow only the ABI2 worker's three existing workspace dependencies."""
    before = tomllib.loads(before_text)
    after = tomllib.loads(after_text)
    additions = {"er-canonical", "er-protocol", "er-state"}

    def records(lock):
        packages = lock.get("package", [])
        result = {(item["name"], item["version"], item.get("source")): item for item in packages}
        if len(result) != len(packages):
            raise RuntimeError("worker lock guard: duplicate package identity")
        return result

    old = records(before)
    new = records(after)
    if {key: value for key, value in before.items() if key != "package"} != {
        key: value for key, value in after.items() if key != "package"
    } or old.keys() != new.keys():
        raise RuntimeError("worker lock guard: lock metadata or package inventory changed")
    worker_keys = [key for key in old if key[0] == "er-kernel-worker" and key[2] is None]
    if len(worker_keys) != 1:
        raise RuntimeError("worker lock guard: one existing workspace worker required")
    worker_key = worker_keys[0]
    for name in additions:
        candidates = [key for key in old if key[0] == name]
        if len(candidates) != 1 or candidates[0][2] is not None:
            raise RuntimeError("worker lock guard: dependency is not an existing unambiguous workspace package")
    for key in old:
        if key != worker_key and old[key] != new[key]:
            raise RuntimeError("worker lock guard: another package record changed")
    old_worker = old[worker_key]
    new_worker = new[worker_key]
    if {key: value for key, value in old_worker.items() if key != "dependencies"} != {
        key: value for key, value in new_worker.items() if key != "dependencies"
    }:
        raise RuntimeError("worker lock guard: worker metadata changed")
    old_dependencies = old_worker.get("dependencies", [])
    new_dependencies = new_worker.get("dependencies", [])
    if len(old_dependencies) != len(set(old_dependencies)) or len(new_dependencies) != len(set(new_dependencies)) or (
        set(new_dependencies) - set(old_dependencies) != additions
        or set(old_dependencies) - set(new_dependencies)
    ):
        raise RuntimeError("worker lock guard: only the three exact added dependencies are allowed")
    return {"status": "verified", "added_workspace_dependencies": sorted(additions)}


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
    rust_changes = [path for path in changed if path.startswith("rust/")]
    worker_focus = config.get("worker_session_focus", {})
    worker_paths = worker_focus.get("paths", [])
    worker_session = any(path in worker_paths for path in rust_changes) and all(
        path in worker_paths or path == "rust/Cargo.lock" for path in rust_changes)
    endpoint_focus = config.get("endpoint_session_focus", {})
    endpoint_paths = endpoint_focus.get("paths", [])
    endpoint_session = any(path in endpoint_paths for path in rust_changes) and all(
        path in endpoint_paths or path in worker_paths or path == "rust/Cargo.lock" for path in rust_changes)
    native_worker_delta = worker_session or endpoint_session
    worker_lock_guard = None
    if native_worker_delta and "rust/Cargo.lock" in changed:
        worker_lock_guard = verify_worker_lock_change(
            capture(["git", "show", f"{base}:rust/Cargo.lock"]), (RUST / "Cargo.lock").read_text())
        worker_lock_guard["baseline_sha"] = base
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
        elif (native_worker_delta and path == "rust/Cargo.lock") or path in config["infrastructure_paths"] or any(
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
    focus = config.get("current_session_focus", {})
    execution_scope = focus.get("execute") if rust_changes and all(path in focus.get("paths", []) for path in rust_changes) else None
    browser_focus = config.get("browser_session_focus", {})
    browser_paths = browser_focus.get("paths", [])
    browser_required = bool(browser_focus) and (current_session or any(
        path in browser_paths or path in browser_focus.get("session_paths", []) for path in rust_changes))
    browser_session = browser_required and all(
        path in browser_paths or path in focus.get("paths", []) for path in rust_changes)
    if browser_session:
        execution_scope = browser_focus["execute"]
        boundaries = [path for path in boundaries if path not in browser_paths]
    if worker_session:
        execution_scope = worker_focus["execute"]
    if endpoint_session:
        execution_scope = endpoint_focus["execute"]
    if execution_scope is not None:
        selected.update(execution_scope)
        if not native_worker_delta:
            current_session = True
    endpoint_execution = "er-lab" in selected and (
        execution_scope is None or "*" in execution_scope.get("er-lab", [])
        or "current_kernel_endpoint_v2" in execution_scope.get("er-lab", []))
    if endpoint_execution:
        selected.add("er-kernel-worker")
    result = {"base_sha": base, "changed_paths": changed, "packages": sorted(selected),
              "unknown_paths": unknown, "boundary_paths": boundaries,
              "historical_dispositions": config.get("historical_dispositions", []),
              "requires_wasm": shared or bool(boundaries) or current_session,
              "wasm_test": config.get("current_session_wasm_test") if current_session else None,
              "execution_scope": execution_scope,
              "requires_browser": browser_required,
              "worker_session_focus": worker_session,
              "endpoint_session_focus": endpoint_session,
              "requires_worker_executable": endpoint_execution,
              "worker_lock_guard": worker_lock_guard,
              "features": "default"}
    (FULL / "plan.json").write_text(json.dumps(result, indent=2) + "\n")
    if unknown or boundaries or shared:
        raise RuntimeError("planning requires additional mapping: " + json.dumps(result))
    return result


def discover_worker_executable(artifacts, summary):
    """Bind the real worker binary emitted by this candidate's Cargo invocation."""
    manifest = (RUST / "crates/er-kernel-worker/Cargo.toml").resolve()
    candidates = {}
    for message in artifacts:
        target = message.get("target", {})
        if message.get("reason") != "compiler-artifact" or target.get("name") != "er-kernel-worker" or "bin" not in target.get("kind", []) or message.get("profile", {}).get("test") is not False:
            continue
        if Path(message.get("manifest_path", "")).resolve() != manifest:
            continue
        raw_path = Path(message.get("executable") or "")
        if not raw_path.is_absolute() or not raw_path.is_file() or not os.access(raw_path, os.X_OK):
            raise RuntimeError("current endpoint worker executable is missing or not executable")
        candidates[raw_path.resolve()] = message
    if len(candidates) != 1:
        raise RuntimeError("current endpoint requires exactly one real worker executable artifact")
    path, message = next(iter(candidates.items()))
    return {"path": str(path), "sha256": digest(path), "bytes": path.stat().st_size,
            "source_sha": summary["product_sha"], "target": summary["target"], "profile": summary["profile"],
            "manifest_path": "rust/crates/er-kernel-worker/Cargo.toml",
            "cargo_package_id": message.get("package_id"), "cargo_profile": message["profile"]}


def native_target_env(crate, target, worker_executable):
    if (crate, target) != ("er-lab", "current_kernel_endpoint_v2"):
        return None
    if worker_executable is None:
        raise RuntimeError("current endpoint target has no bound worker executable")
    env = os.environ.copy()
    env.update({
        "ER_M9E_WORKER_EXECUTABLE": worker_executable["path"],
        "ER_M9E_WORKER_EXECUTABLE_SHA256": worker_executable["sha256"],
        "ER_M9E_WORKER_SOURCE_SHA": worker_executable["source_sha"],
        "ER_M9E_WORKER_BUILD_TARGET": worker_executable["target"],
        "ER_M9E_WORKER_BUILD_PROFILE": worker_executable["profile"],
    })
    return env


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


def browser_result_counts(playwright, vitest):
    expected = {
        "natural V7 browser startup reaches the real battle command",
        "two V7 browser hosts wait for both humans and converge one turn",
    }
    specs = []
    def collect(suite):
        specs.extend(suite.get("specs", []))
        for child in suite.get("suites", []):
            collect(child)
    for suite in playwright.get("suites", []):
        collect(suite)
    if len(specs) != 2 or {spec.get("title") for spec in specs} != expected or playwright.get("errors"):
        raise RuntimeError("Chromium witness identities/counts disagree")
    for spec in specs:
        tests = spec.get("tests", [])
        if len(tests) != 1:
            raise RuntimeError("Chromium witness must execute exactly once")
        test = tests[0]
        results = test.get("results", [])
        if test.get("projectName") != "chromium" or test.get("expectedStatus") != "passed" or test.get("status") != "expected" or len(results) != 1 or results[0].get("status") != "passed" or results[0].get("retry") != 0:
            raise RuntimeError("Chromium witness failed, skipped, retried or flaky")
    assertions = [assertion for suite in vitest.get("testResults", []) for assertion in suite.get("assertionResults", [])]
    if vitest.get("success") is not True or vitest.get("numTotalTests") != 1 or vitest.get("numPassedTests") != 1 or len(assertions) != 1 or assertions[0].get("status") != "passed" or assertions[0].get("fullName") != "BrowserEffectRouterV2 routes every typed effect once and fences stale or disposed batches":
        raise RuntimeError("typed browser effect witness identities/counts disagree")
    return {"chromium": {"expected": 2, "passed": 2, "failed": 0, "skipped": 0, "selected_test_ids": sorted(expected)},
            "typed_effects": {"expected": 1, "passed": 1, "failed": 0, "skipped": 0},
            "scope": "V7 Wasm host in Chromium plus typed effect router; not production Worker/WebRTC topology"}


def browser_checks(summary):
    run(["cargo", "clippy", "--locked", "-p", "er-web", "--all-targets", "--no-deps", "--", "-D", "warnings"], "browser-clippy")
    run(["pnpm", "install", "--frozen-lockfile"], "browser-dependencies", ROOT)
    output = Path(os.environ["RUNNER_TEMP"]) / "m9e-v7-web"
    env = os.environ.copy()
    # The published builder intentionally resolves its output under rust/target.
    env.pop("CARGO_TARGET_DIR", None)
    env["RUSTUP_TOOLCHAIN"] = tomllib.loads((RUST / "rust-toolchain.toml").read_text())["toolchain"]["channel"]
    run(["node", "scripts/build-kernel-m9e-v7-web.mjs", "--out-dir", str(output)], "browser-build", ROOT, env)
    manifest_path = output / "m9e-v7-web-assets.json"
    manifest = json.loads(manifest_path.read_text())
    expected_assets = {"er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json", "coop-authority-snapshot.json", "coop-replica-snapshot.json"}
    if manifest.get("source_sha") != summary["product_sha"] or set(manifest.get("assets", {})) != expected_assets or manifest.get("browser_worker_protocol_version") != 2:
        raise RuntimeError("browser asset manifest candidate or inventory mismatch")
    for name, metadata in manifest["assets"].items():
        path = output / name
        if path.stat().st_size != metadata["bytes"] or digest(path) != metadata["sha256"]:
            raise RuntimeError("browser asset hash mismatch: " + name)
    shutil.copyfile(manifest_path, FULL / manifest_path.name)
    summary["browser_assets"] = {"manifest_sha256": digest(manifest_path), "assets": manifest["assets"]}
    run(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], "browser-chromium-install", ROOT)
    env["M9E_V7_WEB_DIR"] = str(output)
    env["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(FULL / "browser-results.json")
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium",
         "test/browser/rust-browser/m9e-v7-corrective.spec.ts", "--workers=1", "--reporter=line,json"], "browser-journey", ROOT, env)
    run(["pnpm", "exec", "vitest", "run", "--config", "test/node/vitest.config.ts",
         "test/node/rust-browser/engineering/browser-effects-v2.test.ts", "--reporter=json", "--outputFile=" + str(FULL / "browser-effect-results.json")], "browser-effects", ROOT)
    summary["browser_tests"] = browser_result_counts(json.loads((FULL / "browser-results.json").read_text()),
                                                     json.loads((FULL / "browser-effect-results.json").read_text()))


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
        artifacts = []
        for line in build.read_text().splitlines():
            if not line.startswith("{"):
                continue
            message = json.loads(line)
            if message.get("reason") == "compiler-artifact":
                artifacts.append(message)
            if message.get("reason") == "compiler-artifact" and message.get("profile", {}).get("test") and message.get("executable"):
                binaries[message["executable"]] = (message["target"]["name"], Path(message["manifest_path"]).parent)
        if not binaries:
            raise RuntimeError("build emitted no test binaries")
        execution_scope = selection["execution_scope"]
        if execution_scope is not None:
            selected_binaries = {}
            build_only = []
            for binary, (name, cwd) in binaries.items():
                scope = execution_scope.get(cwd.name, [])
                if "*" in scope or name in scope:
                    selected_binaries[binary] = (name, cwd)
                else:
                    build_only.append(f"{cwd.name}:{name}")
            for package, names in execution_scope.items():
                for name in names:
                    if not any(cwd.name == package and (name == "*" or target == name)
                               for target, cwd in selected_binaries.values()):
                        raise RuntimeError(f"required focused target missing: {package}:{name}")
            summary["build_only_targets"] = sorted(build_only)
            summary["execution_scope"] = execution_scope
            binaries = selected_binaries
        worker_executable = None
        if selection["requires_worker_executable"]:
            if not any(name == "current_kernel_endpoint_v2" and cwd.name == "er-lab" for name, cwd in binaries.values()):
                raise RuntimeError("required current endpoint test target is missing")
            worker_executable = discover_worker_executable(artifacts, summary)
            summary["worker_executable"] = worker_executable
        enumerated = []
        for index, (binary, (name, cwd)) in enumerate(sorted(binaries.items())):
            env = native_target_env(cwd.name, name, worker_executable)
            listing = run([binary, "--list", "--format", "terse"], f"list-{index}", cwd, env)
            ids = [line[:-6] for line in listing.read_text().splitlines() if line.endswith(": test")]
            exclusions = [item for item in selection["historical_dispositions"]
                          if item["crate"] == cwd.name and item["target"] == name and item["test"] in ids]
            excluded_ids = {item["test"] for item in exclusions}
            summary.setdefault("historical_dispositions", []).extend(exclusions)
            ids = [test_id for test_id in ids if test_id not in excluded_ids]
            tests.extend(f"{name}::{test_id}" for test_id in ids)
            summary["tests"]["selected"] += len(ids)
            enumerated.append((index, binary, name, ids, cwd, excluded_ids, env))
        for item in selection["historical_dispositions"]:
            in_scope = execution_scope is None or item["target"] in execution_scope.get(item["crate"], []) or "*" in execution_scope.get(item["crate"], [])
            if in_scope and item["crate"] in selection["packages"] and summary["historical_dispositions"].count(item) != 1:
                raise RuntimeError("historical disposition must identify exactly one enumerated test")
        for index, binary, name, ids, cwd, excluded_ids, env in enumerated:
            # Run even zero-test harnesses and fail if reported counts disagree.
            output = FULL / f"execute-{index}.log"
            start = time.monotonic()
            print(f"[m9e] execute {name}: {len(ids)} selected tests", flush=True)
            command = [binary, "--format", "terse"]
            for test_id in sorted(excluded_ids):
                command.extend(["--skip", test_id])
            try:
                with output.open("w") as stream:
                    code = subprocess.run(command, cwd=cwd,
                                          env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=600).returncode
            except subprocess.TimeoutExpired as error:
                TIMINGS[f"execute-{index}"] = round((time.monotonic() - start) * 1000)
                summary.setdefault("native_target_timing_ms", {})[f"{cwd.name}:{name}"] = TIMINGS[f"execute-{index}"]
                raise RuntimeError(f"{name} exceeded 600 seconds; see {output.name}") from error
            TIMINGS[f"execute-{index}"] = round((time.monotonic() - start) * 1000)
            summary.setdefault("native_target_timing_ms", {})[f"{cwd.name}:{name}"] = TIMINGS[f"execute-{index}"]
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
        if selection["worker_session_focus"] or selection["requires_worker_executable"]:
            run(["cargo", "clippy", "--locked", "-p", "er-kernel-worker", "--all-targets", "--no-deps", "--", "-D", "warnings"], "worker-clippy")
        if selection["requires_worker_executable"]:
            run(["cargo", "clippy", "--locked", "-p", "er-lab", "--all-targets", "--no-deps", "--", "-D", "warnings"], "endpoint-clippy")
        if selection["requires_wasm"]:
            wasm_checks(selection, summary)
        if selection["requires_browser"]:
            browser_checks(summary)
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
            failed_log = re.search(r"see ([\w.-]+\.log)", excerpt)
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
                if re.search(r"(?m)^error[:\[]|^Error:|--- FAILED|^FAILED |test result: FAILED|^Traceback", text) or (path.name == "format.log" and text) or (failed_log and path.name == failed_log[1]):
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
