"""Strict source, asset and owner-inventory boundary for current Title retirement.

This module does not by itself qualify a gameplay journey. The eventual platform
proof must additionally bind the independently checked Rust fixture and actual
Chromium cancellation/READ/Write evidence.
"""
import re

from m9e_worker_storage import bounded_file, digest, integer, js_bytes, sha

CAPABILITY = "CURRENT_WORKER_TITLE_STORAGE_RETIREMENT"
FIXTURE_KIND = "NATURAL_TITLE_CONTROLLED_SAVE_PRODUCER"
PRODUCT_PATHS = [
    "src/rust-browser/adapters/current-storage-owner.ts",
    "src/rust-browser/routes/rust-current-storage-entry.ts",
    "test/node/rust-browser/engineering/current-storage-owner.test.ts",
    "rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs",
    "scripts/build-kernel-m9e-title-storage-web.mjs",
    "test/browser/rust-browser/m9e-v7-worker-title-storage.spec.ts",
]
TRIGGER_PATHS = PRODUCT_PATHS[3:]
SOURCE_PATHS = [
    "src/rust-browser/contracts/browser-contracts-v2.ts",
    "src/rust-browser/routes/browser-effects-v2.ts",
    "src/rust-browser/worker/rust-wasm-loader.ts",
    "src/rust-browser/worker/current-rust-kernel-worker.ts",
    "src/rust-browser/host/current-rust-browser-host.ts",
    "src/rust-browser/routes/rust-current-worker-entry.ts",
    "src/rust-browser/adapters/current-storage-backend.ts",
    PRODUCT_PATHS[0], PRODUCT_PATHS[1], PRODUCT_PATHS[5], PRODUCT_PATHS[3], PRODUCT_PATHS[4],
    "rust/crates/er-kernel/src/game_kernel_v7.rs",
    "rust/crates/er-kernel/src/snapshot_v7.rs",
    "rust/crates/er-game/src/current_bootstrap_storage.rs",
    "rust/crates/er-game/src/m72_bootstrap.rs",
    "rust/crates/er-types/src/m72_bootstrap.rs",
    "rust/crates/er-web/src/contracts_v2.rs",
    "rust/crates/er-web/src/host_v2.rs",
    "rust/crates/er-env/src/current.rs", PRODUCT_PATHS[2],
]
TEST_IDS = ["natural Title retires more than sixteen actual LIST/READ owners before loading and raw generation-two Write"]
NODE_IDS = [
    "current storage owner freezes requests and separates durable callback acknowledgement",
    "current storage owner bounds admission and rejects unsupported or malformed images before IO",
    "current storage owner drains nested enqueue without rerunning durable writes",
    "current storage owner fences unknown callback acceptance and late disposed work",
    "current storage owner reconciles exact uncertain images and rejects changed receipts",
    "Title cancellation drains queued read-only ownership without IO and never reuses evicted IDs",
    "Title CANCELLING retains the sixteen-owner admission bound until running and queued work drains",
    "Title retirement suppresses a queued delivery guard and releases its retained result once",
    "Title retirement admits real abort classification but never reclaims an unclassified backend rejection",
    "Title cancellation rejects writes, unknown acceptance, invalid evidence and impossible accepted callback races",
    "Title backend deadlines and disposal never convert uncertain work into cancellation",
]


def policy():
    return {"paths": list(PRODUCT_PATHS), "trigger_paths": list(TRIGGER_PATHS),
            "test_ids": list(TEST_IDS), "node_ids": list(NODE_IDS)}


def validate_policy(value):
    if not isinstance(value, dict) or value != policy():
        raise RuntimeError("Title retirement policy identities disagree")


def source_binding(root, product_sha):
    hashes = {name: sha(bounded_file(root, name, 4 << 20)) for name in [*SOURCE_PATHS, "pnpm-lock.yaml"]}
    result = {"source_sha": product_sha, "source_hashes": {name: hashes[name] for name in SOURCE_PATHS},
              "pnpm_lock_sha256": hashes["pnpm-lock.yaml"]}
    validate_binding(result, product_sha)
    return result


def validate_binding(binding, product_sha):
    if (not isinstance(binding, dict) or set(binding) != {"source_sha", "source_hashes", "pnpm_lock_sha256"}
            or not isinstance(product_sha, str) or re.fullmatch(r"[0-9a-f]{40}", product_sha) is None
            or binding["source_sha"] != product_sha or not isinstance(binding["source_hashes"], dict)
            or set(binding["source_hashes"]) != set(SOURCE_PATHS)
            or not all(digest(value) for value in binding["source_hashes"].values())
            or not digest(binding["pnpm_lock_sha256"])):
        raise RuntimeError("Title retirement source binding disagrees")


