"""Remote-only focused Cargo feedback. Full diagnostics stay on the runner.

No cached test result is accepted. Cargo recompiles as needed at the exact SHA,
then every enumerated native test binary is executed. Boundary changes fail
closed until their additional platform checks have an explicit executable map.
"""

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib


ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["M9E_REPORT_DIR"])
COMPACT = REPORT / "compact"
FULL = REPORT / "full"
RUST = ROOT / "rust"
TIMINGS = {}
WORKER_BOUND_TARGETS = {("er-lab", "current_kernel_endpoint_v2"),
                        ("er-lab", "current_kernel_supervisor_v2"),
                        ("er-cli", "m9e_current_reload"),
                        ("er-cli", "m9e_current_repro")}


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


def compact_format_patch(patch, limit=32768):
    selected = []
    included_paths = []
    omitted_paths = []
    size = 0
    for chunk in filter(None, re.split(rb"(?=^diff --git )", patch, flags=re.MULTILINE)):
        header = chunk.split(b"\n", 1)[0]
        path = header.rsplit(b" b/", 1)[-1].decode(errors="replace") if header.startswith(b"diff --git ") else "unrecognized-format-diff"
        if size + len(chunk) <= limit:
            selected.append(chunk)
            included_paths.append(path)
            size += len(chunk)
        else:
            omitted_paths.append(path)
    return b"".join(selected), {"bytes": len(patch), "compact_bytes": size,
                               "omitted_bytes": len(patch) - size,
                               "included_paths": included_paths, "omitted_paths": omitted_paths}


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
                patch = subprocess.check_output(["git", "diff", "--unified=1", "--", *paths], cwd=ROOT)
                (FULL / "format.patch").write_bytes(patch)
                compact, metadata = compact_format_patch(patch)
                # Optional named failure repair, within the handoff's 256 KiB
                # diagnostic budget. Routine summaries retain their 64 KiB cap.
                # Retrieve only after inspecting artifact size; never download
                # the full diagnostic archive to obtain this source-only patch.
                if metadata["omitted_bytes"] and len(patch) <= 262144:
                    repair = REPORT / "format-repair.patch"
                    repair.write_bytes(patch)
                    metadata["repair_bytes"] = len(patch)
                    metadata["repair_sha256"] = hashlib.sha256(patch).hexdigest()
                (FULL / "format-patch-metadata.json").write_text(json.dumps(metadata) + "\n")
                if compact:
                    (COMPACT / "format.patch").write_bytes(compact)
                else:
                    (COMPACT / "format.patch").unlink(missing_ok=True)
            finally:
                subprocess.run(["git", "restore", "--worktree", "--", "rust"], cwd=ROOT, check=True)
        raise


def verify_cli_reload_dependencies(before_lock, after_lock, before_manifest, after_manifest):
    """Allow the one existing workspace worker dependency, with no other drift."""
    old_manifest, new_manifest = map(tomllib.loads, (before_manifest, after_manifest))
    old_dependencies = old_manifest.get("dependencies", {})
    if "er-kernel-worker" in old_dependencies:
        raise RuntimeError("CLI dependency guard: worker dependency already present")
    expected_manifest = {**old_manifest, "dependencies": {
        **old_dependencies, "er-kernel-worker": {"path": "../er-kernel-worker"}}}
    if new_manifest != expected_manifest:
        raise RuntimeError("CLI dependency guard: only the exact worker path dependency may change")
    before, after = map(tomllib.loads, (before_lock, after_lock))
    def records(lock):
        packages = lock.get("package", [])
        result = {(item["name"], item["version"], item.get("source")): item for item in packages}
        if len(result) != len(packages):
            raise RuntimeError("CLI lock guard: duplicate package identity")
        return result
    old, new = records(before), records(after)
    if old.keys() != new.keys() or {key: value for key, value in before.items() if key != "package"} != {
        key: value for key, value in after.items() if key != "package"
    }:
        raise RuntimeError("CLI lock guard: lock metadata or package inventory changed")
    for name in ("er-cli", "er-kernel-worker"):
        keys = [key for key in old if key[0] == name]
        if len(keys) != 1 or keys[0][2] is not None:
            raise RuntimeError("CLI lock guard: one unambiguous existing workspace package required")
    owner = next(key for key in old if key[0] == "er-cli")
    for key in old:
        if key != owner and old[key] != new[key]:
            raise RuntimeError("CLI lock guard: another package record changed")
    if {key: value for key, value in old[owner].items() if key != "dependencies"} != {
        key: value for key, value in new[owner].items() if key != "dependencies"
    }:
        raise RuntimeError("CLI lock guard: owner metadata changed")
    old_deps, new_deps = old[owner].get("dependencies", []), new[owner].get("dependencies", [])
    if len(old_deps) != len(set(old_deps)) or len(new_deps) != len(set(new_deps)) or (
        set(new_deps) - set(old_deps) != {"er-kernel-worker"} or set(old_deps) - set(new_deps)
    ):
        raise RuntimeError("CLI lock guard: only one exact worker dependency addition is allowed")
    return {"status": "verified", "owner": "er-cli", "added_workspace_dependencies": ["er-kernel-worker"]}


