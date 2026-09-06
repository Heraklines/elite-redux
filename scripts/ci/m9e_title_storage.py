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
    # GameMenuV2::new stores canonical ID/direction order, independently of
    # rendered row order and the explicitly selected New Game option.
    options.sort(key=lambda option: option["option_id"])
    directions = {"UP": 0, "DOWN": 1, "LEFT": 2, "RIGHT": 3}
    edges.sort(key=lambda edge: (edge["from"], directions[edge["direction"]], edge["to"]))
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
            or pending["pending_platform"] != [{"request_id": request["request_id"], "effect": {
                "kind": "STORAGE_WRITE", "request": request["request_id"], "slot": "controlled-slot",
                "generation": generation, "bytes": request["bytes"]}}]
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
    import copy
    natural_state = copy.deepcopy(fixture["natural_reached"]["lifecycle"]["value"])
    producer_state = fixture["write"]["before"]["lifecycle"]["value"]
    natural_state["active_run"]["control"] = producer_state["active_run"]["control"]
    if producer_state != natural_state:
        raise RuntimeError("Title controlled producer changed natural gameplay outside its declared Save control")
    payload, save = write_case_reference(fixture["write"], 1, fixture["content_identity"])
    rewrite_payload, _ = write_case_reference(fixture["rewrite"], 2, fixture["content_identity"])
    initial = fixture["initial"]
    owner = initial["lifecycle"]["value"]
    if (initial["lifecycle"]["kind"] != "BOOTSTRAP" or owner["stage"] != "TITLE" or owner["pressed_keys"] or owner["control"] != bootstrap_control("TITLE", 1, 1, 2)
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


PROOF_KEYS = ("title_storage_assets", "title_storage_oracle", "title_storage_tests")
ATTACHMENT = "m9e-current-worker-title-storage-retirement"


def validate_oracle(oracle):
    fields = {"cancelled_requests", "cancelled_snapshot_digest", "queued_not_started_request_id", "highest_retired_id",
              "producer_receipt", "producer_payload_sha256", "load_snapshot_sha256", "rewrite_request_id",
              "rewrite_generation", "rewrite_payload_bytes", "rewrite_receipt", "rewrite_payload_sha256",
              "rewrite_callback_sha256", "rewrite_continued_sha256", "presentation_id"}
    numeric = {"queued_not_started_request_id", "highest_retired_id", "rewrite_request_id", "rewrite_generation",
               "rewrite_payload_bytes", "presentation_id"}
    if (not isinstance(oracle, dict) or set(oracle) != fields
            or oracle["cancelled_requests"] != [*range(1, 22), 23, 25]
            or any(type(value) is not int for value in oracle["cancelled_requests"])
            or not all(digest(oracle[key]) for key in fields - numeric - {"cancelled_requests"})
            or any(not integer(oracle[key], value, value) for key, value in
                   (("queued_not_started_request_id", 2), ("highest_retired_id", 25), ("rewrite_request_id", 28), ("rewrite_generation", 2)))
            or not integer(oracle["rewrite_payload_bytes"], 1, 4 << 20)
            or not integer(oracle["presentation_id"], 1)):
        raise RuntimeError("Title retirement reduced fixture oracle differs")


def validate_tests(tests, assets, oracle, binding, cohort, toolchain):
    validate_assets(assets, binding, cohort, toolchain)
    validate_oracle(oracle)
    if (not isinstance(tests, dict)
            or set(tests) != {"expected", "passed", "failed", "skipped", "selected_test_ids", "retirement"}
            or any(not integer(tests[key], value, value) for key, value in
                   (("expected", 1), ("passed", 1), ("failed", 0), ("skipped", 0)))
            or tests["selected_test_ids"] != TEST_IDS):
        raise RuntimeError("Title retirement exact browser test identity/count differs")
    manifest = assets["manifest"]
    common = {"schema_version": 1, "capability": CAPABILITY, "fixture_kind": FIXTURE_KIND,
              "source_sha": binding["source_sha"], "manifest_sha256": assets["manifest_sha256"],
              "fixture_sha256": manifest["fixture"]["sha256"],
              "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"],
              "observed_worker_count": 2, "cohort": manifest["cohort"]}
    item = tests["retirement"]
    if (not isinstance(item, dict) or set(item) != {*common, "evidence"}
            or any(type(item[key]) is not type(value) or js_bytes(item[key]) != js_bytes(value) for key, value in common.items())
            or len(js_bytes(item)) > 4096):
        raise RuntimeError("Title retirement attachment source/topology/bound differs")
    expected = {key: value for key, value in oracle.items() if key != "cancelled_requests"}
    expected.update({"cancelled": 23, "list_cancels": 21, "read_cancels": 2, "queued_not_started_cancels": 1,
        "list_emissions": 24, "native_transaction_cancels": 21, "native_get_limit_per_transaction": 20000,
        "native_deadline_ms": 8000, "all_native_completions_after_cancel": True,
        "callback_queued_before_retirement": True, "lists": 23, "reads": 3, "writes": 2, "reader_callbacks": 5,
        "presentation_settlements": 1, "stale_callbacks_conserve_snapshot": True, "stale_rendered_cancel_not_sent": True,
        "disposed": True, "queue_empty": True})
    measured = item["evidence"]
    if (not isinstance(measured, dict) or set(measured) != {*expected, "native_gets", "correlated_sequences"}
            or any(type(measured[key]) is not type(value) or js_bytes(measured[key]) != js_bytes(value) for key, value in expected.items())
            or not integer(measured["native_gets"], 21, 21 * 20000)):
        raise RuntimeError("Title retirement measured facts differ from the independent fixture")
    sequences = measured["correlated_sequences"]
    if not isinstance(sequences, list) or len(sequences) != 23:
        raise RuntimeError("Title retirement sequence inventory differs")
    last = 0
    for request, row in zip(oracle["cancelled_requests"], sequences):
        if (not isinstance(row, list) or len(row) != 3 or not all(integer(value, 1) for value in row)
                or row[0] != request or row[1] <= last or row[2] != row[1] + 1):
            raise RuntimeError("Title retirement accepted Cancel/post-snapshot correlation differs")
        last = row[2]


