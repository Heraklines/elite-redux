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
SPEC = "test/browser/rust-browser/m9e-v7-coop-startup.spec.ts"
IDS = [f"natural cooperative Title through two Workers and RTC {seat} ready first" for seat in ("host", "guest")]
PUBLIC_RETRY_ID = "owned natural co-op public retry recovers a pending proposal after disconnected snapshot restore through six Workers"
IDS.append(PUBLIC_RETRY_ID)
SOURCES = [EXAMPLE, SPEC, "scripts/ci/m9e_coop_rtc_diagnostic.py", ".github/workflows/m9e-coop-rtc-focused.yml",
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
    run(["cargo", "clippy", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-web",
         "--example", "m9e_v7_coop_startup", "--no-deps", "--", "-D", "warnings"], "clippy")
    run(["pnpm", "install", "--frozen-lockfile"], "dependencies")
    run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "ESNext", "--module", "ESNext",
         "--moduleResolution", "bundler", "--lib", "ESNext,DOM", "--types", "node,vite/client",
         "src/rust-browser/routes/rust-current-rtc-entry.ts", SPEC], "typecheck", 120)
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
    summary["tests"] = {"passed": 3, "failed": 0, "skipped": 0, "ids": IDS}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "qualification": "focused natural RTC startup, complete capsule replay and public pending retry after disconnected restore in fresh Workers; not integration or M9 qualification"}
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
        raw = json.dumps(summary, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        if len(raw) > 32768:
            raise RuntimeError("compact result exceeds32KiB")
        (COMPACT / "summary.json").write_bytes(raw)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