def verify_current_repro_dependencies(before_lock, after_lock, before_manifests, after_manifests):
    """Two exact workspace dependency deltas; no resolution or metadata drift."""
    additions = {"er-repro": {"er-env", "er-game", "er-kernel"}, "er-cli": {"er-web"}}
    if set(before_manifests) != set(additions) or set(after_manifests) != set(additions):
        raise RuntimeError("repro dependency guard: both owner manifests are required")
    for owner, names in additions.items():
        old, new = map(tomllib.loads, (before_manifests[owner], after_manifests[owner]))
        table = "dev-dependencies" if owner == "er-cli" else "dependencies"
        dependencies = old.get(table, {})
        if set(dependencies) & names:
            raise RuntimeError("repro dependency guard: dependency already present")
        expected = {**old, table: {**dependencies, **{name: {"path": "../" + name} for name in names}}}
        if new != expected:
            raise RuntimeError("repro dependency guard: only exact owner path additions may change")
    before, after = map(tomllib.loads, (before_lock, after_lock))
    def records(lock):
        packages = lock.get("package", [])
        result = {(item["name"], item["version"], item.get("source")): item for item in packages}
        if len(result) != len(packages):
            raise RuntimeError("repro lock guard: duplicate package identity")
        return result
    old, new = records(before), records(after)
    if old.keys() != new.keys() or {key: value for key, value in before.items() if key != "package"} != {
        key: value for key, value in after.items() if key != "package"
    }:
        raise RuntimeError("repro lock guard: lock metadata or inventory changed")
    owners = {}
    for name in set(additions) | set().union(*additions.values()):
        keys = [key for key in old if key[0] == name]
        if len(keys) != 1 or keys[0][2] is not None:
            raise RuntimeError("repro lock guard: unambiguous existing workspace packages required")
        if name in additions:
            owners[keys[0]] = additions[name]
    for key in old:
        if key not in owners:
            if old[key] != new[key]:
                raise RuntimeError("repro lock guard: another package record changed")
            continue
        if {field: value for field, value in old[key].items() if field != "dependencies"} != {
            field: value for field, value in new[key].items() if field != "dependencies"
        }:
            raise RuntimeError("repro lock guard: owner metadata changed")
        old_deps, new_deps = old[key].get("dependencies", []), new[key].get("dependencies", [])
        if len(old_deps) != len(set(old_deps)) or len(new_deps) != len(set(new_deps)) or (
            set(new_deps) - set(old_deps) != owners[key] or set(old_deps) - set(new_deps)
        ):
            raise RuntimeError("repro lock guard: only the exact owner additions are allowed")
    return {"status": "verified", "added_workspace_dependencies": {
        owner: sorted(names) for owner, names in additions.items()}}


