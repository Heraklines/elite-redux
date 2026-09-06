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


def bootstrap_control(stage, owner, revision, instance):
    """Reference for the three exact opt-in storage menus in this fixture."""
    if not all(integer(value, 1) for value in (owner, revision, instance)):
        raise RuntimeError("Title reference control allocator is invalid")
    if stage == "TITLE":
        rows = [("bootstrap/title/new-game", {"kind": "OPEN_NEW_GAME"}),
                ("bootstrap/title/existing-saves", {"kind": "OPEN_EXISTING_SAVES"})]
        kind, cancel = "TITLE", {"kind": "DISABLED"}
    elif stage in ("EXISTING_SAVE_LISTING", "EXISTING_SAVE_LOADING", "EXISTING_SAVE_SELECT"):
        rows = [] if stage != "EXISTING_SAVE_SELECT" else [
            ("bootstrap/existing/0000", {"kind": "SELECT_EXISTING_SAVE", "value": "controlled-slot"})]
        rows.append(("bootstrap/existing/cancel", {"kind": "CANCEL"}))
        kind, cancel = "SAVE", {"kind": "BACK", "action": {"kind": "BOOTSTRAP", "action": {"kind": "CANCEL"}}}
    else:
        raise RuntimeError("Title reference control stage is unsupported")
    identity = f"bootstrap/{stage.replace('_', '').lower()}/{revision}"
    options = [{"option_id": name, "enabled": True, "visible": True,
                "action": {"kind": "BOOTSTRAP", "action": action},
                "layout": {"option_id": name, "row": index, "column": 0, "page": 0}}
               for index, (name, action) in enumerate(rows)]
    edges = []
    for left, right in zip(rows, rows[1:]):
        edges.extend([{"from": left[0], "direction": "DOWN", "to": right[0]},
                      {"from": right[0], "direction": "UP", "to": left[0]}])
    return {"schema_version": 2, "revision": revision, "kind": kind, "owner_seat": owner, "actionable": True,
            "action_context": {"operation_id": identity, "authority_seat": owner,
                               "authority_revision": revision, "menu_instance": instance},
            "menu": {"instance_id": instance, "owner_seat": owner, "control_id": identity,
                     "selected_option_id": rows[0][0], "options": options, "navigation": edges, "cancel": cancel}}


def title_request_reference(before, kind):
    """Reference for one raw Space down/up from Title or the returned inventory."""
    import copy
    owner = before["lifecycle"]["value"]
    storage = owner["current_storage"]
    expected_stage = "TITLE" if kind == "LIST" else "EXISTING_SAVE_SELECT"
    if (before["lifecycle"]["kind"] != "BOOTSTRAP" or kind not in ("LIST", "READ")
            or owner["stage"] != expected_stage or owner["pressed_keys"] or storage["pending"] is not None
            or before["pending_platform"] or (kind == "READ" and storage["slots"] != ["controlled-slot"])):
        raise RuntimeError("Title request does not start at its exact released control")
    request = storage["next_platform_request_id"]
    revision, instance = owner["control"]["revision"] + 1, owner["menu_instance_high_water"] + 1
    if not all(integer(value, 1) for value in (request, request + 1, revision, instance, instance + 1, before["replay_sequence"] + 2)):
        raise RuntimeError("Title request reference allocator overflows")
    expected = copy.deepcopy(before)
    target = expected["lifecycle"]["value"]
    stage = "EXISTING_SAVE_LISTING" if kind == "LIST" else "EXISTING_SAVE_LOADING"
    target["stage"] = stage
    target["control"] = bootstrap_control(stage, storage["owner_seat"], revision, instance)
    target["menu_instance_high_water"] = instance
    target["current_storage"].update({"next_platform_request_id": request + 1, "missing_slot": None,
        "pending": {"request_id": request, "kind": {"kind": "LIST"} if kind == "LIST" else
                    {"kind": "READ", "value": {"slot": "controlled-slot"}},
                    "source_menu": owner["menu_instance_high_water"], "source_revision": owner["control"]["revision"],
                    "waiting_menu": instance, "waiting_revision": revision}})
    effect = {"kind": "STORAGE_LIST", "request": request} if kind == "LIST" else {
        "kind": "STORAGE_READ", "request": request, "slot": "controlled-slot"}
    expected["pending_platform"] = [{"request_id": request, "effect": effect}]
    expected["next_menu_instance_id"] = instance + 1
    expected["replay_sequence"] += 2
    return expected


def title_list_reference(before, listed):
    """Check natural navigation, actual LIST allocation and exact pending state."""
    import copy
    if set(listed) != {"before", "selected", "pending", "request_id"} or listed["before"] != before:
        raise RuntimeError("Title LIST fixture continuity differs")
    selected = copy.deepcopy(before)
    owner = selected["lifecycle"]["value"]
    if owner["control"]["menu"]["selected_option_id"] != "bootstrap/title/new-game":
        raise RuntimeError("Title LIST navigation does not start at New Game")
    owner["control"]["menu"]["selected_option_id"] = "bootstrap/title/existing-saves"
    selected["replay_sequence"] += 2
    pending = title_request_reference(selected, "LIST")
    if (listed["selected"] != selected or listed["pending"] != pending
            or listed["request_id"] != pending["pending_platform"][0]["request_id"]):
        raise RuntimeError("Title LIST raw input or owned request reference differs")
    return pending


