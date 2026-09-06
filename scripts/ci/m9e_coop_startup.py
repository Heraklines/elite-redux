"""Exact current co-op integration obligations and source-only admission policy."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
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
INFRASTRUCTURE = [HELPER, "scripts/ci/test_m9e_coop_startup.py", ENTRY_PRODUCER, RTC_PRODUCER, "scripts/ci/m9e_coop_choices_diagnostic.py",
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
    if any(not valid_hash(value) for value in binding["source_hashes"].values()):
        raise RuntimeError("current co-op source digest is invalid")
    for target, ids in ((KERNEL_TARGET, KERNEL_IDS), (ENTRY_TARGET, ENTRY_IDS)):
        rows = [row for row in selected if (row["crate"], row["target"]) == target]
        if (len(rows) != 1 or sorted(rows[0]["ids"]) != sorted(ids) or rows[0]["historical_excluded_ids"]
                or plan.get("required_native_test_ids", {}).get(":".join(target)) != ids
                or plan.get("required_native_targets", {}).get(target[0], []).count(target[1]) != 1):
            raise RuntimeError("current co-op exact native identities or target obligations differ")


def valid_hash(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def validate_entry(evidence, identity, binding, root):
    if (not isinstance(evidence, dict) or evidence.get("status") != "passed"
            or evidence.get("source_sha") != identity["product_sha"]
            or evidence.get("run_id") != identity["run_id"]
            or evidence.get("run_attempt") != identity["run_attempt"]
            or evidence.get("toolchain") != identity["toolchain"]
            or evidence.get("executed_test_ids") != ENTRY_IDS
            or evidence.get("tests") != {"executed": 2, "passed": 2, "failed": 0, "skipped": 0}):
        raise RuntimeError("current co-op entry completion or same-run identity differs")
    hashes = evidence.get("source_hashes", {})
    if (set(hashes) != set(ENTRY_SOURCES)
            or any(not valid_hash(value) or digest(Path(root) / path) != value for path, value in hashes.items())
            or any(hashes[path] != value for path, value in binding["source_hashes"].items() if path in hashes)
            or evidence.get("bundle_sha256") != digest(Path(root) / "rust/fixtures/m9/engineering/game-content-bundle-v2.json")):
        raise RuntimeError("current co-op entry source/content conservation differs")
    for name in ("worker_artifact", "cli_artifact", "test_artifact"):
        artifact = evidence.get(name, {})
        profile = artifact.get("profile", {})
        if (not valid_hash(artifact.get("sha256")) or type(artifact.get("bytes")) is not int
                or not 0 < artifact["bytes"] <= 128 << 20 or profile.get("opt_level") != "1"
                or profile.get("debug_assertions") is not True or profile.get("overflow_checks") is not True
                or profile.get("test") is not (name == "test_artifact")):
            raise RuntimeError("current co-op actual optimized debug artifact differs")
    if (evidence["worker_artifact"].get("source_sha") != identity["product_sha"]
            or evidence["worker_artifact"].get("host") != identity["target"]
            or evidence["test_artifact"].get("ids") != ENTRY_IDS
            or evidence["test_artifact"].get("source_sha256") != hashes[PRODUCT_PATHS[13]]):
        raise RuntimeError("current co-op executable source or inventory differs")
    for name in ("worker-build", "build", "execute-1", "execute-2"):
        record = evidence.get("logs", {}).get(name, {})
        seconds = record.get("elapsed_seconds")
        limit = 600 if name.startswith("execute-") else 900
        if (not valid_hash(record.get("sha256")) or type(record.get("bytes")) is not int
                or not 0 < record["bytes"] <= (16384 if limit == 600 else 16 << 20)
                or type(seconds) not in (int, float) or not 0 < seconds <= limit):
            raise RuntimeError("current co-op complete bounded build/execution logs required")


def execute_entry(root, full, identity, binding, ids, global_deadline):
    """Retain two actual exact-one results; never fabricate a combined test log."""
    from m9e_current_cost import run_bounded
    if ids != ENTRY_IDS or os.environ.get("M9E_NATIVE_LANE") != "a":
        raise RuntimeError("current co-op entry requires exactly-once native A ownership")
    root, full = Path(root), Path(full)
    owned = Path(os.environ["RUNNER_TEMP"]) / "m9e-coop-entry-focused"
    if owned.exists():
        raise RuntimeError("current co-op entry output already exists")
    environment = dict(os.environ)
    environment.update({"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0"})
    for profile in ("DEV", "TEST"):
        environment.update({f"CARGO_PROFILE_{profile}_DEBUG": "0", f"CARGO_PROFILE_{profile}_OPT_LEVEL": "1",
                            f"CARGO_PROFILE_{profile}_DEBUG_ASSERTIONS": "true", f"CARGO_PROFILE_{profile}_OVERFLOW_CHECKS": "true"})
    try:
        run_bounded([sys.executable, ENTRY_PRODUCER], cwd=root, environment=environment,
                    output=full / "coop-entry-producer.log", seconds=1800,
                    byte_limit=65536, global_deadline=global_deadline)
        summary_path = owned / "compact/summary.json"
        if not 0 < summary_path.stat().st_size <= 16384 or (owned / "target").exists():
            raise RuntimeError("current co-op bounded proof or owned cleanup differs")
        evidence = json.loads(summary_path.read_text())
        validate_entry(evidence, identity, binding, root)
        for index in (1, 2):
            matches = list((owned / "diagnostics").glob(f"*-execute-{index}.log"))
            if len(matches) != 1 or digest(matches[0]) != evidence["logs"][f"execute-{index}"]["sha256"]:
                raise RuntimeError("current co-op actual execution log digest differs")
            counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out",
                                matches[0].read_text())
            if counts != [("1", "0", "0", "0", "1")]:
                raise RuntimeError("current co-op actual individual test completion differs")
        if source_binding(root, identity["product_sha"]) != binding or time.monotonic() > global_deadline:
            raise RuntimeError("current co-op source conservation or shared deadline differs")
        return evidence
    finally:
        # Full logs stay in the owning native diagnostic artifact on either outcome.
        if (owned / "diagnostics").is_dir():
            shutil.copytree(owned / "diagnostics", full / "coop-entry")
        if (owned / "compact/summary.json").is_file():
            shutil.copyfile(owned / "compact/summary.json", full / "coop-entry-summary.json")


def validate_lane(proof, root, partition):
    required = proof["plan"].get("requires_current_coop_startup", False)
    if required:
        validate_inventory(proof["plan"], proof["inventory"], proof["identity"]["product_sha"])
        if source_binding(root, proof["identity"]["product_sha"]) != proof["plan"]["current_coop_startup_binding"]:
            raise RuntimeError("current co-op plan source binding differs from actual checkout")
        if any(list(target) not in partition(proof["inventory"])["a"] for target in (ENTRY_TARGET, KERNEL_TARGET)):
            raise RuntimeError("current co-op requires sole native A ownership")
        if proof["lane"] == "a":
            validate_entry(proof.get("current_coop_entry"), proof["identity"], proof["plan"]["current_coop_startup_binding"], root)
    if "current_coop_entry" in proof and (not required or proof["lane"] != "a"):
        raise RuntimeError("unrequested or non-owning current co-op entry evidence")


def execute_platform(feedback, identity, binding):
    """Run the qualified journeys against this platform job's existing assets."""
    import m9e_coop_rtc_diagnostic as rtc
    rtc.ROOT = feedback.ROOT
    rtc.FULL = feedback.FULL / "coop-rtc"
    rtc.FULL.mkdir(exist_ok=False)
    rtc.OUTPUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-v7-web"
    rtc.DEADLINE = time.monotonic() + 900
    rtc.logs = {}
    evidence = {"source_sha": identity["product_sha"], "run_id": identity["run_id"], "run_attempt": identity["run_attempt"],
                "source_hashes": {path: digest(feedback.ROOT / path) for path in rtc.SOURCES}}
    previous = dict(os.environ)
    try:
        rtc.run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "ESNext",
                 "--module", "ESNext", "--moduleResolution", "bundler", "--lib", "ESNext,DOM", "--types", "node,vite/client",
                 PRODUCT_PATHS[16], rtc.SPEC], "typecheck", 120)
        rtc.execute_prepared(evidence, install_chromium=False)
        evidence.update({"status": "passed", "logs": rtc.logs})
        if source_binding(feedback.ROOT, identity["product_sha"]) != binding or time.monotonic() > rtc.DEADLINE:
            raise RuntimeError("current co-op platform source conservation or deadline differs")
        return evidence
    finally:
        os.environ.clear()
        os.environ.update(previous)