def verify_current_batch_dependencies(before_lock, after_lock, before_manifests, after_manifests):
    """Exact current batch and CLI edges to packages already in the lock."""
    additions = {"er-batch": {"er-env", "er-game", "er-kernel", "er-state", "serde_json"},
                 "er-cli": {"er-batch"}}
    if set(before_manifests) != set(additions) or set(after_manifests) != set(additions):
        raise RuntimeError("batch dependency guard: both owner manifests are required")
    for owner in additions:
        old, new = map(tomllib.loads, (before_manifests[owner], after_manifests[owner]))
        tables = ({"dependencies": {name: {"path": "../" + name}
                                    for name in ("er-env", "er-game", "er-kernel")},
                   "dev-dependencies": {"er-state": {"path": "../er-state"}}}
                  if owner == "er-batch" else
                  {"dependencies": {"er-batch": {"path": "../er-batch"}}})
        if owner == "er-batch":
            tables["dependencies"]["serde_json"] = {"workspace": True}
        expected = dict(old)
        for table, entries in tables.items():
            if set(old.get(table, {})) & set(entries):
                raise RuntimeError("batch dependency guard: dependency already present")
            expected[table] = {**old.get(table, {}), **entries}
        if new != expected:
            raise RuntimeError("batch dependency guard: only exact owner additions may change")
    before, after = map(tomllib.loads, (before_lock, after_lock))
    def records(lock):
        packages = lock.get("package", [])
        result = {(item["name"], item["version"], item.get("source")): item for item in packages}
        if len(result) != len(packages):
            raise RuntimeError("batch lock guard: duplicate package identity")
        return result
    old, new = records(before), records(after)
    if old.keys() != new.keys() or {key: value for key, value in before.items() if key != "package"} != {
        key: value for key, value in after.items() if key != "package"
    }:
        raise RuntimeError("batch lock guard: lock metadata or inventory changed")
    owners = {}
    for name in set(additions) | set().union(*additions.values()):
        keys = [key for key in old if key[0] == name]
        if len(keys) != 1:
            raise RuntimeError("batch lock guard: unambiguous existing packages required")
        source = keys[0][2]
        if (name == "serde_json" and (not isinstance(source, str) or not source.startswith("registry+"))) or (
            name != "serde_json" and source is not None
        ):
            raise RuntimeError("batch lock guard: dependency source must retain workspace or registry identity")
        if name in additions:
            owners[keys[0]] = additions[name]
    for key in old:
        if key not in owners:
            if old[key] != new[key]:
                raise RuntimeError("batch lock guard: another package record changed")
            continue
        if {field: value for field, value in old[key].items() if field != "dependencies"} != {
            field: value for field, value in new[key].items() if field != "dependencies"
        }:
            raise RuntimeError("batch lock guard: owner metadata changed")
        old_deps, new_deps = old[key].get("dependencies", []), new[key].get("dependencies", [])
        if len(old_deps) != len(set(old_deps)) or len(new_deps) != len(set(new_deps)) or (
            set(new_deps) - set(old_deps) != owners[key] or set(old_deps) - set(new_deps)
        ):
            raise RuntimeError("batch lock guard: only exact owner dependency additions are allowed")
    return {"status": "verified", "added_dependencies": {owner: sorted(names) for owner, names in additions.items()}}


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
    timer_focus = config.get("timer_focus", {})
    product_changes = [path for path in changed if path not in config["infrastructure_paths"]
                       and not any(path.startswith(prefix) for prefix in config["documentation_prefixes"])]
    timer_session = any(path in timer_focus.get("trigger_paths", []) for path in product_changes) and all(
        path in timer_focus.get("paths", []) for path in product_changes)
    worker_focus = config.get("worker_session_focus", {})
    worker_paths = worker_focus.get("paths", [])
    worker_session = any(path in worker_paths for path in rust_changes) and all(
        path in worker_paths or path == "rust/Cargo.lock" for path in rust_changes)
    endpoint_focus = config.get("endpoint_session_focus", {})
    endpoint_paths = endpoint_focus.get("paths", [])
    endpoint_session = any(path in endpoint_paths for path in rust_changes) and all(
        path in endpoint_paths or path in worker_paths or path == "rust/Cargo.lock" for path in rust_changes)
    supervisor_focus = config.get("supervisor_focus", {})
    supervisor_paths = supervisor_focus.get("paths", [])
    supervisor_session = bool(product_changes) and all(path in supervisor_paths for path in product_changes)
    cli_reload_focus = config.get("cli_reload_focus", {})
    cli_reload_paths = cli_reload_focus.get("paths", [])
    cli_reload_session = bool(product_changes) and all(path in cli_reload_paths for path in product_changes)
    repro_focus = config.get("current_repro_focus", {})
    repro_session = any(path in repro_focus.get("trigger_paths", []) for path in product_changes) and all(
        path in repro_focus.get("paths", []) for path in product_changes)
    repro_guard = None
    repro_manifests = {owner: f"rust/crates/{owner}/Cargo.toml" for owner in ("er-repro", "er-cli")}
    repro_guard_paths = ["rust/Cargo.lock", *repro_manifests.values()]
    if repro_session and any(path in changed for path in repro_guard_paths):
        if not all(path in changed for path in repro_guard_paths):
            raise RuntimeError("repro dependency guard: both manifests and lock must be paired")
        repro_guard = verify_current_repro_dependencies(
            capture(["git", "show", f"{base}:rust/Cargo.lock"]), (RUST / "Cargo.lock").read_text(),
            {owner: capture(["git", "show", f"{base}:{path}"]) for owner, path in repro_manifests.items()},
            {owner: (ROOT / path).read_text() for owner, path in repro_manifests.items()})
        repro_guard["baseline_sha"] = base
    menu_focus = config.get("menu_validation_focus", {})
    menu_session = any(path in menu_focus.get("trigger_paths", []) for path in product_changes) and all(
        path in menu_focus.get("paths", []) or path in cli_reload_paths for path in product_changes)
    batch_focus = config.get("current_batch_focus", {})
    batch_session = any(path in batch_focus.get("trigger_paths", []) for path in product_changes) and all(
        path in batch_focus.get("paths", []) for path in product_changes)
    batch_guard = None
    batch_manifests = {owner: f"rust/crates/{owner}/Cargo.toml" for owner in ("er-batch", "er-cli")}
    batch_guard_paths = ["rust/Cargo.lock", *batch_manifests.values()]
    if batch_session and any(path in changed for path in batch_guard_paths):
        if not all(path in changed for path in batch_guard_paths):
            raise RuntimeError("batch dependency guard: both manifests and lock must be paired")
        batch_guard = verify_current_batch_dependencies(
            capture(["git", "show", f"{base}:rust/Cargo.lock"]), (RUST / "Cargo.lock").read_text(),
            {owner: capture(["git", "show", f"{base}:{path}"]) for owner, path in batch_manifests.items()},
            {owner: (ROOT / path).read_text() for owner, path in batch_manifests.items()})
        batch_guard["baseline_sha"] = base
    cli_reload_guard = None
    cli_manifest = "rust/crates/er-cli/Cargo.toml"
    if (cli_reload_session or menu_session) and any(path in changed for path in (cli_manifest, "rust/Cargo.lock")):
        if not all(path in changed for path in (cli_manifest, "rust/Cargo.lock")):
            raise RuntimeError("CLI dependency guard: manifest and lock changes must be paired")
        cli_reload_guard = verify_cli_reload_dependencies(
            capture(["git", "show", f"{base}:rust/Cargo.lock"]), (RUST / "Cargo.lock").read_text(),
            capture(["git", "show", f"{base}:{cli_manifest}"]), (ROOT / cli_manifest).read_text())
        cli_reload_guard["baseline_sha"] = base
    native_worker_delta = worker_session or endpoint_session or supervisor_session
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
        elif (timer_session and path in timer_focus["paths"]) or (repro_session and path in repro_focus["paths"]) or ((native_worker_delta or cli_reload_session or menu_session or batch_session) and path == "rust/Cargo.lock") or path in config["infrastructure_paths"] or any(
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
    if supervisor_session:
        execution_scope = supervisor_focus["execute"]
    if cli_reload_session:
        execution_scope = cli_reload_focus["execute"]
    if timer_session:
        execution_scope = timer_focus["execute"]
        browser_required = True
        boundaries = [path for path in boundaries if path not in timer_focus["paths"]]
    if repro_session:
        execution_scope = repro_focus["execute"]
        browser_required = True
        boundaries = [path for path in boundaries if path not in repro_focus["paths"]]
    if menu_session:
        execution_scope = menu_focus["execute"]
        browser_required = True
    if batch_session:
        execution_scope = batch_focus["execute"]
        browser_required = True
    if execution_scope is not None:
        selected.update(execution_scope)
        if not native_worker_delta:
            current_session = True
    # Older checkpoints can execute CLI suites before the reload target exists.
    # The explicit reload scope requires it even when missing; broad scopes bind
    # it whenever present, and exact required-target checks reject its removal.
    endpoint_execution = any(crate in selected and (crate != "er-cli" or cli_reload_session or repro_session or menu_session or batch_session
        or (RUST / "crates/er-cli/tests" / (target + ".rs")).is_file()) and (
        execution_scope is None or "*" in execution_scope.get(crate, [])
        or target in execution_scope.get(crate, [])) for crate, target in WORKER_BOUND_TARGETS)
    if endpoint_execution:
        selected.add("er-kernel-worker")
    cli_executable_required = browser_required and (timer_session or repro_session or batch_session or (
        ROOT / "test/browser/rust-browser/m9e-current-repro-bridge.ts").is_file())
    if cli_executable_required:
        selected.add("er-cli")
    # Explicit witness roots also need their reverse consumers compiled, even
    # when only the TypeScript bridge changed in this cumulative source delta.
    if execution_scope is not None or cli_executable_required or endpoint_execution:
        while True:
            widened = selected | {name for name, deps in dependencies.items() if deps & selected}
            if widened == selected:
                break
            selected = widened
    result = {"base_sha": base, "changed_paths": changed, "packages": sorted(selected),
              "unknown_paths": unknown, "boundary_paths": boundaries,
              "historical_dispositions": config.get("historical_dispositions", []),
              "requires_wasm": shared or bool(boundaries) or current_session,
              "wasm_test": config.get("current_session_wasm_test") if current_session else None,
              "execution_scope": execution_scope,
              "requires_browser": browser_required,
              "requires_cli_clippy": timer_session or repro_session or menu_session or batch_session or any(re.fullmatch(r"rust/crates/er-cli/(?:src|tests)/.+\.rs", path) for path in changed),
              "worker_session_focus": worker_session,
              "endpoint_session_focus": endpoint_session,
              "supervisor_focus": supervisor_session,
              "cli_reload_focus": cli_reload_session,
              "menu_validation_focus": menu_session,
              "cli_reload_dependency_guard": cli_reload_guard,
              "current_repro_focus": repro_session,
              "current_repro_dependency_guard": repro_guard,
              "current_batch_focus": batch_session,
              "current_batch_dependency_guard": batch_guard,
              "requires_cli_executable": cli_executable_required,
              "required_native_test_ids": (batch_focus.get("exact_test_ids", {}) if batch_session
                                           else repro_focus.get("exact_test_ids", {}) if repro_session
                                           else menu_focus.get("exact_test_ids", {}) if menu_session
                                           else timer_focus.get("exact_test_ids", {}) if timer_session else {}),
              "requires_agent_protocol_clippy": timer_session or cli_reload_session or menu_session or batch_session,
              "timer_focus": timer_session,
              "required_native_targets": (batch_focus.get("required_targets", {}) if batch_session
                                          else repro_focus.get("required_targets", {}) if repro_session
                                          else menu_focus.get("required_targets", {}) if menu_session
                                          else timer_focus.get("required_targets", {}) if timer_session
                                          else supervisor_focus.get("required_targets", {}) if supervisor_session
                                          else cli_reload_focus.get("required_targets", {}) if cli_reload_session else {}),
              "timer_mutant": timer_focus.get("mutant") if timer_session else None,
              "replica_mutant": timer_focus.get("replica_mutant") if timer_session else None,
              "requires_worker_executable": endpoint_execution,
              "worker_lock_guard": worker_lock_guard,
              "features": "default"}
    (FULL / "plan.json").write_text(json.dumps(result, indent=2) + "\n")
    # A mixed batch/kernel or otherwise unmapped batch delta cannot fall through
    # to broad native success or bypass the timer and replica mutant gate.
    batch_changed = any(path.startswith("rust/crates/er-batch/") or path in batch_focus.get("trigger_paths", [])
                        for path in product_changes)
    if unknown or boundaries or (batch_changed and not batch_session) or (shared and not timer_session and not repro_session and not menu_session and not batch_session):
        raise RuntimeError("planning requires additional mapping: " + json.dumps(result))
    return result


def required_native_target_counts(required, enumerated):
    """A named witness must exist once and enumerate at least one real test."""
    counts = {}
    for package, names in required.items():
        for name in names:
            matches = [ids for crate, target, ids in enumerated if (crate, target) == (package, name)]
            if len(matches) != 1 or not matches[0]:
                raise RuntimeError(f"required native witness missing, ambiguous or empty: {package}:{name}")
            counts[f"{package}:{name}"] = len(matches[0])
    return counts


def require_native_test_ids(required, enumerated):
    for identity, expected in required.items():
        matches = [ids for crate, target, ids in enumerated if f"{crate}:{target}" == identity]
        if (len(matches) != 1 or not expected or len(expected) != len(set(expected))
                or len(matches[0]) != len(expected) or set(matches[0]) != set(expected)):
            raise RuntimeError("required native test identities/counts disagree: " + identity)


def discover_cli_executable(artifacts, summary):
    """Select the real candidate Cargo CLI inside this invocation's target root."""
    manifest = (RUST / "crates/er-cli/Cargo.toml").resolve()
    configured_root = Path(os.environ.get("CARGO_TARGET_DIR", RUST / "target"))
    target_root = (configured_root if configured_root.is_absolute() else RUST / configured_root).resolve()
    candidates = {}
    for message in artifacts:
        target = message.get("target", {})
        if (message.get("reason") != "compiler-artifact" or target.get("name") != "er-cli"
                or target.get("kind") != ["bin"] or message.get("profile", {}).get("test") is not False
                or Path(message.get("manifest_path", "")).resolve() != manifest):
            continue
        path = Path(message.get("executable") or "")
        if (not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK)
                or path.name != ("er-cli.exe" if os.name == "nt" else "er-cli")
                or path.resolve().name != path.name
                or not path.resolve().is_relative_to(target_root)):
            raise RuntimeError("current repro CLI executable is missing, misnamed or outside target root")
        candidates[path.resolve()] = message
    if len(candidates) != 1:
        raise RuntimeError("current repro requires exactly one real CLI executable artifact")
    if not re.fullmatch(r"[0-9a-f]{40}", summary["product_sha"]):
        raise RuntimeError("current repro CLI source SHA is invalid")
    path, message = next(iter(candidates.items()))
    return {"path": str(path), "root": str(target_root), "sha256": digest(path), "bytes": path.stat().st_size,
            "source_sha": summary["product_sha"], "target": summary["target"], "profile": summary["profile"],
            "manifest_path": "rust/crates/er-cli/Cargo.toml", "cargo_package_id": message.get("package_id"),
            "cargo_profile": message["profile"]}