def title_slots_reference(pending):
    import copy
    owner = pending["lifecycle"]["value"]
    if owner["current_storage"]["pending"]["kind"] != {"kind": "LIST"}:
        raise RuntimeError("Title slots reference does not own LIST")
    expected = copy.deepcopy(pending)
    target = expected["lifecycle"]["value"]
    revision, instance = owner["control"]["revision"] + 1, owner["menu_instance_high_water"] + 1
    target["stage"] = "EXISTING_SAVE_SELECT"
    target["control"] = bootstrap_control(target["stage"], owner["current_storage"]["owner_seat"], revision, instance)
    target["menu_instance_high_water"] = instance
    target["current_storage"].update({"pending": None, "slots": ["controlled-slot"], "missing_slot": None})
    expected["pending_platform"] = []
    expected["next_menu_instance_id"] = instance + 1
    expected["replay_sequence"] += 1
    if not all(integer(value, 1) for value in (instance + 1, expected["replay_sequence"])):
        raise RuntimeError("Title slots reference allocator overflows")
    return expected


def write_case_reference(case, generation, content_identity):
    """Check actual serialized GameSaveV2 and each owner-only callback transition."""
    import copy
    from m9e_current_proposal import canonical, parse
    if set(case) != {"before", "pending", "callback", "settled", "continued", "request", "presentation"}:
        raise RuntimeError("Title producer/rewrite fixture fields differ")
    request = case["request"]
    if (set(request) != {"request_id", "kind", "slot", "generation", "bytes"}
            or request["kind"] != "WRITE" or request["slot"] != "controlled-slot"
            or not integer(request["generation"], generation, generation) or not integer(request["request_id"], 1)
            or not isinstance(request["bytes"], list) or not 0 < len(request["bytes"]) <= 4 << 20
            or not all(integer(value, 0, 255) for value in request["bytes"])):
        raise RuntimeError("Title actual Write bytes/identity differ")
    payload = bytes(request["bytes"])
    save = parse(payload, 4 << 20)
    if (not isinstance(save, dict) or set(save) != {"schema_version", "content_identity", "generation", "state", "checksum"}
            or save["checksum"] != "sha256-v1:" + sha(canonical({key: value for key, value in save.items() if key != "checksum"}))):
        raise RuntimeError("Title actual GameSaveV2 checksum differs")
    before, pending, callback = case["before"], case["pending"], case["callback"]
    state = copy.deepcopy(before["lifecycle"]["value"])
    if before["lifecycle"]["kind"] != "ACTIVE" or state["active_run"]["control"]["kind"] != "SAVE":
        raise RuntimeError("Title Write does not execute the saved active control")
    if state["identities"]["next_platform_request_id"] != request["request_id"]:
        raise RuntimeError("Title Write reused its allocator frontier")
    state["identities"]["next_platform_request_id"] += 1
    if (not integer(save["schema_version"], 2, 2) or not integer(save["generation"], generation, generation)
            or save["state"].get("content_identity") != content_identity
            or save["content_identity"] != content_identity or save["state"] != state
            or before["pending_platform"] or before["pending_presentations"]
            or len(pending["pending_platform"]) != 1
            or pending["pending_platform"][0]["request_id"] != request["request_id"]
            or pending["pending_presentations"] != [case["presentation"]]
            or case["presentation"]["semantic"] != {"kind": "CUE", "value": "SAVE"}
            or case["presentation"]["event_id"] != before["material_ledger"]["next_authority_revision"]):
        raise RuntimeError("Title actual Write changed saved gameplay or effect ownership")
    expected = copy.deepcopy(pending)
    expected["pending_platform"] = []
    expected["storage_frontiers"] = [{"slot": "controlled-slot", "generation": generation}]
    expected["replay_sequence"] += 1
    if callback != expected:
        raise RuntimeError("Title Written callback changed unrelated core fields")
    expected["pending_presentations"] = []
    expected["replay_sequence"] += 1
    if case["settled"] != expected or expected["scheduler"]["timers"]:
        raise RuntimeError("Title presentation settlement changed unrelated fields")
    expected["replay_sequence"] += 1
    if case["continued"] != expected:
        raise RuntimeError("Title Write continuation changed unrelated fields")
    return payload, save