def test_evidence(report, assets, oracle, binding, cohort, toolchain, root):
    """Accept exactly one unretried Chromium witness and one bounded attachment."""
    import base64
    import json
    from pathlib import Path
    specs = []
    def visit(suite):
        specs.extend(suite.get("specs", []))
        for child in suite.get("suites", []):
            visit(child)
    for suite in report.get("suites", []):
        visit(suite)
    if report.get("errors") or len(specs) != 1 or specs[0].get("title") != TEST_IDS[0]:
        raise RuntimeError("Title retirement Chromium report identities differ")
    spec = specs[0]
    if (str(spec.get("file", "")).replace("\\", "/") not in (PRODUCT_PATHS[5], "m9e-v7-worker-title-storage.spec.ts")
            or spec.get("ok") is not True or len(spec.get("tests", [])) != 1):
        raise RuntimeError("Title retirement Chromium source/attempt differs")
    test = spec["tests"][0]
    runs = test.get("results", [])
    if (test.get("projectName") != "chromium" or test.get("expectedStatus") != "passed" or test.get("status") != "expected"
            or len(runs) != 1 or runs[0].get("status") != "passed" or not integer(runs[0].get("retry", 0), 0, 0)
            or runs[0].get("errors") or runs[0].get("error")):
        raise RuntimeError("Title retirement Chromium retried/skipped/failed")
    attachments = [item for item in runs[0].get("attachments", []) if str(item.get("name", "")).startswith("m9e-current-worker-title-storage")]
    if (len(attachments) != 1 or attachments[0].get("name") != ATTACHMENT
            or attachments[0].get("contentType") != "application/json"):
        raise RuntimeError("Title retirement exact attachment missing/duplicated")
    item = attachments[0]
    if ("body" in item) == ("path" in item):
        raise RuntimeError("Title retirement attachment requires exactly one body or file")
    if "body" in item:
        body = item["body"]
        if not isinstance(body, str) or not 0 < len(body) <= 5464:
            raise RuntimeError("Title retirement attachment exceeds bound")
        try:
            raw = base64.b64decode(body, validate=True)
        except ValueError as error:
            raise RuntimeError("Title retirement attachment base64 is invalid") from error
        if base64.b64encode(raw).decode() != body:
            raise RuntimeError("Title retirement attachment base64 is noncanonical")
    else:
        path = Path(item["path"])
        path = path if path.is_absolute() else root / path
        raw = bounded_file(root / "test-results/rust-browser", path, 4096)
    if not 0 < len(raw) <= 4096:
        raise RuntimeError("Title retirement attachment exceeds bound")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise RuntimeError("Title retirement attachment repeats a JSON field")
            result[key] = value
        return result
    result = {"expected": 1, "passed": 1, "failed": 0, "skipped": 0, "selected_test_ids": list(TEST_IDS),
              "retirement": json.loads(raw, object_pairs_hook=unique)}
    validate_tests(result, assets, oracle, binding, cohort, toolchain)
    return result


def build_evidence(output, summary, root, full, toolchain):
    import json
    import shutil
    binding = summary["plan"]["title_storage_binding"]
    if binding != source_binding(root, summary["product_sha"]):
        raise RuntimeError("Title retirement source changed before build validation")
    assets, raw = bind_asset_files(output, binding, summary["browser_assets"]["assets"], toolchain)
    oracle = fixture_oracle(json.loads(raw), assets["manifest"]["cohort"]["content_sha256"])
    validate_oracle(oracle)
    if assets["manifest"]["vite_version"] != json.loads(bounded_file(root, "node_modules/vite/package.json", 1 << 20))["version"]:
        raise RuntimeError("Title retirement installed Vite version differs")
    shutil.copyfile(output / "m9e-v7-title-storage-assets.json", full / "m9e-v7-title-storage-assets.json")
    summary["title_storage_assets"] = assets
    summary["title_storage_oracle"] = oracle


