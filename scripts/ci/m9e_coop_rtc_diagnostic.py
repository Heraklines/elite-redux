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
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-coop-rtc-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
OUTPUT = REPORT / "web"
DEADLINE = time.monotonic() + 1800
EXAMPLE = "rust/crates/er-web/examples/m9e_v7_coop_startup.rs"
WORKER_IMPORT_EXAMPLE = "rust/crates/er-kernel-worker/examples/m9e_browser_capsule_import.rs"
SPEC = "test/browser/rust-browser/m9e-v7-coop-startup.spec.ts"
WORKER_SPEC = "test/browser/rust-browser/m9e-v7-worker.spec.ts"
WORKER_ID = "current V7 Worker preserves fresh account IDs through snapshot restore"
IDS = [f"natural cooperative Title through two Workers and RTC {seat} ready first" for seat in ("host", "guest")]
PUBLIC_RETRY_ID = "owned natural co-op public retry recovers a pending proposal after disconnected snapshot restore through six Workers"
IDS.append(PUBLIC_RETRY_ID)
SOURCES = [EXAMPLE, SPEC, WORKER_SPEC, "scripts/ci/m9e_coop_rtc_diagnostic.py", ".github/workflows/m9e-coop-rtc-focused.yml",
           ".github/workflows/m9e-current-browser-rtc-probe.yml",
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
           "rust/crates/er-cli/Cargo.toml", "rust/crates/er-cli/src/main.rs",
           "rust/crates/er-cli/src/current_commands.rs", WORKER_IMPORT_EXAMPLE,
           "rust/crates/er-kernel-worker/Cargo.toml", "rust/crates/er-kernel-worker/src/protocol_v2.rs",
           "rust/crates/er-kernel-worker/src/runtime_v2.rs",
           "rust/crates/er-web/Cargo.toml", "pnpm-lock.yaml", "package.json", ".nvmrc",
           "playwright.rust-browser.config.ts", "scripts/ci/m9e_current_cost.py"]
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
    try:
        run([*formatter, "--check", WORKER_IMPORT_EXAMPLE], "worker-import-format", 60, 262144)
    except Exception:
        run([*formatter, WORKER_IMPORT_EXAMPLE], "worker-import-format-repair", 60, 262144)
        patch = run(["git", "diff", "--binary", "--", WORKER_IMPORT_EXAMPLE],
                    "worker-import-format-patch", 30, 262144)
        shutil.copyfile(patch, COMPACT / "worker-import-format.patch")
        summary["formatted_hashes"] = {WORKER_IMPORT_EXAMPLE: digest(ROOT / WORKER_IMPORT_EXAMPLE)}
        summary["format_patch_bytes"] = patch.stat().st_size
        summary["format_patch_sha256"] = digest(patch)
        raise RuntimeError("remote pinned worker import formatting required; no qualification")
    run(["cargo", "clippy", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-web",
         "--example", "m9e_v7_coop_startup", "--no-deps", "--", "-D", "warnings"], "clippy")
    run(["cargo", "clippy", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-kernel-worker",
         "--example", "m9e_browser_capsule_import", "--no-deps", "--", "-D", "warnings"],
        "worker-import-clippy")
    run(["pnpm", "install", "--frozen-lockfile"], "dependencies")
    run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "ESNext", "--module", "ESNext",
         "--moduleResolution", "bundler", "--lib", "ESNext,DOM", "--types", "node,vite/client",
         "src/rust-browser/routes/rust-current-rtc-entry.ts", SPEC, WORKER_SPEC], "typecheck", 120)
    if shutil.which("wasm-bindgen") is None:
        run(["cargo", "install", "wasm-bindgen-cli", "--version", "0.2.127", "--locked"], "wasm-tools")
    if run(["wasm-bindgen", "--version"], "wasm-version", 30, 16384).read_text().strip() != "wasm-bindgen 0.2.127":
        raise RuntimeError("pinned Wasm CLI required")
    os.environ.update({"M9E_BUILD_CURRENT_WORKER": "1", "M9E_BUILD_CURRENT_RTC": "1"})
    run(["node", "scripts/build-kernel-m9e-v7-web.mjs", "--out-dir", str(OUTPUT)], "platform-build")
    execute_prepared(summary)