def validate_node(evidence):
    if (not isinstance(evidence, dict)
            or set(evidence) != {"expected", "passed", "failed", "skipped", "selected_test_ids"}
            or any(not integer(evidence[key], value, value) for key, value in
                   (("expected", 11), ("passed", 11), ("failed", 0), ("skipped", 0)))
            or evidence["selected_test_ids"] != NODE_IDS):
        raise RuntimeError("Title retirement exact eleven owner tests disagree")


def validate_assets(evidence, binding, cohort, toolchain):
    validate_binding(binding, binding.get("source_sha") if isinstance(binding, dict) else None)
    if (not isinstance(evidence, dict) or set(evidence) != {"manifest_sha256", "manifest"}
            or not isinstance(toolchain, str) or re.fullmatch(r"1\.[0-9]+\.[0-9]+", toolchain) is None):
        raise RuntimeError("Title retirement asset envelope or toolchain disagrees")
    manifest = evidence["manifest"]
    fields = {"schema_version", "capability", "fixture_kind", "source_sha", "entry", "worker", "assets", "fixture",
              "cohort", "source_hashes", "rustup_toolchain", "pnpm_lock_sha256", "vite_version"}
    expected_cohort = {key: cohort.get(name, {}).get("sha256") for key, name in
        (("glue_sha256", "er_web.js"), ("wasm_sha256", "er_web_bg.wasm"), ("content_sha256", "game-content-bundle-v2.json"))}
    if (not isinstance(manifest, dict) or set(manifest) != fields
            or not integer(manifest["schema_version"], 1, 1)
            or manifest["capability"] != CAPABILITY or manifest["fixture_kind"] != FIXTURE_KIND
            or any(manifest[key] != binding[key] for key in ("source_sha", "source_hashes", "pnpm_lock_sha256"))
            or manifest["rustup_toolchain"] != toolchain
            or manifest["cohort"] != expected_cohort or not all(digest(value) for value in expected_cohort.values())
            or not isinstance(manifest["vite_version"], str)
            or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?", manifest["vite_version"]) is None
            or len(js_bytes(manifest) + b"\n") > 16 << 10
            or evidence["manifest_sha256"] != sha(js_bytes(manifest) + b"\n")):
        raise RuntimeError("Title retirement manifest source/cohort/hash disagrees")
    assets = manifest["assets"]
    if (not isinstance(assets, dict) or not 2 <= len(assets) <= 8
            or manifest["entry"] != "current-title-storage-entry.js"
            or not isinstance(manifest["worker"], str)
            or re.fullmatch(r"current-title-storage-kernel-worker-[a-zA-Z0-9_-]+\.js", manifest["worker"]) is None
            or set((manifest["entry"], manifest["worker"])) - set(assets)):
        raise RuntimeError("Title retirement emitted bundle inventory disagrees")
    total = 0
    for name, item in assets.items():
        role = "entry" if name == manifest["entry"] else "worker" if name == manifest["worker"] else "chunk"
        if (not isinstance(name, str) or re.fullmatch(r"current-title-storage-[a-zA-Z0-9_-]+\.js", name) is None
                or not isinstance(item, dict) or set(item) != {"bytes", "sha256", "role"} or item["role"] != role
                or not integer(item["bytes"], 1, 4 << 20) or not digest(item["sha256"])):
            raise RuntimeError("Title retirement emitted asset fields disagree")
        total += item["bytes"]
    fixture = manifest["fixture"]
    if (total > 4 << 20 or not isinstance(fixture, dict) or set(fixture) != {"path", "bytes", "sha256"}
            or fixture["path"] != "m9e-v7-title-storage-fixtures.json"
            or not integer(fixture["bytes"], 1, 32 << 20) or not digest(fixture["sha256"])):
        raise RuntimeError("Title retirement fixture or bundle aggregate exceeds bound")


def bind_asset_files(output, binding, cohort, toolchain):
    """Check exact emitted bytes; caller must independently validate fixture semantics."""
    import json
    raw = bounded_file(output, "m9e-v7-title-storage-assets.json", 16 << 10)
    manifest = json.loads(raw)
    evidence = {"manifest_sha256": sha(raw), "manifest": manifest}
    validate_assets(evidence, binding, cohort, toolchain)
    fixture = manifest["fixture"]
    fixture_raw = bounded_file(output, fixture["path"], 32 << 20)
    if len(fixture_raw) != fixture["bytes"] or sha(fixture_raw) != fixture["sha256"]:
        raise RuntimeError("Title retirement generated fixture bytes differ")
    if {path.name for path in output.glob("current-title-storage-*.js")} != set(manifest["assets"]):
        raise RuntimeError("Title retirement has unlisted or missing emitted assets")
    for name, item in manifest["assets"].items():
        emitted = bounded_file(output, name, 4 << 20)
        if len(emitted) != item["bytes"] or sha(emitted) != item["sha256"]:
            raise RuntimeError("Title retirement emitted asset bytes differ")
    return evidence, fixture_raw