def validate_platform(proof, native, root):
    required = native["plan"].get("requires_current_coop_startup", False)
    evidence = proof.get("current_coop_rtc")
    if not required:
        if evidence is not None:
            raise RuntimeError("unrequested current co-op platform evidence")
        return
    identity = native["identity"]
    binding = native["plan"]["current_coop_startup_binding"]
    if (not isinstance(evidence, dict) or evidence.get("status") != "passed"
            or any(evidence.get(key) != identity[target] for key, target in (
                ("source_sha", "product_sha"), ("run_id", "run_id"), ("run_attempt", "run_attempt")))
            or evidence.get("tests") != {"passed": 2, "failed": 0, "skipped": 0, "ids": BROWSER_IDS}):
        raise RuntimeError("current co-op platform exact completion or same-run identity differs")
    hashes = evidence.get("source_hashes", {})
    if (set(hashes) != set(RTC_SOURCES)
            or any(not valid_hash(value) or digest(Path(root) / path) != value for path, value in hashes.items())
            or any(hashes[path] != value for path, value in binding["source_hashes"].items() if path in hashes)):
        raise RuntimeError("current co-op platform source conservation differs")
    rtc_proof = proof["browser_rtc_assets"]
    rtc = rtc_proof["manifest"]
    if evidence.get("platform") != {"manifest_sha256": rtc_proof["manifest_sha256"], "worker": rtc["worker"],
            "assets": rtc["assets"], "cohort": rtc["cohort"], "source_sha": identity["product_sha"]}:
        raise RuntimeError("current co-op did not use the integration platform's actual assets")
    setup = evidence.get("initializations", {})
    if (set(setup) != {"schema_version", "source_sha", "assets"} or setup.get("schema_version") != 1
            or setup.get("source_sha") != identity["product_sha"]
            or set(setup.get("assets", {})) != {"coop-host-initialization.json", "coop-guest-initialization.json"}
            or not valid_hash(evidence.get("setup_manifest_sha256"))):
        raise RuntimeError("current co-op exact natural initialization manifest differs")
    for asset in setup["assets"].values():
        if (set(asset) != {"bytes", "sha256"} or type(asset["bytes"]) is not int
                or not 0 < asset["bytes"] <= 65536 or not valid_hash(asset["sha256"])):
            raise RuntimeError("current co-op bounded initialization asset differs")
    expected_setup_hash = hashlib.sha256((json.dumps(setup, sort_keys=True) + "\n").encode()).hexdigest()
    if evidence["setup_manifest_sha256"] != expected_setup_hash:
        raise RuntimeError("current co-op natural input manifest digest differs")
    journeys = evidence.get("browser_evidence", [])
    if len(journeys) != 2:
        raise RuntimeError("current co-op both real browser journeys required")
    for index, journey in enumerate(journeys):
        expected = {"source_sha": identity["product_sha"], "order": ("host", "guest")[index],
                    "actual_workers": 2, "worker_sha256": rtc["assets"][rtc["worker"]]["sha256"],
                    "setup_manifest_sha256": evidence["setup_manifest_sha256"], **rtc["cohort"],
                    "host_choices": [1], "guest_choices": [7, 10], "party_owners": [1, 2, 2],
                    "raw_inputs": [1440, 1446], "received": ([2, 3], [3, 3])[index],
                    "delayed_offer_ms": (12000, 0)[index], "retry_preserved_snapshots": True, "presentations": 1}
        if any(journey.get(key) != value for key, value in expected.items()):
            raise RuntimeError("current co-op actual journey, party, retry or presentation differs")
        for prefix, maximum in (("choices", 16384), ("started", 448 << 10)):
            if (type(journey.get(prefix + "_bytes")) is not int or not 0 < journey[prefix + "_bytes"] <= maximum
                    or not valid_hash(journey.get(prefix + "_sha256"))):
                raise RuntimeError("current co-op bounded actual network payload evidence differs")
    for key in ("choices_sha256", "choices_bytes", "started_sha256", "started_bytes"):
        if journeys[0][key] != journeys[1][key]:
            raise RuntimeError("current co-op ordering changed deterministic network material")
    browser = evidence.get("logs", {}).get("browser", {})
    if (not valid_hash(browser.get("sha256")) or type(browser.get("bytes")) is not int
            or not 0 < browser["bytes"] <= 16 << 20 or type(browser.get("elapsed_seconds")) not in (int, float)
            or not 0 < browser["elapsed_seconds"] <= 660):
        raise RuntimeError("current co-op complete bounded browser execution required")


