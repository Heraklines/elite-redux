"""Remote focused proof of independent Title setup across real Workers and RTC."""
import base64
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import time

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-repeat-physical-rtc-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
OUTPUT = REPORT / "web"
START = int(os.environ["M9E_FOCUS_STARTED_AT"])
DEADLINE = time.monotonic() + 1780 - (time.time() - START)
EXAMPLE = "rust/crates/er-web/examples/m9e_v7_coop_startup.rs"
SPEC = "test/browser/rust-browser/m9e-v7-repeat-rebind-rtc.spec.ts"
OWNER_SPEC = "test/browser/rust-browser/m9e-v7-repeat-rebind-rtc-owner.spec.ts"
OWNER_ID = "current V7 RTC owner automatically rebinds twice with natural gameplay across three connections"
IDS = ["current V7 Workers physically reconnect RTC generations two and three with retained receipts and replay"]
SOURCES = [EXAMPLE, SPEC, "scripts/ci/m9e_repeat_physical_rtc.py", ".github/workflows/m9e-repeat-physical-rtc-focused.yml",
           "src/rust-browser/contracts/browser-contracts-v2.ts", "src/rust-browser/contracts/browser-contracts.ts",
           "src/rust-browser/routes/rust-current-rtc-entry.ts", "src/rust-browser/adapters/current-rtc-transport.ts",
           "src/rust-browser/routes/rust-current-worker-entry.ts", "src/rust-browser/routes/browser-effects-v2.ts",
           "src/rust-browser/host/current-rust-browser-host.ts",
           "src/rust-browser/worker/current-rust-kernel-worker.ts", "src/rust-browser/worker/rust-wasm-loader.ts",
           "scripts/build-kernel-m9e-v7-web.mjs", "rust/crates/er-web/examples/m9e_v7_browser_fixtures.rs",
           "rust/crates/er-web/src/contracts_v2.rs", "rust/crates/er-web/src/host_v2.rs",
           "rust/crates/er-kernel/src/current_coop_setup_v7.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs",
           "rust/crates/er-kernel/src/snapshot_v7.rs", "rust/crates/er-kernel/src/current_proposal_v7.rs",
           "rust/crates/er-game/src/m9e_new_run_v6.rs",
           "rust/crates/er-game/src/m72_bootstrap.rs", "rust/crates/er-env/src/current.rs",
           "rust/crates/er-repro/src/current.rs", "rust/rust-toolchain.toml", "rust/Cargo.lock", "rust/Cargo.toml",
           "rust/crates/er-web/Cargo.toml", "pnpm-lock.yaml", "package.json", ".nvmrc",
           "playwright.rust-browser.config.ts", "scripts/ci/m9e_current_cost.py"]
SOURCES += ["rust/crates/er-state/src/m9e_state_v6.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-game/src/m9e_material_v6.rs"]
SOURCES += ["rust/crates/er-battle/src/m7_resolver.rs", "test/browser/rust-browser/m9e-v7-rebind.spec.ts", "rust/crates/er-kernel/src/current_coop_rebind_v7.rs"]
SOURCES += [OWNER_SPEC, "src/rust-browser/routes/rust-current-rtc-rebind-entry.ts", "src/rust-browser/adapters/current-rtc-transport-v2.ts"]
NATIVE_TARGETS = [
    ("er-cli", "m9e_current_coop_rebind", ["actual_native_cli_rebind_preserves_capture_admission_restore_and_gameplay"]),
    ("er-kernel", "m9e_current_proposal_v7", ["current_proposal_publication_receipt_and_snapshot_conserve_ownership",
        "current_proposal_rejection_duplicate_and_terminal_are_transactional"]),
    ("er-kernel", "m9e_snapshot_v7", ["active_snapshot_round_trips_at_a_quiescent_boundary",
        "quiescent_v6_snapshot_migrates_without_gameplay_side_effects", "terminal_lifecycle_requires_complete_control_and_terminal_identity",
        "typed_pending_effects_cross_validate_allocator_and_content"]),
]
SOURCES += [f"rust/crates/{crate}/tests/{target}.rs" for crate, target, _ in NATIVE_TARGETS]
logs = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, seconds=900, bound=16 << 20):
    global failed_log
    output = FULL / f"{len(logs) + 1:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT, environment=dict(os.environ), output=output,
                             seconds=seconds, byte_limit=bound, global_deadline=DEADLINE)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    return output