def browser_cli_env(binding, source_sha):
    if binding is None or binding.get("source_sha") != source_sha:
        raise RuntimeError("current repro browser bridge has no candidate-bound CLI executable")
    path, root = Path(binding["path"]), Path(binding["root"])
    if (not path.is_absolute() or not root.is_absolute() or not path.is_file()
            or not path.resolve().is_relative_to(root.resolve()) or digest(path) != binding["sha256"]):
        raise RuntimeError("current repro browser CLI artifact changed or escaped its root")
    return {"ER_M9E_CLI_EXECUTABLE": str(path), "ER_M9E_CLI_ROOT": str(root),
            "ER_M9E_CLI_SHA256": binding["sha256"], "ER_M9E_CLI_SOURCE_SHA": source_sha}


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
    if (crate, target) not in WORKER_BOUND_TARGETS:
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


def timer_parity_digest(text, platform):
    markers = re.findall(r"M9E_TIMER_PARITY_DIGEST=([^\s]+)", text)
    if len(markers) != 1 or not re.fullmatch(r"[0-9a-f]{64}", markers[0]):
        raise RuntimeError(f"{platform} timer parity digest missing, malformed or duplicated")
    return markers[0]


def wasm_parity_evidence(text, native_digest):
    expected = {"wasm_replays_v7_raw_inputs_eventwise", "wasm_replays_v7_held_timers_eventwise"}
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored;", text)
    names = re.findall(r"\btest (?:[A-Za-z0-9_]+::)*(wasm_replays_v7_[A-Za-z0-9_]+)", text)
    if counts != [("2", "0", "0")] or len(names) != 2 or set(names) != expected:
        raise RuntimeError("Wasm eventwise witness identities/counts disagree")
    wasm_digest = timer_parity_digest(text, "Wasm")
    if native_digest is None or wasm_digest != native_digest:
        raise RuntimeError("native/Wasm held timer eventwise digests disagree or native evidence is missing")
    return {"expected": 2, "passed": 2, "failed": 0, "skipped": 0,
            "selected_test_ids": sorted(expected), "timer_parity_digest": wasm_digest,
            "native_timer_parity_digest": native_digest, "scope": "V7 raw-input and held-timer eventwise parity"}


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
                  "--target", "wasm32-unknown-unknown", "--", "--nocapture"], "wasm-eventwise", env=env)
    summary["wasm_tests"] = wasm_parity_evidence(output.read_text(), summary.get("native_timer_parity_digest"))


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