def aggregate_reference(native, platform, native_hash, platform_hash):
    if not native["plan"].get("requires_current_coop_startup"):
        return {}
    return {"current_coop_startup": {"status": "passed", "kernel_tests": 4, "entry_tests": 2, "rtc_tests": 2,
            "native_manifest_sha256": native_hash, "platform_manifest_sha256": platform_hash,
            "entry_evidence_sha256": hashlib.sha256((json.dumps(native["current_coop_entry"], sort_keys=True, separators=(",", ":")) + "\n").encode()).hexdigest(),
            "rtc_evidence_sha256": hashlib.sha256((json.dumps(platform["current_coop_rtc"], sort_keys=True, separators=(",", ":")) + "\n").encode()).hexdigest()}}


ENTRY_SOURCES = [".github/workflows/m9e-coop-entry-focused.yml","rust/Cargo.lock","rust/Cargo.toml","rust/crates/er-agent-protocol/src/lib.rs","rust/crates/er-cli/Cargo.toml","rust/crates/er-cli/src/current_agent.rs","rust/crates/er-cli/src/current_native_capture.rs","rust/crates/er-cli/src/current_worker_agent.rs","rust/crates/er-cli/tests/m9e_current_coop_startup.rs","rust/crates/er-cli/tests/support/m9e_coop_cli_process.rs","rust/crates/er-env/Cargo.toml","rust/crates/er-env/src/current.rs","rust/crates/er-game/Cargo.toml","rust/crates/er-game/src/m72_bootstrap.rs","rust/crates/er-game/src/m9e_new_run_v6.rs","rust/crates/er-kernel-worker/src/runtime.rs","rust/crates/er-kernel/Cargo.toml","rust/crates/er-kernel/src/current_coop_setup_v7.rs","rust/crates/er-kernel/src/game_kernel_v7.rs","rust/crates/er-kernel/src/snapshot_v7.rs","rust/crates/er-repro/src/current.rs","rust/crates/er-state/src/m7_state.rs","rust/crates/er-state/src/m9e_state_v6.rs","rust/crates/er-types/src/m72_bootstrap.rs","rust/crates/er-web/Cargo.toml","rust/crates/er-web/src/contracts_v2.rs","rust/crates/er-web/src/host_v2.rs","rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json","rust/rust-toolchain.toml","scripts/ci/m9e_coop_entry_diagnostic.py","scripts/ci/m9e_current_cost.py"]