def asset(path, maximum):
    if path.is_symlink() or not path.is_file() or path.resolve().parent != OUTPUT.resolve() or not 0 < path.stat().st_size <= maximum:
        raise RuntimeError("bounded contained actual asset required")
    return {"bytes": path.stat().st_size, "sha256": digest(path)}


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if run(["git", "rev-parse", "HEAD"], "identity", 30, 16384).read_text().strip() != sha:
        raise RuntimeError("exact candidate required")
    changes = run(["git", "diff", "--name-only", "9568027f51a15af9449d01939e3e8e8da9d863e6", "HEAD"], "source-delta", 30, 16384).read_text().splitlines()
    if sorted(changes) != sorted([SPEC, OWNER_SPEC, "scripts/ci/m9e_repeat_physical_rtc.py", ".github/workflows/m9e-repeat-physical-rtc-focused.yml"]):
        raise RuntimeError("only the two repeated browser specs and two CI files may change")
    summary["base_sha"] = "9568027f51a15af9449d01939e3e8e8da9d863e6"
    summary["source_hashes"] = {path: digest(ROOT / path) for path in SOURCES}
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", 30, 16384).read_text().strip()
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", EXAMPLE], "format", 60, 262144)
    except Exception:
        run([*formatter, EXAMPLE], "format-repair", 60, 262144)
        patch = run(["git", "diff", "--binary", "--", EXAMPLE], "format-patch", 30, 262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary["formatted_hashes"] = {EXAMPLE: digest(ROOT / EXAMPLE)}
        summary["format_patch_bytes"] = patch.stat().st_size
        summary["format_patch_sha256"] = digest(patch)
        raise RuntimeError("remote pinned formatting required; no qualification")
    run(["cargo", "clippy", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-web",
         "--example", "m9e_v7_coop_startup", "--no-deps", "--", "-D", "warnings"], "clippy")
    summary["native_integration"] = []
    for crate, target, ids in NATIVE_TARGETS:
        argv = ["cargo", "test", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", crate,
                "--test", target, "--", "--test-threads=1"]
        output = run(argv, "native-" + target).read_text()
        actual = re.findall(r"^test ([A-Za-z0-9_:]+) \.\.\. ok$", output, re.M)
        expected = f"test result: ok. {len(ids)} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;"
        if sorted(actual) != sorted(ids) or output.count(expected) != 1:
            raise RuntimeError(f"complete actual integration target differs: {target}")
        summary["native_integration"].append({"crate": crate, "target": target, "ids": ids,
            "passed": len(ids), "failed": 0, "skipped": 0, "argv": argv})
    run(["pnpm", "install", "--frozen-lockfile"], "dependencies")
    run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "ESNext", "--module", "ESNext",
         "--moduleResolution", "bundler", "--lib", "ESNext,DOM", "--types", "node,vite/client",
         "src/rust-browser/routes/rust-current-rtc-entry.ts", SPEC, OWNER_SPEC], "typecheck", 120)
    if shutil.which("wasm-bindgen") is None:
        run(["cargo", "install", "wasm-bindgen-cli", "--version", "0.2.127", "--locked"], "wasm-tools")
    if run(["wasm-bindgen", "--version"], "wasm-version", 30, 16384).read_text().strip() != "wasm-bindgen 0.2.127":
        raise RuntimeError("pinned Wasm CLI required")
    os.environ.update({"M9E_BUILD_CURRENT_WORKER": "1", "M9E_BUILD_CURRENT_RTC": "1"})
    run(["node", "scripts/build-kernel-m9e-v7-web.mjs", "--out-dir", str(OUTPUT)], "platform-build")
    execute_prepared(summary)


