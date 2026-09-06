"""Exact current co-op integration obligations and source-only admission policy."""
import copy
import hashlib
import json
from pathlib import Path
import tomllib

HELPER = "scripts/ci/m9e_coop_startup.py"
KERNEL_TARGET = ("er-kernel", "m9e_coop_choices_v7")
ENTRY_TARGET = ("er-cli", "m9e_current_coop_startup")
KERNEL_IDS = ["confirmed_independent_raw_starters_form_exact_owned_party_and_preserve_host",
              "invalid_peer_choices_preserve_entire_state_rng_and_allocator",
              "natural_owned_startup_waits_for_both_orders_restores_and_retries_without_reexecution",
              "owned_startup_rejects_forged_frames_and_snapshots_atomically"]
ENTRY_IDS = ["current_native_cli_owned_coop_retry_replay_matches_browser_host",
             "current_process_worker_owned_coop_retry_replay_matches_browser_host"]
BROWSER_IDS = [f"natural cooperative Title through two Workers and RTC {seat} ready first" for seat in ("host", "guest")]
PRODUCT_PATHS = [
    "rust/crates/er-game/src/m9e_new_run_v6.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs",
    "rust/crates/er-kernel/src/snapshot_v7.rs", "rust/crates/er-kernel/src/current_coop_setup_v7.rs",
    "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs", "rust/crates/er-kernel/tests/m9e_coop_choices_v7.rs",
    "rust/crates/er-env/src/current.rs", "rust/crates/er-cli/src/current_agent.rs",
    "rust/crates/er-web/src/contracts_v2.rs", "rust/crates/er-web/src/host_v2.rs",
    "rust/crates/er-agent-protocol/src/lib.rs", "rust/crates/er-cli/Cargo.toml", "rust/Cargo.lock",
    "rust/crates/er-cli/tests/m9e_current_coop_startup.rs", "rust/crates/er-cli/tests/support/m9e_coop_cli_process.rs",
    "src/rust-browser/contracts/browser-contracts-v2.ts", "src/rust-browser/routes/rust-current-rtc-entry.ts",
    "rust/crates/er-web/examples/m9e_v7_coop_startup.rs", "test/browser/rust-browser/m9e-v7-coop-startup.spec.ts",
]
TRIGGERS = [PRODUCT_PATHS[index] for index in (3, 5, 13, 14, 17, 18)]
NATIVE_TARGETS = {KERNEL_TARGET[0]: [KERNEL_TARGET[1]], ENTRY_TARGET[0]: [ENTRY_TARGET[1]]}
NATIVE_IDS = {":".join(KERNEL_TARGET): KERNEL_IDS, ":".join(ENTRY_TARGET): ENTRY_IDS}
POLICY = {"paths": PRODUCT_PATHS, "exact_test_ids": NATIVE_IDS, "browser_ids": BROWSER_IDS}
ENTRY_PRODUCER = "scripts/ci/m9e_coop_entry_diagnostic.py"
RTC_PRODUCER = "scripts/ci/m9e_coop_rtc_diagnostic.py"
INFRASTRUCTURE = [HELPER, ENTRY_PRODUCER, RTC_PRODUCER, "scripts/ci/m9e_coop_choices_diagnostic.py",
                  ".github/workflows/m9e-coop-entry-focused.yml", ".github/workflows/m9e-coop-rtc-focused.yml",
                  ".github/workflows/m9e-coop-choices-focused.yml"]


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def select_scope(config, changed, root):
    root = Path(root)
    present = [path for path in TRIGGERS if (root / path).is_file()]
    requested = any(path in TRIGGERS for path in changed)
    policy = config.get("current_coop_startup_focus")
    if policy is not None and policy != POLICY:
        raise RuntimeError("current co-op exact source and identity policy differs")
    if (present or requested) and (policy is None or len(present) != len(TRIGGERS)):
        raise RuntimeError("current co-op requires its complete installed product and policy")
    installed = bool(present)
    scoped = installed and bool(changed) and any(path in PRODUCT_PATHS for path in changed) and all(path in PRODUCT_PATHS for path in changed)
    if requested and not scoped:
        raise RuntimeError("current co-op mixed product delta is unmapped")
    return scoped, installed


def dependency_guard(before_manifest, after_manifest, before_lock, after_lock):
    before = tomllib.loads(before_manifest)
    after = tomllib.loads(after_manifest)
    expected = copy.deepcopy(before)
    dependencies = expected.setdefault("dependencies", {})
    if "er-protocol" in dependencies:
        raise RuntimeError("co-op dependency must be the new direct protocol edge")
    dependencies["er-protocol"] = {"path": "../er-protocol"}
    if after != expected:
        raise RuntimeError("co-op manifest changed beyond the direct protocol dependency")
    original = tomllib.loads(before_lock)
    expected_lock = copy.deepcopy(original)
    matches = [package for package in expected_lock.get("package", []) if package.get("name") == "er-cli"]
    if len(matches) != 1 or "er-protocol" in matches[0].get("dependencies", []):
        raise RuntimeError("co-op lock requires one unmodified CLI package")
    matches[0]["dependencies"] = sorted([*matches[0].get("dependencies", []), "er-protocol"])
    if tomllib.loads(after_lock) != expected_lock:
        raise RuntimeError("co-op lock changed beyond the exact CLI dependency edge")
    return {"dependency": "er-protocol", "manifest": "rust/crates/er-cli/Cargo.toml", "lock": "rust/Cargo.lock"}


def source_binding(root, source_sha):
    root = Path(root)
    return {"source_sha": source_sha, "source_hashes": {
        path: digest(root / path) for path in [*PRODUCT_PATHS, HELPER, ENTRY_PRODUCER, RTC_PRODUCER]}}


def validate_inventory(plan, inventory, source_sha):
    selected = [row for row in inventory if (row["crate"], row["target"]) in (KERNEL_TARGET, ENTRY_TARGET)]
    required = plan.get("requires_current_coop_startup", False)
    if type(required) is not bool or (selected and not required):
        raise RuntimeError("current co-op obligation is absent or not boolean")
    if not required:
        return
    if len(selected) != 2 or not all(plan.get(key) is True for key in (
        "requires_browser", "requires_wasm", "requires_browser_worker", "requires_browser_rtc",
        "requires_cli_executable", "requires_worker_executable")):
        raise RuntimeError("current co-op omitted its native or actual platform prerequisites")
    binding = plan.get("current_coop_startup_binding")
    if not isinstance(binding, dict) or binding.get("source_sha") != source_sha:
        raise RuntimeError("current co-op source binding differs from candidate")
    if set(binding.get("source_hashes", {})) != set([*PRODUCT_PATHS, HELPER, ENTRY_PRODUCER, RTC_PRODUCER]):
        raise RuntimeError("current co-op source binding is incomplete")
    for target, ids in ((KERNEL_TARGET, KERNEL_IDS), (ENTRY_TARGET, ENTRY_IDS)):
        rows = [row for row in selected if (row["crate"], row["target"]) == target]
        if (len(rows) != 1 or sorted(rows[0]["ids"]) != sorted(ids) or rows[0]["historical_excluded_ids"]
                or plan.get("required_native_test_ids", {}).get(":".join(target)) != ids
                or plan.get("required_native_targets", {}).get(target[0], []).count(target[1]) != 1):
            raise RuntimeError("current co-op exact native identities or target obligations differ")