def browser_bridge_evidence(playwright, binding):
    attachments = []
    def collect(suite):
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                for result in test.get("results", []):
                    attachments.extend((spec.get("title"), item) for item in result.get("attachments", [])
                                       if item.get("name") == "m9e-current-repro-cli-bridge")
        for child in suite.get("suites", []):
            collect(child)
    for suite in playwright.get("suites", []):
        collect(suite)
    if (len(attachments) != 1 or attachments[0][0] != "natural V7 browser startup reaches the real battle command"
            or attachments[0][1].get("contentType") != "application/json"):
        raise RuntimeError("current repro Chromium bridge attachment missing, ambiguous or misplaced")
    attachment = attachments[0][1]
    if "body" in attachment and "path" not in attachment:
        encoded = attachment["body"]
        if not isinstance(encoded, str) or len(encoded) > 5500:
            raise RuntimeError("current repro bridge attachment exceeds bound")
        payload = base64.b64decode(encoded, validate=True)
    elif "path" in attachment and "body" not in attachment:
        path = Path(attachment["path"])
        path = (path if path.is_absolute() else ROOT / path).resolve()
        if (not path.is_relative_to((ROOT / "test-results/rust-browser").resolve())
                or not path.is_file() or path.stat().st_size > 4096):
            raise RuntimeError("current repro bridge attachment path or size is invalid")
        payload = path.read_bytes()
    else:
        raise RuntimeError("current repro bridge attachment requires one bounded body or file")
    if len(payload) > 4096:
        raise RuntimeError("current repro bridge attachment exceeds bound")
    evidence = json.loads(payload)
    fields = {"source_sha", "executable_sha256", "positive_replay", "time_omission_rejected",
              "base_position", "final_position", "processed_attempts", "snapshot_digest", "negative_divergence_position"}
    if (not isinstance(evidence, dict) or set(evidence) != fields
            or evidence["source_sha"] != binding["source_sha"] or evidence["executable_sha256"] != binding["sha256"]
            or evidence["positive_replay"] is not True or evidence["time_omission_rejected"] is not True):
        raise RuntimeError("current repro bridge candidate or replay evidence mismatch")
    for field in ("base_position", "final_position", "processed_attempts", "negative_divergence_position"):
        if type(evidence[field]) is not int or not 0 <= evidence[field] <= (1 << 53) - 1:
            raise RuntimeError("current repro bridge positions are unsafe")
    if (not 1 < evidence["processed_attempts"] <= 256
            or evidence["final_position"] - evidence["base_position"] != evidence["processed_attempts"]
            or not evidence["base_position"] < evidence["negative_divergence_position"] < evidence["final_position"]
            or not isinstance(evidence["snapshot_digest"], str)
            or not re.fullmatch(r"blake3-v1:[0-9a-f]{64}", evidence["snapshot_digest"])):
        raise RuntimeError("current repro bridge trace evidence is inconsistent")
    return evidence


def browser_checks(summary):
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
    if summary.get("plan", {}).get("requires_cli_executable"):
        env.update(browser_cli_env(summary.get("cli_executable"), summary["product_sha"]))
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium",
         "test/browser/rust-browser/m9e-v7-corrective.spec.ts", "--workers=1", "--reporter=line,json"], "browser-journey", ROOT, env)
    run(["pnpm", "exec", "vitest", "run", "--config", "test/node/vitest.config.ts",
         "test/node/rust-browser/engineering/browser-effects-v2.test.ts", "--reporter=json", "--outputFile=" + str(FULL / "browser-effect-results.json")], "browser-effects", ROOT)
    summary["browser_tests"] = browser_result_counts(json.loads((FULL / "browser-results.json").read_text()),
                                                     json.loads((FULL / "browser-effect-results.json").read_text()))
    if summary.get("plan", {}).get("requires_cli_executable"):
        summary["browser_current_repro_bridge"] = browser_bridge_evidence(
            json.loads((FULL / "browser-results.json").read_text()), summary["cli_executable"])


def timer_behavioral_mutant(selection, summary, passed_test_ids):
    behavioral_mutant(selection["timer_mutant"], summary, passed_test_ids, "timer_mutant",
                      ('left: []', 'right: ["battle/command/fight"]'), "cursor-effect")


