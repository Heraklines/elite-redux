"""Remote-only strict evidence boundary for controlled current Worker saves."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil

PRODUCT_PATHS = ["src/rust-browser/routes/rust-current-storage-entry.ts",
                 "rust/crates/er-web/examples/m9e_v7_storage_fixtures.rs",
                 "scripts/build-kernel-m9e-storage-web.mjs",
                 "test/browser/rust-browser/m9e-v7-worker-storage.spec.ts"]
SOURCE_PATHS = ["src/rust-browser/contracts/browser-contracts-v2.ts", "src/rust-browser/routes/browser-effects-v2.ts",
                "src/rust-browser/worker/rust-wasm-loader.ts", "src/rust-browser/worker/current-rust-kernel-worker.ts",
                "src/rust-browser/host/current-rust-browser-host.ts", "src/rust-browser/routes/rust-current-worker-entry.ts",
                "src/rust-browser/adapters/current-storage-backend.ts", "src/rust-browser/adapters/current-storage-owner.ts",
                PRODUCT_PATHS[0], PRODUCT_PATHS[3], PRODUCT_PATHS[1], PRODUCT_PATHS[2],
                "rust/crates/er-kernel/src/game_kernel_v7.rs"]
TEST_IDS = ["current Worker stores and loads real GameSaveV2 bytes while presentation ownership remains independent",
            "current Worker reconciles an actual committed save after lost completion without repeating the write"]
KEYS = ["save-load", "uncertain"]
CAPABILITY = "CURRENT_WORKER_CONTROLLED_SAVE"
FIXTURE_KIND = "CONTROLLED_SAVE_CHECKPOINT"
PROOF_KEYS = ("worker_storage_assets", "worker_storage_tests")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def integer(value, low=0, high=(1 << 53) - 1):
    return type(value) is int and low <= value <= high


def js_bytes(value):
    # Match the authored browser canonical()/JSON.stringify oracle, including
    # JavaScript's integer-index enumeration and UTF-16 ordering of other keys.
    def canonical(item):
        if isinstance(item, dict):
            def order(key):
                if re.fullmatch(r"0|[1-9][0-9]*", key) and int(key) < (1 << 32) - 1:
                    return (0, int(key))
                return (1, key.encode("utf-16-be"))
            return {key: canonical(item[key]) for key in sorted(item, key=order)}
        if isinstance(item, list):
            return [canonical(child) for child in item]
        if item is None or isinstance(item, (str, bool)) or integer(item, -(1 << 53) + 1):
            return item
        raise RuntimeError("storage fixture contains unsupported browser JSON")
    return json.dumps(canonical(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def bounded_file(root, name, limit):
    path = root / name
    if (path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve())
            or not 0 < path.stat().st_size <= limit):
        raise RuntimeError("worker storage file is not bounded regular owned source/data")
    return path.read_bytes()


def source_binding(root, product_sha):
    hashes = {name: sha(bounded_file(root, name, 4 << 20)) for name in [*SOURCE_PATHS, "pnpm-lock.yaml"]}
    return {"source_sha": product_sha, "source_hashes": {name: hashes[name] for name in SOURCE_PATHS},
            "pnpm_lock_sha256": hashes["pnpm-lock.yaml"]}


def validate_binding(binding, product_sha):
    if (not isinstance(binding, dict) or set(binding) != {"source_sha", "source_hashes", "pnpm_lock_sha256"}
            or not isinstance(product_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", product_sha)
            or binding["source_sha"] != product_sha or not isinstance(binding["source_hashes"], dict)
            or set(binding["source_hashes"]) != set(SOURCE_PATHS)
            or not all(digest(item) for item in [*binding["source_hashes"].values(), binding["pnpm_lock_sha256"]])):
        raise RuntimeError("worker storage source binding disagrees")


def normalized_read(pending, save):
    expected = copy.deepcopy(pending)
    state = copy.deepcopy(save["state"])
    control = state["active_run"]["control"]
    live = pending["lifecycle"]["value"]
    revision = max(pending["material_ledger"]["next_authority_revision"], control["revision"] + 1,
                   *(item["event_id"] + 1 for item in pending["pending_presentations"]))
    instance = max(pending["next_menu_instance_id"], control["menu"]["instance_id"] + 1)
    platform = max(state["identities"]["next_platform_request_id"], live["identities"]["next_platform_request_id"])
    if not all(integer(value, 1) for value in (revision, instance, instance + 1, platform)):
        raise RuntimeError("worker storage READ normalization allocator overflows")
    control["revision"] = revision
    control["menu"]["instance_id"] = instance
    control["action_context"]["authority_revision"] = revision
    control["action_context"]["menu_instance"] = instance
    state["identities"]["next_platform_request_id"] = platform
    expected["lifecycle"] = {"kind": "ACTIVE", "value": state}
    expected["material_ledger"] = {"schema_version": 1, "next_authority_revision": revision, "records": []}
    expected["next_menu_instance_id"] = instance + 1
    expected.pop("private_battle_control", None)
    if expected["input_router"]["repeats"] or expected["scheduler"]["timers"]:
        raise RuntimeError("controlled Space fixture unexpectedly has repeat/timer owners")
    for field in ("pressed", "suppressed_printable_keys", "held_buttons", "locks", "repeats"):
        expected["input_router"][field] = []
    expected["pending_platform"] = []
    expected["storage_frontiers"] = [{"slot": "controlled-slot", "generation": save["generation"]}]
    expected["replay_sequence"] += 1
    return expected


def fixture_oracle(fixture, content_hash):
    if (not isinstance(fixture, dict) or set(fixture) != {"schema_version", "capability", "fixture_kind",
            "content_identity", "natural_reached", "write", "load", "rewrite"} or fixture["schema_version"] != 2
            or type(fixture["schema_version"]) is not int or fixture["capability"] != CAPABILITY
            or fixture["fixture_kind"] != FIXTURE_KIND
            or fixture["natural_reached"].get("lifecycle", {}).get("kind") != "ACTIVE"):
        raise RuntimeError("worker storage controlled Rust fixture identity disagrees")
    write, load, rewrite = fixture["write"], fixture["load"], fixture["rewrite"]
    for case, generation in ((write, 1), (load, 1), (rewrite, 2)):
        if set(case) != {"before", "pending", "callback", "settled", "continued", "request", "presentation"}:
            raise RuntimeError("worker storage Rust fixture case fields disagree")
        before, pending, callback, settled = [case[name] for name in ("before", "pending", "callback", "settled")]
        if (before["lifecycle"]["kind"] != "ACTIVE" or before["lifecycle"]["value"]["active_run"]["control"]["kind"] != "SAVE"
                or before["pending_platform"] or before["pending_presentations"]
                or len(pending["pending_platform"]) != 1 or len(pending["pending_presentations"]) != 1
                or pending["pending_platform"][0]["request_id"] != case["request"]["request_id"]
                or callback["pending_platform"] or callback["pending_presentations"] != pending["pending_presentations"]
                or pending["pending_presentations"][0]["event_id"] != case["presentation"]["event_id"]
                or callback["storage_frontiers"] != [{"slot": "controlled-slot", "generation": generation}]):
            raise RuntimeError("worker storage Rust pending/callback ownership disagrees")
        expected = copy.deepcopy(callback)
        expected["pending_presentations"] = []
        expected["replay_sequence"] += 1
        if expected != settled or settled["scheduler"]["timers"]:
            raise RuntimeError("worker storage actual presentation settlement changed unrelated state")
        expected["replay_sequence"] += 1
        if expected != case["continued"]:
            raise RuntimeError("worker storage actual continuation changed unrelated state")
    request = write["request"]
    if (set(request) != {"request_id", "kind", "slot", "generation", "bytes"} or request["kind"] != "WRITE"
            or request["slot"] != "controlled-slot" or not integer(request["generation"], 1, 1)
            or not integer(request["request_id"], 1) or not isinstance(request["bytes"], list)
            or not 0 < len(request["bytes"]) <= 4 << 20 or not all(integer(byte, 0, 255) for byte in request["bytes"])
            or load["request"] != {"request_id": load["pending"]["pending_platform"][0]["request_id"],
                                   "kind": "READ", "slot": "controlled-slot", "generation": None, "bytes": []}):
        raise RuntimeError("worker storage real request/byte fixture disagrees")
    payload = bytes(request["bytes"])
    save = json.loads(payload)
    if (save.get("schema_version") != 2 or save.get("generation") != 1
            or save.get("content_identity") != fixture["content_identity"]
            or load["callback"] != normalized_read(load["pending"], save)):
        raise RuntimeError("worker storage READ oracle changed exact saved semantics or normalized core ownership")
    if rewrite["before"] != load["continued"]:
        raise RuntimeError("worker storage post-load Write is not the exact live continuation")
    for case, generation in ((write, 1), (rewrite, 2)):
        request_image = case["request"]
        if (set(request_image) != {"request_id", "kind", "slot", "generation", "bytes"}
                or request_image["kind"] != "WRITE" or request_image["slot"] != "controlled-slot"
                or not integer(request_image["generation"], generation, generation)
                or not integer(request_image["request_id"], 1) or not isinstance(request_image["bytes"], list)
                or not 0 < len(request_image["bytes"]) <= 4 << 20
                or not all(integer(byte, 0, 255) for byte in request_image["bytes"])):
            raise RuntimeError("worker storage real Write request differs")
        actual_save = json.loads(bytes(request_image["bytes"]))
        saved_state = copy.deepcopy(case["before"]["lifecycle"]["value"])
        if request_image["request_id"] != saved_state["identities"]["next_platform_request_id"]:
            raise RuntimeError("worker storage Write did not allocate its actual request ID")
        saved_state["identities"]["next_platform_request_id"] += 1
        if (actual_save["schema_version"] != 2 or actual_save["generation"] != generation
                or actual_save["content_identity"] != fixture["content_identity"]
                or actual_save["state"] != saved_state):
            raise RuntimeError("worker storage real Write bytes do not preserve gameplay plus exact request allocation")
        expected = copy.deepcopy(case["pending"])
        expected["pending_platform"] = []
        expected["storage_frontiers"] = [{"slot": "controlled-slot", "generation": generation}]
        expected["replay_sequence"] += 1
        if expected != case["callback"]:
            raise RuntimeError("worker storage Written oracle changed unrelated core state")
    if (rewrite["request"]["request_id"] <= load["request"]["request_id"]
            or rewrite["presentation"]["event_id"] <= load["presentation"]["event_id"]):
        raise RuntimeError("worker storage post-load Write reused a retired request/presentation ID")
    result = {"request_id": request["request_id"], "presentation_id": write["presentation"]["event_id"],
              "payload_sha256": sha(payload), "payload_bytes": len(payload),
              "namespace_sha256": sha(js_bytes("m9e-controlled-save")),
              "pending_snapshot_sha256": sha(js_bytes(write["pending"])),
              "callback_snapshot_sha256": sha(js_bytes(write["callback"])),
              "load_snapshot_sha256": sha(js_bytes(load["callback"])), "receipts": {}}
    for key, session in zip(KEYS, ("same-pending-save", "same-pending-save-lost")):
        metadata = [1, "m9e-controlled-save", content_hash, session, request["request_id"], "WRITE", "controlled-slot", 1]
        result["receipts"][key] = sha(js_bytes(metadata) + b"\0" + payload)
    next_payload = bytes(rewrite["request"]["bytes"])
    metadata = [1, "m9e-controlled-save", content_hash, "same-pending-save", rewrite["request"]["request_id"], "WRITE", "controlled-slot", 2]
    result["rewrite"] = {"request_id": rewrite["request"]["request_id"], "presentation_id": rewrite["presentation"]["event_id"],
                         "generation": 2, "receipt": sha(js_bytes(metadata) + b"\0" + next_payload),
                         "payload_sha256": sha(next_payload), "payload_bytes": len(next_payload), "callbacks": 1,
                         "pending_snapshot_sha256": sha(js_bytes(rewrite["pending"])),
                         "callback_snapshot_sha256": sha(js_bytes(rewrite["callback"])),
                         "continued_snapshot_sha256": sha(js_bytes(rewrite["continued"]))}
    return result


def validate_oracle(oracle):
    fields = {"request_id", "presentation_id", "payload_sha256", "payload_bytes", "namespace_sha256",
              "pending_snapshot_sha256", "callback_snapshot_sha256", "load_snapshot_sha256", "receipts", "rewrite"}
    if (not isinstance(oracle, dict) or set(oracle) != fields or not integer(oracle["request_id"], 1)
            or not integer(oracle["presentation_id"], 1) or not integer(oracle["payload_bytes"], 1, 4 << 20)
            or not all(digest(oracle[key]) for key in fields - {"request_id", "presentation_id", "payload_bytes", "receipts", "rewrite"})
            or not isinstance(oracle["receipts"], dict) or set(oracle["receipts"]) != set(KEYS)
            or not all(digest(value) for value in oracle["receipts"].values())
            or oracle["namespace_sha256"] != sha(js_bytes("m9e-controlled-save"))):
        raise RuntimeError("worker storage reduced fixture oracle disagrees")
    rewrite = oracle["rewrite"]
    fields = {"request_id", "presentation_id", "generation", "receipt", "payload_sha256", "payload_bytes", "callbacks",
              "pending_snapshot_sha256", "callback_snapshot_sha256", "continued_snapshot_sha256"}
    if (not isinstance(rewrite, dict) or set(rewrite) != fields
            or not integer(rewrite["request_id"], oracle["request_id"] + 1)
            or not integer(rewrite["presentation_id"], oracle["presentation_id"] + 1)
            or not integer(rewrite["generation"], 2, 2) or not integer(rewrite["callbacks"], 1, 1)
            or not integer(rewrite["payload_bytes"], 1, 4 << 20)
            or not all(digest(rewrite[key]) for key in fields - {"request_id", "presentation_id", "generation", "payload_bytes", "callbacks"})):
        raise RuntimeError("worker storage post-load reduced oracle disagrees")


def validate_assets(evidence, binding, cohort):
    validate_binding(binding, binding.get("source_sha") if isinstance(binding, dict) else None)
    if not isinstance(evidence, dict) or set(evidence) != {"manifest_sha256", "manifest", "fixture_oracle"}:
        raise RuntimeError("worker storage asset evidence fields disagree")
    manifest = evidence["manifest"]
    fields = {"schema_version", "capability", "fixture_kind", "source_sha", "entry", "worker", "assets", "fixture",
              "cohort", "source_hashes", "pnpm_lock_sha256", "vite_version"}
    if (not isinstance(manifest, dict) or set(manifest) != fields or not integer(manifest["schema_version"], 2, 2)
            or manifest["capability"] != CAPABILITY or manifest["fixture_kind"] != FIXTURE_KIND
            or any(manifest[key] != binding[key] for key in ("source_sha", "source_hashes", "pnpm_lock_sha256"))
            or evidence["manifest_sha256"] != sha(js_bytes(manifest) + b"\n")
            or not isinstance(manifest["vite_version"], str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?", manifest["vite_version"])
            or manifest["cohort"] != {key: cohort.get(name, {}).get("sha256") for key, name in
                (("glue_sha256", "er_web.js"), ("wasm_sha256", "er_web_bg.wasm"), ("content_sha256", "game-content-bundle-v2.json"))}
            or not all(digest(value) for value in manifest["cohort"].values())):
        raise RuntimeError("worker storage manifest source/cohort/hash disagrees")
    assets = manifest["assets"]
    if (not isinstance(assets, dict) or not 2 <= len(assets) <= 8 or manifest["entry"] != "current-storage-entry.js"
            or not isinstance(manifest["worker"], str) or not re.fullmatch(r"current-storage-kernel-worker-[a-zA-Z0-9_-]+\.js", manifest["worker"])
            or set((manifest["entry"], manifest["worker"])) - set(assets)):
        raise RuntimeError("worker storage emitted inventory disagrees")
    total = 0
    for name, item in assets.items():
        role = "entry" if name == manifest["entry"] else "worker" if name == manifest["worker"] else "chunk"
        if (not re.fullmatch(r"current-storage-[a-zA-Z0-9_-]+\.js", name) or not isinstance(item, dict)
                or set(item) != {"bytes", "sha256", "role"} or item["role"] != role
                or not integer(item["bytes"], 1, 4 << 20) or not digest(item["sha256"])):
            raise RuntimeError("worker storage emitted asset fields disagree")
        total += item["bytes"]
    fixture = manifest["fixture"]
    if (total > 4 << 20 or not isinstance(fixture, dict) or set(fixture) != {"path", "bytes", "sha256"}
            or fixture["path"] != "m9e-v7-storage-fixtures.json" or not integer(fixture["bytes"], 1, 32 << 20)
            or not digest(fixture["sha256"])):
        raise RuntimeError("worker storage fixture or aggregate byte bound disagrees")
    validate_oracle(evidence["fixture_oracle"])


def validate_tests(tests, assets, binding, cohort):
    validate_assets(assets, binding, cohort)
    if (not isinstance(tests, dict) or set(tests) != {"expected", "passed", "failed", "skipped", "selected_test_ids", *KEYS}
            or any(not integer(tests[key], value, value) for key, value in (("expected", 2), ("passed", 2), ("failed", 0), ("skipped", 0)))
            or tests["selected_test_ids"] != TEST_IDS):
        raise RuntimeError("worker storage exact test identities/counts disagree")
    manifest, oracle = assets["manifest"], assets["fixture_oracle"]
    common = {"schema_version": 2, "capability": CAPABILITY, "fixture_kind": FIXTURE_KIND,
              "source_sha": binding["source_sha"], "manifest_sha256": assets["manifest_sha256"],
              "fixture_sha256": manifest["fixture"]["sha256"], "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"],
              "cohort": manifest["cohort"]}
    for index, key in enumerate(KEYS):
        item = tests[key]
        if (not isinstance(item, dict) or set(item) != {*common, "observed_worker_count", "evidence"}
                or any(item[name] != value for name, value in common.items()) or type(item["schema_version"]) is not int
                or not integer(item["observed_worker_count"], 2 + index, 2 + index) or len(js_bytes(item)) > 4096):
            raise RuntimeError("worker storage attachment topology/source differs")
        expected = {**{name: value for name, value in oracle.items() if name != "receipts"},
                    "lost_completion": bool(index), "writes": 2 - index, "write_callbacks": 1, "load_callbacks": 1 - index,
                    "generation": 1, "receipt": oracle["receipts"][key],
                    "presentation_preserved_until_completion": True, "rejected_callbacks_preserved_snapshot": True,
                    "disposed": True, "queue_empty": True, "pending_dispose_unconfirmed": bool(index),
                    "cancellation": None if not index else {"accepted_sequence": 1, "calls_after_cancel": 0, "dispose_acknowledged": False}}
        if index:
            expected["load_snapshot_sha256"] = None
            expected["rewrite"] = None
        measured = item["evidence"]
        if (not isinstance(measured, dict) or set(measured) != {*expected, "material_count"}
                or any(type(measured[name]) is not type(value) or js_bytes(measured[name]) != js_bytes(value) for name, value in expected.items())
                or not integer(measured["material_count"], 2 if index else 3, 3)
                or (index and (type(measured["cancellation"]["accepted_sequence"]) is not int
                              or type(measured["cancellation"]["calls_after_cancel"]) is not int))):
            raise RuntimeError("worker storage measured causal facts differ from actual Rust fixture")


def build_evidence(output, summary, root, full):
    binding = summary["plan"]["worker_storage_binding"]
    if binding != source_binding(root, summary["product_sha"]):
        raise RuntimeError("worker storage source changed before build validation")
    raw = bounded_file(output, "m9e-v7-storage-assets.json", 16 << 10)
    manifest = json.loads(raw)
    fixture_raw = bounded_file(output, "m9e-v7-storage-fixtures.json", 32 << 20)
    if manifest.get("fixture", {}).get("sha256") != sha(fixture_raw) or manifest["fixture"].get("bytes") != len(fixture_raw):
        raise RuntimeError("worker storage generated fixture hash differs")
    evidence = {"manifest_sha256": sha(raw), "manifest": manifest,
                "fixture_oracle": fixture_oracle(json.loads(fixture_raw), summary["browser_assets"]["assets"]["game-content-bundle-v2.json"]["sha256"])}
    validate_assets(evidence, binding, summary["browser_assets"]["assets"])
    if manifest["vite_version"] != json.loads(bounded_file(root, "node_modules/vite/package.json", 1 << 20))["version"]:
        raise RuntimeError("worker storage installed Vite version differs")
    for name, item in manifest["assets"].items():
        raw_asset = bounded_file(output, name, 4 << 20)
        if len(raw_asset) != item["bytes"] or sha(raw_asset) != item["sha256"]:
            raise RuntimeError("worker storage emitted bytes differ")
    if {path.name for path in output.glob("current-storage-*.js")} != set(manifest["assets"]):
        raise RuntimeError("worker storage contains unlisted emitted assets")
    shutil.copyfile(output / "m9e-v7-storage-assets.json", full / "m9e-v7-storage-assets.json")
    summary["worker_storage_assets"] = evidence


def test_evidence(report, assets, binding, cohort, root):
    specs = []
    def visit(suite):
        specs.extend(suite.get("specs", []))
        for child in suite.get("suites", []):
            visit(child)
    for suite in report.get("suites", []):
        visit(suite)
    if report.get("errors") or len(specs) != 2 or {item.get("title") for item in specs} != set(TEST_IDS):
        raise RuntimeError("worker storage Chromium report identities disagree")
    result = {"expected": 2, "passed": 2, "failed": 0, "skipped": 0, "selected_test_ids": TEST_IDS}
    for spec in specs:
        path = str(spec.get("file", "")).replace("\\", "/")
        if path not in (PRODUCT_PATHS[3], "m9e-v7-worker-storage.spec.ts") or spec.get("ok") is not True or len(spec.get("tests", [])) != 1:
            raise RuntimeError("worker storage Chromium source or attempt count differs")
        test = spec["tests"][0]
        runs = test.get("results", [])
        if (test.get("projectName") != "chromium" or test.get("expectedStatus") != "passed" or test.get("status") != "expected"
                or len(runs) != 1 or runs[0].get("status") != "passed" or not integer(runs[0].get("retry", 0), 0, 0)
                or runs[0].get("errors") or runs[0].get("error")):
            raise RuntimeError("worker storage Chromium retried/skipped/failed")
        key = KEYS[TEST_IDS.index(spec["title"])]
        attachments = [item for item in runs[0].get("attachments", []) if str(item.get("name", "")).startswith("m9e-current-worker-storage-")]
        if (len(attachments) != 1 or attachments[0].get("name") != "m9e-current-worker-storage-" + key
                or attachments[0].get("contentType") != "application/json"):
            raise RuntimeError("worker storage exact attachment missing or duplicated")
        item = attachments[0]
        if ("body" in item) == ("path" in item):
            raise RuntimeError("worker storage attachment requires exactly one body or file")
        if "body" in item:
            body = item["body"]
            if not isinstance(body, str) or len(body) > 5464:
                raise RuntimeError("worker storage attachment exceeds bound")
            raw = base64.b64decode(body, validate=True)
            if base64.b64encode(raw).decode() != body:
                raise RuntimeError("worker storage attachment base64 is noncanonical")
        else:
            path = Path(item["path"])
            path = path if path.is_absolute() else root / path
            raw = bounded_file(root / "test-results/rust-browser", path, 4096)
        if not 0 < len(raw) <= 4096:
            raise RuntimeError("worker storage attachment exceeds bound")
        result[key] = json.loads(raw)
    validate_tests(result, assets, binding, cohort)
    return result


def checks(root, full, run, summary, env):
    binding = summary["plan"]["worker_storage_binding"]
    if binding != source_binding(root, summary["product_sha"]):
        raise RuntimeError("worker storage source changed before browser witness")
    report_path = full / "worker-storage-results.json"
    run_env = {**env, "PLAYWRIGHT_JSON_OUTPUT_FILE": str(report_path)}
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
                  "--project=chromium", PRODUCT_PATHS[3], "--workers=1", "--reporter=line,json"],
                 "worker-storage-journey", root, run_env)
    summary["worker_storage_tests"] = test_evidence(json.loads(report_path.read_text()), summary["worker_storage_assets"],
        binding, summary["browser_assets"]["assets"], root)
    if binding != source_binding(root, summary["product_sha"]):
        raise RuntimeError("worker storage witness changed its source or lock")
    repeated = dict(summary)
    build_evidence(Path(env["M9E_V7_WEB_DIR"]), repeated, root, full)
    if repeated["worker_storage_assets"] != summary["worker_storage_assets"]:
        raise RuntimeError("worker storage witness changed fixture or emitted asset cohort")


def validate_platform(proof, native):
    plan = native["plan"]
    if not plan.get("requires_worker_storage"):
        if any(key in proof for key in PROOF_KEYS):
            raise RuntimeError("platform cannot claim unrequested Worker storage composition")
        return
    if not all(plan.get(key) for key in ("requires_browser", "requires_browser_worker", "requires_browser_rtc",
            "requires_current_storage", "requires_wasm", "requires_cli_executable")):
        raise RuntimeError("worker storage omitted prior platform prerequisites")
    binding = plan.get("worker_storage_binding")
    validate_binding(binding, native["identity"]["product_sha"])
    for other_name in ("browser_worker_binding", "browser_rtc_binding", "current_storage_binding"):
        other = plan[other_name]
        if (other["pnpm_lock_sha256"] != binding["pnpm_lock_sha256"] or any(binding["source_hashes"][name] != value
                for name, value in other["source_hashes"].items() if name in SOURCE_PATHS)):
            raise RuntimeError("worker storage prior dependency binding differs")
    validate_tests(proof.get("worker_storage_tests"), proof.get("worker_storage_assets"), binding, proof["browser_assets"]["assets"])
    names = set(proof["worker_storage_assets"]["manifest"]["assets"])
    for key in ("browser_worker_assets", "browser_rtc_assets"):
        if names & set(proof[key]["manifest"]["assets"]):
            raise RuntimeError("worker storage emitted namespace overlaps prior bundle")


def compact(compact, full_hash, encoded):
    for key in PROOF_KEYS:
        if len(encoded(compact)) <= 16000:
            break
        if key in compact:
            compact[key] = {"file": "phase-summary.json", "sha256": full_hash}