def validate_public_retry(result, summary, rtc, sha):
    """Validate bounded source-bound browser facts, never claim snapshot reconstruction."""
    attachments = result.get("attachments", [])
    if (not isinstance(attachments, list) or len(attachments) != 1
            or not isinstance(attachments[0], dict)
            or attachments[0].get("name") != "m9e-natural-coop-public-retry"
            or attachments[0].get("contentType") != "application/json"):
        raise RuntimeError("sole public retry evidence required")
    attachment = attachments[0]
    if set(attachment) == {"name", "contentType", "body"}:
        body = attachment["body"]
        if not isinstance(body, str) or not 0 < len(body) <= 21848:
            raise RuntimeError("bounded encoded public retry evidence required")
        raw = base64.b64decode(body, validate=True)
    elif set(attachment) == {"name", "contentType", "path"}:
        if not isinstance(attachment["path"], str) or not 0 < len(attachment["path"]) <= 4096:
            raise RuntimeError("bounded public retry evidence path required")
        original = Path(attachment["path"])
        if not original.is_absolute():
            original = ROOT / original
        expected_root = ROOT / "test-results/rust-browser"
        if original.is_symlink() or expected_root.is_symlink():
            raise RuntimeError("public retry evidence symlink forbidden")
        path = original.resolve(strict=True)
        if (not path.is_relative_to(expected_root.resolve(strict=True)) or not path.is_file()
                or any(parent.is_symlink() for parent in original.parents)
                or not 0 < path.stat().st_size <= 16384):
            raise RuntimeError("bounded contained public retry evidence required")
        raw = path.read_bytes()
    else:
        raise RuntimeError("unambiguous public retry evidence payload required")
    if not 0 < len(raw) <= 16384:
        raise RuntimeError("public retry evidence exceeds16KiB")

    def object_without_duplicates(pairs):
        value = {}
        for key, child in pairs:
            if key in value:
                raise RuntimeError("duplicate public retry evidence key")
            value[key] = child
        return value

    def reject_constant(_value):
        raise RuntimeError("non-finite public retry evidence number")

    value = json.loads(raw, object_pairs_hook=object_without_duplicates, parse_constant=reject_constant)
    expected_keys = {"schema_version", "source_sha", "worker_sha256", "glue_sha256", "wasm_sha256",
                     "content_sha256", "setup_manifest_sha256", "actual_workers", "generation", "recovery",
                     "peers", "settled_retry_noop", "disposed_workers"}
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise RuntimeError("exact public retry evidence schema required")
    if (type(value["schema_version"]) is not int or value["schema_version"] != 1
            or type(value["actual_workers"]) is not int or value["actual_workers"] != 6
            or type(value["disposed_workers"]) is not int or value["disposed_workers"] != 6
            or type(value["generation"]) is not int or value["generation"] != 1
            or value["settled_retry_noop"] is not True
            or value["recovery"] != "genuine_pending_and_committed_checkpoints_then_actual_disconnected_restore"
            or value["source_sha"] != sha
            or value["worker_sha256"] != rtc["assets"][rtc["worker"]]["sha256"]
            or value["setup_manifest_sha256"] != summary["setup_manifest_sha256"]
            or set(rtc["cohort"]) != {"glue_sha256", "wasm_sha256", "content_sha256"}
            or any(value[key] != expected for key, expected in rtc["cohort"].items())):
        raise RuntimeError("public retry evidence differs from actual source/assets or six-Worker journey")
    if not isinstance(value["peers"], list) or len(value["peers"]) != 2:
        raise RuntimeError("two ordered public retry peer records required")
    peer_keys = {"role", "stages", "checkpoint_bytes", "checkpoint_sha256", "before_bytes", "before_sha256",
                 "after_bytes", "after_sha256", "proposal_bytes", "proposal_sha256", "receipt_bytes", "receipt_sha256",
                 "sent", "received", "frame_bytes", "presentations", "original_presentations", "original_raw_inputs",
                 "restored_raw_inputs", "lifecycle_sha256", "ledger_sha256", "exact_frames", "ownership_verified",
                 "host_snapshot_conserved"}
    hash_keys = {"checkpoint_sha256", "before_sha256", "after_sha256", "proposal_sha256", "receipt_sha256",
                 "lifecycle_sha256", "ledger_sha256"}
    count_keys = {"checkpoint_bytes", "before_bytes", "after_bytes", "proposal_bytes", "receipt_bytes", "sent",
                  "received", "frame_bytes", "presentations", "original_presentations", "original_raw_inputs",
                  "restored_raw_inputs"}
    for index, peer in enumerate(value["peers"]):
        if not isinstance(peer, dict) or set(peer) != peer_keys or peer["role"] != ("AUTHORITY", "REPLICA")[index]:
            raise RuntimeError("exact ordered public retry peer schema required")
        if (any(not isinstance(peer[key], str) or not re.fullmatch(r"[0-9a-f]{64}", peer[key]) for key in hash_keys)
                or any(type(peer[key]) is not int or not 0 <= peer[key] <= 9007199254740991 for key in count_keys)):
            raise RuntimeError("strict public retry hashes and safe integer counts required")
        if (any(not 0 < peer[key] <= 16 << 20 for key in ("checkpoint_bytes", "before_bytes", "after_bytes"))
                or not 0 < peer["proposal_bytes"] <= 16 << 10 or not 0 < peer["receipt_bytes"] <= 1 << 20
                or peer["sent"] != 1 or peer["received"] != 1
                or peer["sent"] + peer["received"] > 16
                or peer["frame_bytes"] != peer["proposal_bytes"] + peer["receipt_bytes"]
                or not 0 < peer["frame_bytes"] <= 4 << 20
                or peer["original_raw_inputs"] <= 0 or peer["original_raw_inputs"] % 2 != 0
                or peer["restored_raw_inputs"] != 0 or peer["original_presentations"] <= 0
                or peer["presentations"] > peer["original_presentations"]
                or peer["exact_frames"] is not True or peer["ownership_verified"] is not True
                or peer["host_snapshot_conserved"] is not (index == 0)):
            raise RuntimeError("public retry frame/byte/raw-input/ownership conservation differs")
        stages = peer["stages"]
        if not isinstance(stages, list) or len(stages) != 2:
            raise RuntimeError("both fresh restore stages required")
        for stage_index, stage in enumerate(stages):
            if (not isinstance(stage, dict)
                    or set(stage) != {"phase", "exact_restore", "preconnection_retry_rejected"}
                    or stage["phase"] != ("checkpoint", "disconnected_restore")[stage_index]
                    or stage["exact_restore"] is not True or stage["preconnection_retry_rejected"] is not True):
                raise RuntimeError("public retry restore/ingress fencing evidence differs")
        if peer["checkpoint_sha256"] == peer["before_sha256"]:
            raise RuntimeError("real disconnected-to-connected snapshot transition required")
        if index == 0:
            if (peer["before_sha256"] != peer["after_sha256"] or peer["before_bytes"] != peer["after_bytes"]
                    or peer["presentations"] != 0):
                raise RuntimeError("authority exact snapshot and presentation conservation required")
        elif peer["before_sha256"] == peer["after_sha256"]:
            raise RuntimeError("replica pending receipt must actually change its retained state")
    authority, replica = value["peers"]
    if any(authority[key] != replica[key] for key in ("proposal_bytes", "proposal_sha256", "receipt_bytes", "receipt_sha256",
                                                     "lifecycle_sha256", "ledger_sha256")):
        raise RuntimeError("actual peer wire and committed lifecycle/ledger bindings differ")
    # These hashes bind assertions made by the source-verified actual browser
    # producer. No full snapshots or receipt bytes are attached for independent
    # reconstruction here; do not upgrade these facts into that stronger claim.
    return value

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
    worker = manifests["m9e-v7-worker-assets.json"]
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
    if report.get("errors") or len(specs) != 3 or [spec["title"] for spec in specs] != IDS:
        raise RuntimeError("all three exact natural browser journeys required")
    evidence = []
    for index, spec in enumerate(specs):
        if spec.get("file") not in (SPEC, Path(SPEC).name) or len(spec.get("tests", [])) != 1:
            raise RuntimeError("exact test source/project required")
        test = spec["tests"][0]
        results = test.get("results", [])
        if (test.get("projectName") != "chromium" or test.get("status") != "expected" or len(results) != 1
                or results[0].get("status") != "passed" or results[0].get("retry") != 0):
            raise RuntimeError("no failed, skipped, flaky, retried or missing browser journey")
        if index == 2:
            evidence.append(validate_public_retry(results[0], summary, rtc, sha))
            continue
        attachments = [item for item in results[0].get("attachments", []) if item.get("name") == "m9e-natural-coop-startup"]
        if len(attachments) != 1 or attachments[0].get("contentType") != "application/json":
            raise RuntimeError("sole actual startup evidence required")
        attachment = attachments[0]
        if "body" in attachment:
            raw = base64.b64decode(attachment["body"], validate=True)
        else:
            path = Path(attachment["path"]).resolve()
            if path.is_symlink() or not path.is_relative_to(ROOT / "test-results/rust-browser") or not 0 < path.stat().st_size <= 4096:
                raise RuntimeError("invalid evidence path")
            raw = path.read_bytes()
        if len(raw) > 4096:
            raise RuntimeError("bounded browser evidence required")
        value = json.loads(raw)
        if (value.get("source_sha") != sha or value.get("order") != ("host", "guest")[index]
                or value.get("actual_workers") != 2 or value.get("worker_sha256") != rtc["assets"][rtc["worker"]]["sha256"]
                or value.get("setup_manifest_sha256") != summary["setup_manifest_sha256"]
                or any(value.get(key) != expected for key, expected in rtc["cohort"].items())
                or value.get("party_owners") != [1, 2, 2] or value.get("received") != ([2, 3], [3, 3])[index]
                or value.get("delayed_offer_ms") != (12000, 0)[index]
                or value.get("retry_preserved_snapshots") is not True or value.get("presentations", 0) <= 0):
            raise RuntimeError("browser evidence differs from actual bound assets and journey")
        if value.get("replay_workers") != 2 or len(value.get("replay", [])) != 2:
            raise RuntimeError("two additional actual replay Workers required")
        for replay in value["replay"]:
            if (set(replay) != {"bytes", "sha256", "live_snapshot_preserved", "full_replay_equal", "reexport_equal", "disposed"}
                    or type(replay["bytes"]) is not int or not 0 < replay["bytes"] <= 4 << 20
                    or not isinstance(replay["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", replay["sha256"])
                    or any(replay[key] is not True for key in ("live_snapshot_preserved", "full_replay_equal", "reexport_equal", "disposed"))):
                raise RuntimeError("actual complete current capsule replay evidence differs")
        evidence.append(value)
    if any(digest(ROOT / path) != expected for path, expected in summary["source_hashes"].items()):
        raise RuntimeError("bound source changed during platform execution")
    if any(digest(OUTPUT / path) != expected for path, expected in retained.items()):
        raise RuntimeError("actual platform inputs changed during execution")
    summary["browser_evidence"] = evidence
    os.environ["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(FULL / "fresh-account-results.json")
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium",
         WORKER_SPEC, "--grep", WORKER_ID, "--workers=1", "--reporter=line,json"], "account-browser", 180)
    account_report = json.loads((FULL / "fresh-account-results.json").read_text())
    account_specs = []
    def collect_account(suite):
        account_specs.extend(suite.get("specs", []))
        for child in suite.get("suites", []):
            collect_account(child)
    for suite in account_report.get("suites", []):
        collect_account(suite)
    if account_report.get("errors") or len(account_specs) != 1 or account_specs[0].get("title") != WORKER_ID:
        raise RuntimeError("sole actual fresh-account Worker journey required")
    account_spec = account_specs[0]
    if account_spec.get("file") not in (WORKER_SPEC, Path(WORKER_SPEC).name) or len(account_spec.get("tests", [])) != 1:
        raise RuntimeError("fresh-account Worker source/project mismatch")
    account_test = account_spec["tests"][0]
    account_results = account_test.get("results", [])
    if (account_test.get("projectName") != "chromium" or account_test.get("status") != "expected"
            or len(account_results) != 1 or account_results[0].get("status") != "passed"
            or account_results[0].get("retry") != 0):
        raise RuntimeError("fresh-account Worker journey failed, retried or skipped")
    attachments = [item for item in account_results[0].get("attachments", [])
                   if item.get("name") == "m9e-fresh-account-worker"]
    if len(attachments) != 1 or attachments[0].get("contentType") != "application/json":
        raise RuntimeError("sole bounded fresh-account Worker evidence required")
    attachment = attachments[0]
    if "body" in attachment:
        if not isinstance(attachment["body"], str) or not 0 < len(attachment["body"]) <= 5500:
            raise RuntimeError("fresh-account Worker encoded evidence bound exceeded")
        raw = base64.b64decode(attachment["body"], validate=True)
    else:
        original = Path(attachment["path"])
        if not original.is_absolute():
            original = ROOT / original
        if original.is_symlink():
            raise RuntimeError("fresh-account Worker evidence symlink forbidden")
        path = original.resolve(strict=True)
        if not path.is_relative_to((ROOT / "test-results/rust-browser").resolve(strict=True)) or not 0 < path.stat().st_size <= 4096:
            raise RuntimeError("fresh-account Worker evidence path invalid")
        raw = path.read_bytes()
    if not 0 < len(raw) <= 4096:
        raise RuntimeError("fresh-account Worker evidence bound exceeded")
    account = json.loads(raw)
    opening = account.get("opening")
    if (account.get("source_sha") != sha or account.get("manifest_sha256") != digest(OUTPUT / "m9e-v7-worker-assets.json")
            or account.get("entry_sha256") != worker["assets"][worker["entry"]]["sha256"]
            or account.get("worker_sha256") != worker["assets"][worker["worker"]]["sha256"]
            or account.get("worker_path") != worker["worker"]
            or any(account.get(key) != expected for key, expected in worker["cohort"].items())
            or account.get("account") != {"trainer_id": 12345, "secret_id": 23456}
            or not isinstance(account.get("checkpoint_sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", account["checkpoint_sha256"])
            or account.get("observed_worker_count") != 2 or account.get("disposed_workers") != 2
            or account.get("exact_snapshot_restore") is not True
            or account.get("first_closed") is not True or account.get("second_closed") is not True):
        raise RuntimeError("fresh-account Worker evidence differs from actual source/assets or restored identity")
    if (not isinstance(opening, dict)
            or opening.get("wave") != 1
            or opening.get("player_id") != 1771723560
            or opening.get("enemy_id") != 1173608932
            or opening.get("enemy_species") != 915
            or opening.get("enemy_moves") != [158, 230, 39, 98]
            or opening.get("source_progression") is not True
            or type(opening.get("authority_material_count")) is not int
            or not 0 < opening["authority_material_count"] <= 64):
        raise RuntimeError("fresh-account Worker did not retain the qualified source Town opening")
    if any(digest(ROOT / path) != expected for path, expected in summary["source_hashes"].items()):
        raise RuntimeError("bound source changed during fresh-account Worker execution")
    if any(digest(OUTPUT / path) != expected for path, expected in retained.items()):
        raise RuntimeError("actual platform inputs changed during fresh-account Worker execution")
    summary["fresh_account_worker_evidence"] = account

    cross_attachments = [item for item in account_results[0].get("attachments", [])
                         if item.get("name") == "m9e-fresh-account-cross-entry"]
    if len(cross_attachments) != 1 or cross_attachments[0].get("contentType") != "application/json":
        raise RuntimeError("sole complete browser-to-native witness required")
    cross_attachment = cross_attachments[0]
    if "body" in cross_attachment:
        encoded = cross_attachment["body"]
        if not isinstance(encoded, str) or not 0 < len(encoded) <= 6 << 20:
            raise RuntimeError("browser-to-native encoded witness exceeds its bound")
        cross_raw = base64.b64decode(encoded, validate=True)
    else:
        original = Path(cross_attachment["path"])
        if not original.is_absolute():
            original = ROOT / original
        if original.is_symlink():
            raise RuntimeError("browser-to-native witness symlink forbidden")
        path = original.resolve(strict=True)
        if (not path.is_relative_to((ROOT / "test-results/rust-browser").resolve(strict=True))
                or not 0 < path.stat().st_size <= 4 << 20):
            raise RuntimeError("browser-to-native witness path invalid")
        cross_raw = path.read_bytes()
    if not 0 < len(cross_raw) <= 4 << 20:
        raise RuntimeError("browser-to-native witness exceeds its bound")
    cross = json.loads(cross_raw)
    if not isinstance(cross, dict) or set(cross) != {"capsule", "snapshot"}:
        raise RuntimeError("browser-to-native witness shape differs")
    capsule = cross["capsule"]
    if (not isinstance(capsule, dict) or not isinstance(cross["snapshot"], dict)
            or not isinstance(capsule.get("attempts"), list) or not capsule["attempts"]
            or type(capsule.get("base_position")) is not int
            or type(capsule.get("final_position")) is not int
            or capsule["final_position"] <= capsule["base_position"]):
        raise RuntimeError("browser-to-native capsule has no causal attempts")
    capsule_path = REPORT / "fresh-account-capsule.json"
    capsule_bytes = json.dumps(capsule, separators=(",", ":")).encode()
    if not 0 < len(capsule_bytes) <= 2 << 20:
        raise RuntimeError("browser-to-native capsule exceeds its bound")
    capsule_path.write_bytes(capsule_bytes)
    run(["cargo", "build", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-cli",
         "--bin", "er-cli"], "native-cli-build", 360)
    cli = ROOT / "rust/target/debug/er-cli"
    if cli.is_symlink() or not cli.is_file() or not 0 < cli.stat().st_size <= 128 << 20:
        raise RuntimeError("actual native current CLI binary required")
    replay_log = run([str(cli), "capsule-validate", "--content", str(OUTPUT / "game-content-bundle-v2.json"),
                      "--capsule", str(capsule_path)], "native-cli-replay", 120, 4 << 20)
    replay = json.loads(replay_log.read_text())
    if (replay.get("validation") != "ISOLATED_CURRENT_CAPSULE_REPLAY"
            or replay.get("schema_valid") is not True or replay.get("replay_valid") is not True
            or replay.get("processed_attempts") != len(capsule["attempts"])
            or replay.get("final_position") != capsule["final_position"]
            or replay.get("snapshot") != cross["snapshot"]):
        raise RuntimeError("actual native CLI replay differs from complete browser Worker snapshot")
    summary["native_cross_entry"] = {
        "capsule_bytes": len(capsule_bytes), "capsule_sha256": hashlib.sha256(capsule_bytes).hexdigest(),
        "attempts": len(capsule["attempts"]), "final_position": capsule["final_position"],
        "snapshot_sha256": hashlib.sha256(json.dumps(cross["snapshot"], sort_keys=True,
                                               separators=(",", ":")).encode()).hexdigest(),
        "cli_sha256": digest(cli), "full_snapshot_equal": True,
    }
    snapshot_path = REPORT / "fresh-account-snapshot.json"
    snapshot_bytes = json.dumps(cross["snapshot"], separators=(",", ":")).encode()
    if not 0 < len(snapshot_bytes) <= 8 << 20:
        raise RuntimeError("browser snapshot exceeds native worker import bound")
    snapshot_path.write_bytes(snapshot_bytes)
    run(["cargo", "build", "--manifest-path", "rust/Cargo.toml", "--locked", "-p",
         "er-kernel-worker", "--example", "m9e_browser_capsule_import"],
        "native-worker-import-build", 360)
    witness = ROOT / "rust/target/debug/examples/m9e_browser_capsule_import"
    if witness.is_symlink() or not witness.is_file() or not 0 < witness.stat().st_size <= 128 << 20:
        raise RuntimeError("actual native worker import witness executable required")
    worker_log = run([str(witness), str(OUTPUT / "game-content-bundle-v2.json"),
                      str(capsule_path), str(snapshot_path), sha],
                     "native-worker-import", 120, 1 << 20)
    worker_import = json.loads(worker_log.read_text())
    if (worker_import.get("source_sha") != sha
            or worker_import.get("browser_frontier") != capsule["final_position"]
            or worker_import.get("native_frontier") != capsule["final_position"] + 1
            or worker_import.get("native_suffix_attempts") != 1
            or worker_import.get("full_snapshot_equal") is not True
            or worker_import.get("executable_sha256") != digest(witness)):
        raise RuntimeError("native worker runtime did not preserve and continue browser capsule")
    summary["native_worker_import"] = worker_import
    early_attachments = [item for item in account_results[0].get("attachments", [])
                         if item.get("name") == "m9e-fresh-account-cross-entry-early"]
    if len(early_attachments) != 1 or early_attachments[0].get("contentType") != "application/json":
        raise RuntimeError("sole early browser-to-native causal prefix required")
    early_attachment = early_attachments[0]
    if "body" in early_attachment:
        encoded = early_attachment["body"]
        if not isinstance(encoded, str) or not 0 < len(encoded) <= 6 << 20:
            raise RuntimeError("early browser-to-native encoded witness exceeds its bound")
        early_raw = base64.b64decode(encoded, validate=True)
    else:
        original = Path(early_attachment["path"])
        if not original.is_absolute():
            original = ROOT / original
        if original.is_symlink():
            raise RuntimeError("early browser-to-native witness symlink forbidden")
        path = original.resolve(strict=True)
        if (not path.is_relative_to((ROOT / "test-results/rust-browser").resolve(strict=True))
                or not 0 < path.stat().st_size <= 4 << 20):
            raise RuntimeError("early browser-to-native witness path invalid")
        early_raw = path.read_bytes()
    if not 0 < len(early_raw) <= 4 << 20:
        raise RuntimeError("early browser-to-native witness exceeds its bound")
    early = json.loads(early_raw)
    if not isinstance(early, dict) or set(early) != {"capsule", "snapshot"}:
        raise RuntimeError("early browser-to-native witness shape differs")
    early_capsule = early["capsule"]
    if (not isinstance(early_capsule, dict) or not isinstance(early["snapshot"], dict)
            or type(early_capsule.get("base_position")) is not int
            or early_capsule["base_position"] != 0
            or type(early_capsule.get("final_position")) is not int
            or early_capsule["final_position"] < 1
            or not isinstance(early_capsule.get("attempts"), list)
            or len(early_capsule["attempts"]) != early_capsule["final_position"]):
        raise RuntimeError("first browser raw input did not retain its complete causal prefix")
    early_capsule_path = REPORT / "fresh-account-early-capsule.json"
    early_capsule_bytes = json.dumps(early_capsule, separators=(",", ":")).encode()
    if not 0 < len(early_capsule_bytes) <= 2 << 20:
        raise RuntimeError("early browser capsule exceeds its bound")
    early_capsule_path.write_bytes(early_capsule_bytes)
    early_replay_log = run([str(cli), "capsule-validate", "--content", str(OUTPUT / "game-content-bundle-v2.json"),
                            "--capsule", str(early_capsule_path)], "native-cli-early-replay", 120, 4 << 20)
    early_replay = json.loads(early_replay_log.read_text())
    if (early_replay.get("validation") != "ISOLATED_CURRENT_CAPSULE_REPLAY"
            or early_replay.get("schema_valid") is not True or early_replay.get("replay_valid") is not True
            or early_replay.get("processed_attempts") != len(early_capsule["attempts"])
            or early_replay.get("final_position") != early_capsule["final_position"]
            or early_replay.get("snapshot") != early["snapshot"]):
        raise RuntimeError("native CLI early causal prefix differs from actual browser Worker")
    early_snapshot_path = REPORT / "fresh-account-early-snapshot.json"
    early_snapshot_bytes = json.dumps(early["snapshot"], separators=(",", ":")).encode()
    if not 0 < len(early_snapshot_bytes) <= 8 << 20:
        raise RuntimeError("early browser snapshot exceeds native worker import bound")
    early_snapshot_path.write_bytes(early_snapshot_bytes)
    early_worker_log = run([str(witness), str(OUTPUT / "game-content-bundle-v2.json"),
                            str(early_capsule_path), str(early_snapshot_path), sha],
                           "native-worker-early-import", 120, 1 << 20)
    early_worker = json.loads(early_worker_log.read_text())
    if (early_worker.get("source_sha") != sha
            or early_worker.get("browser_frontier") != early_capsule["final_position"]
            or early_worker.get("native_frontier") != early_capsule["final_position"] + 1
            or early_worker.get("native_suffix_attempts") != 1
            or early_worker.get("full_snapshot_equal") is not True
            or early_worker.get("executable_sha256") != digest(witness)):
        raise RuntimeError("native worker did not preserve and continue the early browser causal prefix")
    summary["early_cross_entry"] = {
        "base_position": 0, "final_position": early_capsule["final_position"],
        "attempts": len(early_capsule["attempts"]),
        "capsule_bytes": len(early_capsule_bytes),
        "capsule_sha256": hashlib.sha256(early_capsule_bytes).hexdigest(),
        "snapshot_sha256": hashlib.sha256(json.dumps(early["snapshot"], sort_keys=True,
                                                 separators=(",", ":")).encode()).hexdigest(),
        "cli_sha256": digest(cli), "worker_sha256": digest(witness),
        "full_snapshot_equal": True, "native_suffix_attempts": 1,
    }
    summary["tests"] = {"passed": 4, "failed": 0, "skipped": 0, "ids": IDS + [WORKER_ID]}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "qualification": "same-SHA focused natural RTC startup, complete capsule replay, public pending retry and fresh-account Worker restore through source-qualified Town opening; not aggregate M9 qualification"}
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
        failure = str(error) + "\nBounded tail; complete logs remain remote.\n" + tail.decode("utf-8", errors="replace")
        (FULL / "failure.txt").write_text(failure)
        (COMPACT / "failure.txt").write_text(failure)
    finally:
        summary["logs"] = logs
        raw = json.dumps(summary, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        if len(raw) > 32768:
            raise RuntimeError("compact result exceeds32KiB")
        (COMPACT / "summary.json").write_bytes(raw)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