def execute_prepared(summary, *, install_chromium=True):
    """Same assertions and actual journeys for F and same-candidate integration."""
    sha = os.environ["GITHUB_SHA"]
    run(["cargo", "run", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-web", "--example",
         "m9e_v7_coop_startup", "--", str(OUTPUT)], "natural-inputs")
    setup = {"schema_version": 1, "source_sha": sha, "assets": {
        name: asset(OUTPUT / name, 65536) for name in ("coop-host-initialization.json", "coop-guest-initialization.json")}}
    (OUTPUT / "m9e-v7-coop-startup-assets.json").write_text(json.dumps(setup, sort_keys=True) + "\n")
    summary["initializations"] = setup
    summary["setup_manifest_sha256"] = digest(OUTPUT / "m9e-v7-coop-startup-assets.json")
    manifests = {}
    for name in ("m9e-v7-web-assets.json", "m9e-v7-rtc-assets.json", "m9e-v7-worker-assets.json"):
        asset(OUTPUT / name, 16384)
        value = json.loads((OUTPUT / name).read_text())
        if value.get("source_sha") != sha or value.get("schema_version") != 1:
            raise RuntimeError("actual platform manifest source mismatch")
        for path, metadata in value["assets"].items():
            if Path(path).name != path or asset(OUTPUT / path, 32 << 20) != {key: metadata[key] for key in ("bytes", "sha256")}:
                raise RuntimeError("actual platform asset mismatch")
        if any(digest(ROOT / path) != expected for path, expected in value.get("source_hashes", {}).items()):
            raise RuntimeError("actual bundle source mismatch")
        manifests[name] = value
        shutil.copyfile(OUTPUT / name, FULL / name)
    rtc = manifests["m9e-v7-rtc-assets.json"]
    summary["platform"] = {"manifest_sha256": digest(OUTPUT / "m9e-v7-rtc-assets.json"), "worker": rtc["worker"],
                            "assets": rtc["assets"], "cohort": rtc["cohort"], "source_sha": sha}
    retained = {path.name: digest(path) for path in OUTPUT.iterdir() if path.is_file()}
    if install_chromium:
        run(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], "chromium")
    os.environ["M9E_V7_WEB_DIR"] = str(OUTPUT)
    os.environ["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(FULL / "browser-results.json")
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium",
         SPEC, "--workers=1", "--reporter=line,json"], "browser", 660)
    report = json.loads((FULL / "browser-results.json").read_text())
    specs = []
    def collect(suite):
        specs.extend(suite.get("specs", []))
        for child in suite.get("suites", []):
            collect(child)
    for suite in report.get("suites", []):
        collect(suite)
    if report.get("errors") or len(specs) != 1 or [spec["title"] for spec in specs] != IDS:
        raise RuntimeError("exact physical generation two test required")
    spec = specs[0]
    if spec.get("file") not in (SPEC, Path(SPEC).name) or len(spec.get("tests", [])) != 1:
        raise RuntimeError("exact physical spec required")
    test = spec["tests"][0]
    results = test.get("results", [])
    if test.get("expectedStatus") != "passed" or len(results) != 1 or results[0].get("status") != "passed" or results[0].get("retry") != 0:
        raise RuntimeError("sole actual successful execution required")
    attachments = results[0].get("attachments", [])
    if len(attachments) != 1 or attachments[0].get("name") != "m9e-current-browser-physical-repeat-rebind" or attachments[0].get("contentType") != "application/json":
        raise RuntimeError("physical browser receipt required")
    raw = base64.b64decode(attachments[0]["body"], validate=True)
    if not 0 < len(raw) <= 16384:
        raise RuntimeError("bounded physical receipt required")
    evidence = json.loads(raw)
    worker = manifests["m9e-v7-worker-assets.json"]
    expected = {"source_sha": sha, "manifest_sha256": digest(OUTPUT / "m9e-v7-worker-assets.json"),
                "entry_sha256": worker["assets"][worker["entry"]]["sha256"],
                "worker_sha256": worker["assets"][worker["worker"]]["sha256"],
                "worker_path": worker["worker"], **worker["cohort"],
                "setup_manifest_sha256": summary["setup_manifest_sha256"],
                "schema_version": 1, "browser_worker_protocol_version": 2, "observed_worker_count": 8,
                "actual_workers": 8, "disposed_workers": 8, "physical_connections": 6,
                "generation": 3, "transcript_controls": 16, "known_rejections": [1, 3],
                "physical_carriers": [
                    {"generation": 1, "sent": [1, 1], "received": [1, 1], "closed": True, "selected_pairs": 2},
                    {"generation": 2, "sent": [6, 6], "received": [6, 6], "closed": True, "selected_pairs": 2},
                    {"generation": 3, "sent": [8, 7], "received": [7, 8], "closed": True, "selected_pairs": 2}]}
    for key, value in expected.items():
        if evidence.get(key) != value or type(evidence.get(key)) is not type(value):
            raise RuntimeError(f"physical evidence differs: {key}")
    for key in ("startup_handoff_verified", "midphase_replay", "final_replay", "deleted_control_rejected",
                "duplicate_receipt_exact", "retry_snapshot_conserved", "repeated_rebind",
                "stale_payloads_rejected", "second_midphase_replay"):
        if evidence.get(key) is not True:
            raise RuntimeError(f"preserved rebind assertion missing: {key}")
    if any(digest(OUTPUT / path) != expected for path, expected in retained.items()):
        raise RuntimeError("actual platform inputs changed during execution")
    if any(digest(ROOT / path) != expected for path, expected in summary["source_hashes"].items()):
        raise RuntimeError("source changed during actual browser execution")
    summary["browser_evidence"] = evidence
    os.environ["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(FULL / "owner-browser-results.json")
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium",
         OWNER_SPEC, "--workers=1", "--reporter=line,json"], "owner-browser", 660)
    owner_report = json.loads((FULL / "owner-browser-results.json").read_text())
    specs.clear()
    for suite in owner_report.get("suites", []):
        collect(suite)
    if owner_report.get("errors") or len(specs) != 1 or specs[0]["title"] != OWNER_ID:
        raise RuntimeError("exact repeated shipping owner test required")
    owner_spec = specs[0]
    if owner_spec.get("file") not in (OWNER_SPEC, Path(OWNER_SPEC).name) or len(owner_spec.get("tests", [])) != 1:
        raise RuntimeError("exact shipping owner spec required")
    owner_test = owner_spec["tests"][0]
    owner_results = owner_test.get("results", [])
    if owner_test.get("expectedStatus") != "passed" or len(owner_results) != 1 or owner_results[0].get("status") != "passed" or owner_results[0].get("retry") != 0:
        raise RuntimeError("sole successful shipping owner execution required")
    owner_attachments = owner_results[0].get("attachments", [])
    if len(owner_attachments) != 1 or owner_attachments[0].get("name") != "m9e-current-rtc-owner-repeat-rebind" or owner_attachments[0].get("contentType") != "application/json":
        raise RuntimeError("shipping owner repeated rebind receipt required")
    owner_raw = base64.b64decode(owner_attachments[0]["body"], validate=True)
    if not 0 < len(owner_raw) <= 16384:
        raise RuntimeError("bounded owner receipt required")
    owner = json.loads(owner_raw)
    owner_expected = {key: expected[key] for key in ("source_sha", "manifest_sha256", "entry_sha256", "worker_sha256",
        "worker_path", "glue_sha256", "wasm_sha256", "content_sha256", "setup_manifest_sha256", "schema_version", "browser_worker_protocol_version")}
    owner_expected.update({"observed_worker_count": 6, "actual_workers": 6, "disposed_workers": 6, "generation": 3,
        "automatic_rebind_controls": [4, 4], "repeated_rebind_controls": [4, 4], "successful_signaling_pairs": 3,
        "connected_callbacks": [2, 2], "disconnected_callbacks": [2, 2],
        "rtc_manifest_sha256": digest(OUTPUT / "m9e-v7-rtc-assets.json"), "owner_worker_path": rtc["worker"]})
    for key, value in owner_expected.items():
        if owner.get(key) != value or type(owner.get(key)) is not type(value):
            raise RuntimeError(f"shipping owner evidence differs: {key}")
    for key in ("live_begin_rejected", "checkpoint_handoff_exact", "full_replay", "deleted_control_rejected",
                "duplicate_receipt_exact", "duplicate_receipt_delivered", "final_lifecycle_equal", "repeated_rebind"):
        if owner.get(key) is not True:
            raise RuntimeError(f"shipping owner assertion missing: {key}")
    if any(digest(OUTPUT / path) != expected for path, expected in retained.items()):
        raise RuntimeError("platform inputs changed during shipping owner execution")
    if any(digest(ROOT / path) != expected for path, expected in summary["source_hashes"].items()):
        raise RuntimeError("source changed during shipping owner execution")
    summary["owner_browser_evidence"] = owner
    summary["tests"] = {"passed": 2, "failed": 0, "skipped": 0, "ids": IDS + [OWNER_ID]}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "qualification": "seven existing native integration cases plus repeated physical RTC and shipping owner gameplay, retained receipts and replay"}
    try:
        main(summary)
        if time.monotonic() > DEADLINE:
            raise RuntimeError("global deadline exceeded")
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                stream.seek(max(0, failed_log.stat().st_size - 24000))
                tail = stream.read(24000)
        (FULL / "failure.txt").write_text(str(error) + "\nBounded tail; complete logs remain remote.\n" + tail.decode("utf-8", errors="replace"))
    finally:
        summary["logs"] = logs
        summary["elapsed_seconds_including_checkout"] = time.time() - START
        summary["run_attempt"] = os.environ["GITHUB_RUN_ATTEMPT"]
        raw = json.dumps(summary, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        if len(raw) > 32768:
            raise RuntimeError("compact result exceeds32KiB")
        (COMPACT / "summary.json").write_bytes(raw)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