def replica_behavioral_mutant(selection, summary, passed_test_ids):
    policy = selection["replica_mutant"]
    behavioral_mutant(policy, summary, passed_test_ids, "replica_mutant",
                      (policy["assertion_message"],), "presentation-ownership")


def behavioral_mutant(policy, summary, passed_test_ids, evidence_key, assertion_tokens, assertion_name):
    label = evidence_key.replace("_", "-")
    witness = policy["test"]
    if passed_test_ids.count(f'{policy["target"]}::{witness}') != 1:
        raise RuntimeError("mutant requires exactly one passing ordinary behavioral witness")
    if capture(["git", "diff", "--name-only", "HEAD", "--"]):
        raise RuntimeError("mutant requires a clean exact candidate tracked source tree")
    source = ROOT / policy["source"]
    original = source.read_bytes()
    needle = policy["original"].encode()
    replacement = policy["replacement"].encode()
    if original.count(needle) != 1:
        raise RuntimeError("mutant source consequence must occur exactly once")
    mutated = original.replace(needle, replacement, 1)
    evidence = {"status": "failed", "source": policy["source"], "test": witness,
                "target": policy["target"], "reason": policy["reason"],
                "original_sha256": hashlib.sha256(original).hexdigest(),
                "mutant_sha256": hashlib.sha256(mutated).hexdigest()}
    summary[evidence_key] = evidence
    phase = "source_mutation"
    try:
        source.write_bytes(mutated)
        if capture(["git", "diff", "--name-only", "HEAD", "--"]) != policy["source"]:
            raise RuntimeError("mutant changed unexpected tracked source paths")
        # Share the runner's registry/git dependency cache, never target outputs.
        # This private target tree is deleted and cannot become a passing cache.
        with tempfile.TemporaryDirectory(prefix=f"m9e-{label}-", dir=REPORT) as scratch:
            env = os.environ.copy()
            env["CARGO_TARGET_DIR"] = scratch
            phase = "build"
            build = run(["cargo", "test", "--locked", "-p", policy["package"], "--test", policy["target"],
                         "--no-run", "--message-format=json"], f"{label}-build", RUST, env)
            phase = "artifact_validation"
            if digest(source) != evidence["mutant_sha256"] or capture(["git", "diff", "--name-only", "HEAD", "--"]) != policy["source"]:
                raise RuntimeError("mutant build changed its exact tracked source delta")
            candidates = set()
            expected_manifest = (RUST / "crates" / policy["package"] / "Cargo.toml").resolve()
            for line in build.read_text().splitlines():
                if not line.startswith("{"):
                    continue
                artifact = json.loads(line)
                if (artifact.get("reason") == "compiler-artifact" and artifact.get("profile", {}).get("test") is True
                    and artifact.get("target", {}).get("name") == policy["target"]
                    and "test" in artifact.get("target", {}).get("kind", [])
                    and Path(artifact.get("manifest_path", "")).resolve() == expected_manifest
                    and artifact.get("executable")):
                    binary = Path(artifact["executable"]).resolve()
                    if not binary.is_relative_to(Path(scratch).resolve()) or not binary.is_file():
                        raise RuntimeError("mutant binary is not inside its isolated target tree")
                    candidates.add(binary)
            if len(candidates) != 1:
                raise RuntimeError("mutant build must emit exactly one matching test binary")
            binary = candidates.pop()
            cwd = expected_manifest.parent
            phase = "enumeration"
            listing = run([str(binary), witness, "--exact", "--list", "--format", "terse"], f"{label}-list", cwd, env)
            ids = [line[:-6] for line in listing.read_text().splitlines() if line.endswith(": test")]
            if ids != [witness]:
                raise RuntimeError("mutant must enumerate exactly its named behavioral test")
            output = FULL / f"{label}-execute.log"
            phase = "execution"
            start = time.monotonic()
            try:
                with output.open("w") as stream:
                    result = subprocess.run([str(binary), witness, "--exact", "--format", "pretty"],
                                            cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=120)
            except subprocess.TimeoutExpired as error:
                raise RuntimeError("mutant timed out instead of failing its behavioral assertion") from error
            finally:
                TIMINGS[f"{label}-execute"] = round((time.monotonic() - start) * 1000)
            phase = "behavioral_assertion"
            text = output.read_text()
            evidence["exit_code"] = result.returncode
            counts = re.findall(r"test result: FAILED\. (\d+) passed; (\d+) failed; (\d+) ignored;", text)
            if (result.returncode != 101 or counts != [("0", "1", "0")]
                or f"test {witness} ... FAILED" not in text
                or not re.search(r"thread '" + re.escape(witness) + r"'(?: \(\d+\))? panicked at", text)
                or "assertion `left == right` failed" not in text
                or any(token not in text for token in assertion_tokens)):
                raise RuntimeError(f"mutant did not fail the exact {assertion_name} assertion with one failed test")
            evidence["tests"] = {"executed": 1, "passed": 0, "failed": 1, "skipped": 0}
            evidence["status"] = "detected"
    except Exception as error:
        evidence["failure_phase"] = phase
        evidence["failure"] = str(error)[:512]
        raise
    finally:
        source.write_bytes(original)
        evidence["restored_sha256"] = digest(source)
        if evidence["restored_sha256"] != evidence["original_sha256"] or capture(["git", "diff", "--name-only", "HEAD", "--"]):
            evidence["status"] = "restoration_failed"
            raise RuntimeError("mutant source restoration did not recover the exact candidate")