def checks(root, full, run, summary, env, toolchain):
    import json
    from pathlib import Path
    binding = summary["plan"]["title_storage_binding"]
    if binding != source_binding(root, summary["product_sha"]):
        raise RuntimeError("Title retirement source changed before browser witness")
    report_path = full / "title-storage-results.json"
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
         "--project=chromium", PRODUCT_PATHS[5], "--workers=1", "--reporter=line,json"],
        "title-storage-journey", root, {**env, "PLAYWRIGHT_JSON_OUTPUT_FILE": str(report_path)})
    summary["title_storage_tests"] = test_evidence(json.loads(bounded_file(full, report_path, 1 << 20)),
        summary["title_storage_assets"], summary["title_storage_oracle"], binding, summary["browser_assets"]["assets"], toolchain, root)
    if binding != source_binding(root, summary["product_sha"]):
        raise RuntimeError("Title retirement witness changed source/lock")
    repeated = dict(summary)
    build_evidence(Path(env["M9E_V7_WEB_DIR"]), repeated, root, full, toolchain)
    if any(repeated[key] != summary[key] for key in PROOF_KEYS[:2]):
        raise RuntimeError("Title retirement witness changed emitted cohort/fixture")

def select_scope(config, changes, root):
    configured = config.get("current_title_retirement_focus", {})
    installed = any((root / path).is_file() for path in TRIGGER_PATHS)
    changed = any(path in PRODUCT_PATHS for path in changes)
    if configured:
        validate_policy(configured)
    elif installed or any(path in TRIGGER_PATHS for path in changes):
        raise RuntimeError("Title retirement installed product requires its exact policy")
    session = bool(configured) and changed and all(path in PRODUCT_PATHS for path in changes)
    return session, installed


def node_evidence(report):
    suites = report.get("testResults", [])
    assertions = [item for suite in suites for item in suite.get("assertionResults", [])]
    path = str(suites[0].get("name", "")).replace("\\", "/") if len(suites) == 1 else ""
    if (report.get("success") is not True or len(suites) != 1
            or any(not integer(report.get(key), count, count) for key, count in
                   (("numTotalTests", 11), ("numPassedTests", 11), ("numFailedTests", 0), ("numPendingTests", 0)))
            or (path != PRODUCT_PATHS[2] and not path.endswith("/" + PRODUCT_PATHS[2]))
            or len(assertions) != 11 or {item.get("fullName") for item in assertions} != set(NODE_IDS)
            or any(item.get("status") != "passed" or item.get("failureMessages") for item in assertions)):
        raise RuntimeError("Title retirement Node source identities/counts differ")
    result = {"expected": 11, "passed": 11, "failed": 0, "skipped": 0, "selected_test_ids": list(NODE_IDS)}
    validate_node(result)
    return result


def validate_platform(proof, native):
    plan = native["plan"]
    if not plan.get("requires_title_retirement"):
        if any(key in proof for key in PROOF_KEYS):
            raise RuntimeError("platform cannot claim unrequested Title retirement")
        return
    if not all(plan.get(key) for key in ("requires_title_storage", "requires_read_rebind", "requires_current_proposal",
            "requires_browser", "requires_browser_worker", "requires_browser_rtc", "requires_current_storage",
            "requires_worker_storage", "requires_wasm", "requires_cli_executable")):
        raise RuntimeError("Title retirement omitted prior native/platform prerequisites")
    binding = plan.get("title_storage_binding")
    validate_binding(binding, native["identity"]["product_sha"])
    if not digest(native["identity"]["files"].get("title_storage")):
        raise RuntimeError("Title retirement omitted its source-bound proof validator")
    for other_name in ("browser_worker_binding", "browser_rtc_binding", "current_storage_binding", "worker_storage_binding"):
        other = plan[other_name]
        if (other["pnpm_lock_sha256"] != binding["pnpm_lock_sha256"]
                or any(binding["source_hashes"][name] != value for name, value in other["source_hashes"].items() if name in SOURCE_PATHS)):
            raise RuntimeError("Title retirement prior dependency source binding differs")
    toolchain = re.match(r"rustc (1\.[0-9]+\.[0-9]+) ", native["identity"].get("toolchain", ""))
    if toolchain is None:
        raise RuntimeError("Title retirement native toolchain identity differs")
    validate_tests(proof.get("title_storage_tests"), proof.get("title_storage_assets"), proof.get("title_storage_oracle"),
                   binding, proof["browser_assets"]["assets"], toolchain[1])
    validate_node(proof.get("current_storage_node"))
    names = set(proof["title_storage_assets"]["manifest"]["assets"])
    for key in ("browser_worker_assets", "browser_rtc_assets", "worker_storage_assets"):
        if names & set(proof[key]["manifest"]["assets"]):
            raise RuntimeError("Title retirement emitted namespace overlaps prior bundle")


def compact(value, full_hash, encoded):
    for key in PROOF_KEYS:
        if len(encoded(value)) <= 16000:
            break
        if key in value:
            value[key] = {"file": "phase-summary.json", "sha256": full_hash}