def normalized_title_read(pending, save):
    """Independent exact saved-state normalization at the Title -> Active edge."""
    import copy
    if (pending["lifecycle"]["kind"] != "BOOTSTRAP" or save["schema_version"] != 2
            or save["generation"] != 1):
        raise RuntimeError("Title READ requires its current saved-state boundary")
    owner = pending["lifecycle"]["value"]
    storage = owner["current_storage"]
    owned = storage["pending"]
    if (owned is None or owned["kind"] != {"kind": "READ", "value": {"slot": "controlled-slot"}}
            or len(pending["pending_platform"]) != 1
            or pending["pending_platform"][0]["request_id"] != owned["request_id"]):
        raise RuntimeError("Title READ lacks its exact live owner")
    expected = copy.deepcopy(pending)
    state = copy.deepcopy(save["state"])
    control = state["active_run"]["control"]
    revision = max(owner["control"]["revision"], control["revision"]) + 1
    instance = max(pending["next_menu_instance_id"], control["menu"]["instance_id"] + 1)
    platform = max(state["identities"]["next_platform_request_id"], storage["next_platform_request_id"])
    replay = pending["replay_sequence"] + 1
    if not all(integer(value, 1) for value in (revision, instance, instance + 1, platform, replay)):
        raise RuntimeError("Title READ normalization allocator overflows")
    state["identities"]["next_platform_request_id"] = platform
    control["revision"] = revision
    control["menu"]["instance_id"] = instance
    control["action_context"]["authority_revision"] = revision
    control["action_context"]["menu_instance"] = instance
    expected["lifecycle"] = {"kind": "ACTIVE", "value": state}
    expected["material_ledger"] = {"schema_version": 1, "next_authority_revision": revision, "records": []}
    expected["next_menu_instance_id"] = instance + 1
    expected["pending_platform"] = []
    expected["storage_frontiers"] = [{"slot": "controlled-slot", "generation": 1}]
    expected["replay_sequence"] = replay
    return expected


def normalized_title_cancel(pending, initial):
    """Full released Cancel reference: one accepted KeyDown, then one KeyUp."""
    import copy
    if pending["lifecycle"]["kind"] != "BOOTSTRAP" or initial["lifecycle"]["kind"] != "BOOTSTRAP":
        raise RuntimeError("Title Cancel is not a bootstrap boundary")
    before = pending["lifecycle"]["value"]
    template = initial["lifecycle"]["value"]
    owned = before["current_storage"]["pending"]
    if (template["stage"] != "TITLE" or template["control"]["kind"] != "TITLE"
            or template["pressed_keys"] or before["pressed_keys"] or owned is None
            or owned["kind"]["kind"] not in ("LIST", "READ")
            or len(pending["pending_platform"]) != 1
            or pending["pending_platform"][0]["request_id"] != owned["request_id"]
            or [row["option_id"] for row in template["control"]["menu"]["options"]]
                != ["bootstrap/title/new-game", "bootstrap/title/existing-saves"]):
        raise RuntimeError("Title Cancel has no exact released owner/template")
    revision = before["control"]["revision"] + 1
    instance = before["menu_instance_high_water"] + 1
    replay = pending["replay_sequence"] + 2
    if not all(integer(value, 1) for value in (revision, instance, instance + 1, replay)):
        raise RuntimeError("Title Cancel normalization allocator overflows")
    owner = copy.deepcopy(template)
    owner["current_storage"].update({"pending": None, "slots": [], "missing_slot": None,
        "next_platform_request_id": before["current_storage"]["next_platform_request_id"]})
    owner["menu_instance_high_water"] = instance
    control = owner["control"]
    control["revision"] = revision
    control["menu"]["instance_id"] = instance
    control["menu"]["control_id"] = f"bootstrap/title/{revision}"
    control["menu"]["selected_option_id"] = "bootstrap/title/new-game"
    control["action_context"].update({"authority_revision": revision, "menu_instance": instance,
                                    "operation_id": f"bootstrap/title/{revision}"})
    expected = copy.deepcopy(pending)
    expected["lifecycle"] = {"kind": "BOOTSTRAP", "value": owner}
    expected["next_menu_instance_id"] = instance + 1
    expected["pending_platform"] = []
    expected["replay_sequence"] = replay
    return expected