def write_progress(summary, phase, target=None):
    # A cancelled process cannot run finally. Keep a small, honest checkpoint
    # at the same compact path as the eventual final result. Counts describe
    # completed native targets only; the active target has no result yet.
    progress = {key: summary[key] for key in (
        "product_sha", "workflow_sha", "harness_sha", "lockfile_hash",
        "oracle_sha", "profile", "features", "tests")}
    progress.update({"status": "in_progress", "completion": "unfinished",
                     "active_phase": phase, "active_target": target,
                     "selected_inventory_validated": summary.get("selected_inventory_validated", False)})
    for key in ("content_manifest_hash", "target", "selected_test_ids"):
        if key in summary:
            progress[key] = summary[key]
    if "native_lane" in summary:
        progress["native_lane"] = summary["native_lane"]
    if "native_target_timing_ms" in summary:
        progress["native_target_timing_ms"] = summary["native_target_timing_ms"]
        if len((json.dumps(progress, indent=2) + "\n").encode()) > 16000:
            timing_path = FULL / "native-target-timings.json"
            timing_path.write_text(json.dumps(summary["native_target_timing_ms"], indent=2) + "\n")
            progress["native_target_timing_ms"] = {"file": timing_path.name, "sha256": digest(timing_path),
                                                  "targets": len(summary["native_target_timing_ms"]),
                                                  "total_ms": sum(summary["native_target_timing_ms"].values())}
    encoded = (json.dumps(progress, indent=2) + "\n").encode()
    if len(encoded) > 16000:
        raise RuntimeError("in-progress summary exceeds compact byte bound")
    # FULL and COMPACT share REPORT's filesystem. A partial temporary write is
    # never published as JSON and adds no second compact artifact.
    temporary = FULL / "in-progress-summary.tmp"
    temporary.write_bytes(encoded)
    temporary.replace(COMPACT / "summary.json")


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
        write_progress(summary, "preflight")
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
        try:
            write_progress(summary, "format")
            check_format(selection)
        except RuntimeError as error:
            # Return the bounded remote repair before long process witnesses.
            # check_format restores the exact candidate; no test pass is claimed.
            summary["format_failure"] = str(error)
            raise
        # --tests includes unit and integration targets without requiring a
        # library target in binary-only packages such as er-cli.
        args = ["cargo", "test", "--locked", "--tests", "--no-run", "--message-format=json"]
        for package in selection["packages"]:
            args.extend(["-p", package])
        write_progress(summary, "build")
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
            if not any((cwd.name, name) in WORKER_BOUND_TARGETS for name, cwd in binaries.values()):
                raise RuntimeError("required current process test target is missing")
            worker_executable = discover_worker_executable(artifacts, summary)
            summary["worker_executable"] = worker_executable
        if selection.get("requires_cli_executable"):
            summary["cli_executable"] = discover_cli_executable(artifacts, summary)
        enumerated = []
        for index, (binary, (name, cwd)) in enumerate(sorted(binaries.items())):
            env = native_target_env(cwd.name, name, worker_executable)
            write_progress(summary, "discovery", f"{cwd.name}:{name}")
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
        summary["required_native_target_counts"] = required_native_target_counts(
            selection.get("required_native_targets", {}),
            [(cwd.name, name, ids) for _, _, name, ids, cwd, _, _ in enumerated])
        require_native_test_ids(selection.get("required_native_test_ids", {}),
                                [(cwd.name, name, ids) for _, _, name, ids, cwd, _, _ in enumerated])
        for item in selection["historical_dispositions"]:
            in_scope = execution_scope is None or item["target"] in execution_scope.get(item["crate"], []) or "*" in execution_scope.get(item["crate"], [])
            if in_scope and item["crate"] in selection["packages"] and summary["historical_dispositions"].count(item) != 1:
                raise RuntimeError("historical disposition must identify exactly one enumerated test")
        (FULL / "selected-tests.json").write_text(json.dumps(tests, indent=2) + "\n")
        summary["selected_test_ids"] = {"file": "selected-tests.json", "sha256": digest(FULL / "selected-tests.json")}
        summary["selected_inventory_validated"] = True
        # Preserve complete discovery and identity evidence on lint failure,
        # while rejecting native lint errors before expensive test execution.
        if selection.get("requires_cli_clippy"):
            write_progress(summary, "lint", "er-cli")
            run(["cargo", "clippy", "--locked", "-p", "er-cli", "--all-targets", "--no-deps", "--", "-D", "warnings"], "cli-clippy")
        if selection.get("menu_validation_focus"):
            write_progress(summary, "lint", "er-types")
            run(["cargo", "clippy", "--locked", "-p", "er-types", "--all-targets", "--no-deps", "--", "-D", "warnings"], "types-clippy")
        if selection.get("requires_agent_protocol_clippy"):
            write_progress(summary, "lint", "er-agent-protocol")
            run(["cargo", "clippy", "--locked", "-p", "er-agent-protocol", "--all-targets", "--no-deps", "--", "-D", "warnings"], "agent-protocol-clippy")
        if selection.get("current_repro_focus") or selection.get("timer_focus"):
            for package in ("er-repro", "er-env"):
                write_progress(summary, "lint", package)
                run(["cargo", "clippy", "--locked", "-p", package, "--all-targets", "--no-deps", "--", "-D", "warnings"], package + "-clippy")
        if selection.get("current_batch_focus"):
            for package in ("er-batch", "er-env"):
                write_progress(summary, "lint", package)
                run(["cargo", "clippy", "--locked", "-p", package, "--all-targets", "--no-deps", "--", "-D", "warnings"], package + "-clippy")
        if selection["worker_session_focus"] or selection["requires_worker_executable"]:
            write_progress(summary, "lint", "er-kernel-worker")
            run(["cargo", "clippy", "--locked", "-p", "er-kernel-worker", "--all-targets", "--no-deps", "--", "-D", "warnings"], "worker-clippy")
        if selection["requires_worker_executable"]:
            write_progress(summary, "lint", "er-lab")
            run(["cargo", "clippy", "--locked", "-p", "er-lab", "--all-targets", "--no-deps", "--", "-D", "warnings"], "endpoint-clippy")
        if selection["requires_browser"]:
            write_progress(summary, "lint", "er-web")
            run(["cargo", "clippy", "--locked", "-p", "er-web", "--all-targets", "--no-deps", "--", "-D", "warnings"], "browser-clippy")
        if selection.get("cli_reload_focus") or selection.get("menu_validation_focus") or selection.get("timer_focus") or selection.get("current_batch_focus"):
            enumerated.sort(key=lambda item: (item[4].name, item[2]) != ("er-cli", "m9e_current_reload"))
        if os.environ.get("M9E_PHASE") == "native":
            from m9e_phases import inventory_and_assignment
            lane = os.environ.get("M9E_NATIVE_LANE")
            inventory, assigned = inventory_and_assignment(enumerated, lane)
            summary.update({"native_lane": lane, "native_inventory": inventory,
                            "assigned_targets": assigned, "completed_targets": [],
                            "phase": "native", "qualification": "pending"})
            enumerated = [item for item in enumerated if [item[4].name, item[2]] in assigned]
        for index, binary, name, ids, cwd, excluded_ids, env in enumerated:
            # Run even zero-test harnesses and fail if reported counts disagree.
            write_progress(summary, "native", f"{cwd.name}:{name}")
            output = FULL / f"execute-{index}.log"
            start = time.monotonic()
            print(f"[m9e] execute {name}: {len(ids)} selected tests", flush=True)
            command = [binary, "--format", "terse"]
            native_timer_parity = (cwd.name, name) == ("er-wasm", "m9e_parity")
            if native_timer_parity:
                command.append("--nocapture")
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
            if os.environ.get("M9E_PHASE") == "native":
                summary["completed_targets"].append([cwd.name, name])
            if native_timer_parity:
                expected = {"native_replays_v7_raw_inputs_eventwise", "native_replays_v7_held_timers_eventwise"}
                if len(ids) != 2 or set(ids) != expected:
                    raise RuntimeError("native eventwise parity witness identities/counts disagree")
                summary["native_timer_parity_digest"] = timer_parity_digest(output.read_text(), "native")
        if not summary["tests"]["executed"] and not (os.environ.get("M9E_PHASE") == "native" and not enumerated):
            raise RuntimeError("zero tests executed")
        if os.environ.get("M9E_PHASE") != "native" and selection["requires_wasm"]:
            write_progress(summary, "wasm", selection.get("wasm_test"))
            wasm_checks(selection, summary)
        if os.environ.get("M9E_PHASE") != "native" and selection["requires_browser"]:
            write_progress(summary, "browser")
            browser_checks(summary)
        ordinary_passed_ids = [f"{name}::{test_id}" for _, _, name, ids, _, _, _ in enumerated for test_id in ids]
        owns_mutants = os.environ.get("M9E_PHASE") != "native" or os.environ.get("M9E_NATIVE_LANE") == "a"
        if owns_mutants and selection.get("timer_mutant"):
            write_progress(summary, "mutant", "timer")
            timer_behavioral_mutant(selection, summary, ordinary_passed_ids)
        if owns_mutants and selection.get("replica_mutant"):
            write_progress(summary, "mutant", "replica")
            replica_behavioral_mutant(selection, summary, ordinary_passed_ids)
        if os.environ.get("M9E_PHASE") == "native":
            from m9e_phases import export_native
            export_native(sys.modules[__name__], summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["first_failure"] = str(error)[:4096]
    finally:
        format_patch = FULL / "format.patch"
        summary["format_patch_bytes"] = format_patch.stat().st_size if format_patch.exists() else 0
        patch_metadata = FULL / "format-patch-metadata.json"
        metadata = json.loads(patch_metadata.read_text()) if patch_metadata.exists() else {}
        summary["format_patch_omitted_bytes"] = metadata.get("omitted_bytes", 0)
        summary["format_patch_omitted_paths"] = metadata.get("omitted_paths", [])
        summary["format_repair_bytes"] = metadata.get("repair_bytes", 0)
        summary["format_repair_sha256"] = metadata.get("repair_sha256")
        summary["format_patch_included_paths"] = metadata.get("included_paths", [])
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
        if "native_inventory" in summary:
            inventory_path = FULL / "native-inventory.json"
            inventory_path.write_text(json.dumps({key: summary[key] for key in (
                "native_inventory", "assigned_targets", "completed_targets")}, indent=2) + "\n")
            summary["native_inventory"] = {"file": inventory_path.name, "sha256": digest(inventory_path),
                                           "targets": len(summary["native_inventory"])}
            summary["assigned_targets"] = {"count": len(summary["assigned_targets"])}
            summary["completed_targets"] = {"count": len(summary["completed_targets"])}
        encoded_summary = (json.dumps(summary, indent=2) + "\n").encode()
        if len(encoded_summary) > 16000:
            (FULL / "full-summary.json").write_bytes(encoded_summary)
            summary["evidence"] = [{"file": "full-summary.json", "sha256": digest(FULL / "full-summary.json")}]
            summary["plan"] = {"file": "plan.json", "sha256": digest(FULL / "plan.json")}
            encoded_summary = (json.dumps(summary, indent=2) + "\n").encode()
        if len(encoded_summary) > 16000:
            for key in ("native_target_timing_ms", "required_native_target_counts", "build_only_targets", "timing_ms"):
                if key in summary:
                    summary[key] = {"file": "full-summary.json", "sha256": digest(FULL / "full-summary.json")}
            encoded_summary = (json.dumps(summary, indent=2) + "\n").encode()
        if len(encoded_summary) > 16000:
            raise RuntimeError("native compact summary exceeds 16 KiB after bounded projection")
        (COMPACT / "summary.json").write_bytes(encoded_summary)
        print(json.dumps({key: summary[key] for key in ("product_sha", "status", "tests")}))
    return 0 if summary["status"] == "passed" else 1


def preflight_environment():
    environment = os.environ.copy()
    for key in list(environment):
        if key.startswith(("M9E_PHASE", "M9E_NATIVE_", "M9E_PLATFORM_")) or key == "GITHUB_OUTPUT":
            del environment[key]
    return environment


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=True)
    with (FULL / "harness-tests.log").open("w") as stream:
        preflight = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "scripts/ci", "-p", "test_m9e_feedback.py", "-v"],
                                   cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, env=preflight_environment())
    sys.exit(main("feedback harness self-tests failed; see harness-tests.log" if preflight.returncode else None))