RTC_SOURCES = [".github/workflows/m9e-coop-rtc-focused.yml",".nvmrc","package.json","playwright.rust-browser.config.ts","pnpm-lock.yaml","rust/Cargo.lock","rust/Cargo.toml","rust/crates/er-env/src/current.rs","rust/crates/er-game/src/m72_bootstrap.rs","rust/crates/er-game/src/m9e_new_run_v6.rs","rust/crates/er-kernel/src/current_coop_setup_v7.rs","rust/crates/er-kernel/src/game_kernel_v7.rs","rust/crates/er-kernel/src/snapshot_v7.rs","rust/crates/er-repro/src/current.rs","rust/crates/er-web/Cargo.toml","rust/crates/er-web/examples/m9e_v7_browser_fixtures.rs","rust/crates/er-web/examples/m9e_v7_coop_startup.rs","rust/crates/er-web/src/contracts_v2.rs","rust/crates/er-web/src/host_v2.rs","rust/rust-toolchain.toml","scripts/build-kernel-m9e-v7-web.mjs","scripts/ci/m9e_coop_rtc_diagnostic.py","scripts/ci/m9e_current_cost.py","src/rust-browser/adapters/current-rtc-transport.ts","src/rust-browser/contracts/browser-contracts-v2.ts","src/rust-browser/contracts/browser-contracts.ts","src/rust-browser/host/current-rust-browser-host.ts","src/rust-browser/routes/rust-current-rtc-entry.ts","src/rust-browser/routes/rust-current-worker-entry.ts","src/rust-browser/worker/current-rust-kernel-worker.ts","src/rust-browser/worker/rust-wasm-loader.ts","test/browser/rust-browser/m9e-v7-coop-startup.spec.ts"]