def fixture_oracle(fixture, content_hash):
    """Independent complete 23-cancellation chain and saved-game continuation."""
    if (not isinstance(fixture, dict) or set(fixture) != {"schema_version", "capability", "fixture_kind", "content_identity",
            "natural_reached", "write", "initial", "cycles", "read_cancels", "load", "rewrite"}
            or not integer(fixture["schema_version"], 1, 1) or fixture["capability"] != CAPABILITY
            or fixture["fixture_kind"] != FIXTURE_KIND or not digest(content_hash)
            or fixture["natural_reached"]["lifecycle"]["kind"] != "ACTIVE"
            or fixture["natural_reached"]["lifecycle"]["value"]["active_run"]["control"]["kind"] != "BATTLE_COMMAND"
            or len(fixture["cycles"]) != 21 or len(fixture["read_cancels"]) != 2):
        raise RuntimeError("Title fixture identity/topology differs")
    payload, save = write_case_reference(fixture["write"], 1, fixture["content_identity"])
    rewrite_payload, _ = write_case_reference(fixture["rewrite"], 2, fixture["content_identity"])
    initial = fixture["initial"]
    owner = initial["lifecycle"]["value"]
    if (owner["stage"] != "TITLE" or owner["pressed_keys"] or owner["control"] != bootstrap_control("TITLE", 1, 1, 1)
            or owner["current_storage"] != {"owner_seat": 1, "pending": None, "next_platform_request_id": 1, "slots": [], "missing_slot": None}
            or owner["catalog"]["save_slots"] != ["new-run-destination"]
            or initial["pending_platform"] or initial["pending_presentations"]):
        raise RuntimeError("Title fixture does not begin at the exact opt-in natural menu")
    previous = initial
    cancelled = []
    for index, cycle in enumerate(fixture["cycles"]):
        if set(cycle) != {"mode", "before", "selected", "pending", "request_id", "cancelled"} or cycle["mode"] != (
                "QUEUED_NOT_STARTED" if index == 1 else "ACTIVE_TRANSACTION"):
            raise RuntimeError("Title cancellation mode inventory differs")
        listing = {name: cycle[name] for name in ("before", "selected", "pending", "request_id")}
        pending = title_list_reference(previous, listing)
        expected = normalized_title_cancel(pending, initial)
        if cycle["cancelled"] != expected:
            raise RuntimeError("Title LIST Cancel changed a field outside exact released normalization")
        cancelled.append({"request": cycle["request_id"], "kind": "LIST", "snapshot": sha(js_bytes(expected))})
        previous = expected
    for index, row in enumerate([*fixture["read_cancels"], fixture["load"]]):
        fields = {"listing", "selected", "pending", "request_id", "loaded"} if index == 2 else {
            "mode", "listing", "selected", "pending", "request_id", "cancelled"}
        if set(row) != fields or (index < 2 and row["mode"] != ("ACTIVE_TRANSACTION" if index == 0 else "CALLBACK_READY")):
            raise RuntimeError("Title READ mode/fixture inventory differs")
        pending_list = title_list_reference(previous, row["listing"])
        selected = title_slots_reference(pending_list)
        pending = title_request_reference(selected, "READ")
        if (row["selected"] != selected or row["pending"] != pending
                or row["request_id"] != pending["pending_platform"][0]["request_id"]):
            raise RuntimeError("Title actual inventory selection/READ owner differs")
        if index < 2:
            expected = normalized_title_cancel(pending, initial)
            if row["cancelled"] != expected:
                raise RuntimeError("Title READ Cancel changed unrelated core fields")
            cancelled.append({"request": row["request_id"], "kind": "READ", "snapshot": sha(js_bytes(expected))})
            previous = expected
        else:
            loaded = normalized_title_read(pending, save)
            if (row["loaded"] != loaded or fixture["rewrite"]["before"] != loaded
                    or save["state"]["identities"]["next_platform_request_id"] >= pending["lifecycle"]["value"]["current_storage"]["next_platform_request_id"]):
                raise RuntimeError("Title READ changed saved semantics or lost the live allocator floor")
    rewrite = fixture["rewrite"]
    if rewrite["request"]["request_id"] <= fixture["load"]["request_id"]:
        raise RuntimeError("Title raw second Write reused a retired request ID")
    receipts = []
    for case, session, generation, raw in ((fixture["write"], "title-controlled-producer", 1, payload),
                                         (rewrite, "natural-title-reader", 2, rewrite_payload)):
        metadata = [1, "m9e-title-retirement", content_hash, session, case["request"]["request_id"], "WRITE", "controlled-slot", generation]
        receipts.append(sha(js_bytes(metadata) + b"\0" + raw))
    return {"cancelled_requests": [row["request"] for row in cancelled],
            "cancelled_snapshot_digest": sha(js_bytes(cancelled)), "queued_not_started_request_id": fixture["cycles"][1]["request_id"],
            "highest_retired_id": cancelled[-1]["request"], "producer_receipt": receipts[0], "producer_payload_sha256": sha(payload),
            "load_snapshot_sha256": sha(js_bytes(fixture["load"]["loaded"])), "rewrite_request_id": rewrite["request"]["request_id"],
            "rewrite_generation": 2, "rewrite_payload_bytes": len(rewrite_payload), "rewrite_receipt": receipts[1],
            "rewrite_payload_sha256": sha(rewrite_payload), "rewrite_callback_sha256": sha(js_bytes(rewrite["callback"])),
            "rewrite_continued_sha256": sha(js_bytes(rewrite["continued"])), "presentation_id": rewrite["presentation"]["event_id"]}
