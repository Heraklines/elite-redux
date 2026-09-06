"""Same-run native/platform handoff; only aggregate can qualify a candidate.

The workflow uploads single-file artifacts from bounded producer directories:
native-a.json/native-b.json (each <=64 KiB) and optionally er-cli (<=128 MiB).
Native wire proofs index repeated required IDs and target pairs into their complete inventories;
readers reconstruct the exact proof before its existing semantic validation.
Consumers never receive worker/test binaries or a target tree. No archive
supplied by a manifest is opened.
"""

import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import zlib


MANIFEST_LIMIT = 64 * 1024
# Wire bytes and decompressed ID bytes retain their independent 64/128 KiB caps.
# The complete proof also repeats required IDs, target pairs and plan metadata.
NATIVE_PROOF_LIMIT = 192 * 1024
NATIVE_ID_ENCODING = "native-inventory-indices-v1"
NATIVE_COMPRESSED_ID_ENCODING = "native-inventory-zlib-indices-v2"
CLI_LIMIT = 128 * 1024 * 1024
IDENTITY_FILES = {
    "harness": "scripts/ci/m9e_feedback.py",
    "phases": "scripts/ci/m9e_phases.py",
    "owner_helper": "scripts/ci/m9e_current_proposal.py",
    "selftests": "scripts/ci/test_m9e_feedback.py",
    "config": "scripts/ci/m9e-targets.json",
    "worker_storage": "scripts/ci/m9e_worker_storage.py",
    "title_storage": "scripts/ci/m9e_title_storage.py",
    "workflow": ".github/workflows/m9e-focused-feedback.yml",
    "lock": "rust/Cargo.lock",
    "content": "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json",
}
WASM_IDS = {"wasm_replays_v7_raw_inputs_eventwise", "wasm_replays_v7_held_timers_eventwise"}
BROWSER_IDS = {"natural V7 browser startup reaches the real battle command",
               "two V7 browser hosts wait for both humans and converge one turn"}
WORKER_SOURCE_PATHS = [
    "src/rust-browser/contracts/browser-contracts-v2.ts",
    "src/rust-browser/worker/rust-wasm-loader.ts",
    "src/rust-browser/worker/current-rust-kernel-worker.ts",
    "src/rust-browser/host/current-rust-browser-host.ts",
    "src/rust-browser/routes/rust-current-worker-entry.ts",
    "test/browser/rust-browser/m9e-v7-worker.spec.ts",
    "test/node/rust-browser/engineering/current-worker-codec.test.ts",
    "scripts/build-kernel-m9e-v7-web.mjs",
]
WORKER_TEST_IDS = ["current V7 Worker executes natural input and presentation settlement",
                   "current V7 Worker rejects wrong ABI and settles pending work on termination"]
WORKER_CODEC_IDS = ["current V2 canonical payload preserves signed state values",
                    "current V2 canonical payload rejects ambiguous numeric values",
                    "current V2 envelope keeps correlation IDs nonnegative"]
RTC_PATHS = ["src/rust-browser/adapters/current-rtc-transport.ts",
             "src/rust-browser/routes/rust-current-rtc-entry.ts",
             "test/browser/rust-browser/m9e-v7-worker-rtc.spec.ts"]
RTC_SOURCE_PATHS = WORKER_SOURCE_PATHS + RTC_PATHS
RTC_TEST_IDS = ["two current Workers exchange real RTC proposals and converge one natural checkpoint turn",
                "current RTC identity mismatch and stalled presentation teardown settle owned work"]
STORAGE_SOURCE_PATHS = [
    "src/rust-browser/adapters/current-storage-backend.ts",
    "src/rust-browser/adapters/current-storage-owner.ts",
    "test/node/rust-browser/engineering/current-storage-owner.test.ts",
    "test/browser/rust-browser/m9e-current-storage.spec.ts",
]
STORAGE_NODE_IDS = [
    "current storage owner freezes requests and separates durable callback acknowledgement",
    "current storage owner bounds admission and rejects unsupported or malformed images before IO",
    "current storage owner drains nested enqueue without rerunning durable writes",
    "current storage owner fences unknown callback acceptance and late disposed work",
    "current storage owner reconciles exact uncertain images and rejects changed receipts",
]
STORAGE_BROWSER_IDS = [
    "current IndexedDB reconciles a committed write after dropped completion without rewriting",
    "current IndexedDB preserves a competing writer when uncertain reconciliation conflicts",
    "current IndexedDB settles a real aborted transaction and enforces namespace and slot bounds",
]
STORAGE_EVIDENCE_KEYS = ["reconciled", "conflict", "abort-bound"]

CONTROL_QUERY_PATHS = ["rust/crates/er-cli/src/current_agent.rs",
                       "rust/crates/er-cli/tests/m9e_current_control_query.rs"]
CONTROL_QUERY_TARGET = ("er-cli", "m9e_current_control_query")
CONTROL_QUERY_TEST_IDS = ["current_control_queries_are_read_only_and_plans_drive_natural_raw_input",
                          "worker_control_queries_bind_current_control_and_preserve_rejections"]
STATE_QUERY_PATHS = ["rust/crates/er-cli/src/current_agent.rs", "rust/crates/er-lab/src/query.rs",
                     "rust/crates/er-cli/tests/m9e_current_state_query.rs",
                     "rust/crates/er-cli/tests/m9e_current_state_query_worker.rs",
                     "rust/crates/er-cli/tests/support/m9e_current_state_query.rs"]
STATE_QUERY_TARGET = ("er-cli", "m9e_current_state_query")
STATE_QUERY_WORKER_TARGET = ("er-cli", "m9e_current_state_query_worker")
STATE_QUERY_TEST_IDS = ["current_state_queries_preserve_natural_and_controlled_terminal_snapshots_and_capture",
                        "worker_state_queries_bind_exact_current_snapshots_and_preserve_rejections"]
LANE_B_TARGETS = {("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_repro"),
                  ("er-cli", "m9e_current_reload"), STATE_QUERY_WORKER_TARGET}
STATE_QUERY_IDENTITIES = {STATE_QUERY_TARGET: STATE_QUERY_TEST_IDS[:1],
                          STATE_QUERY_WORKER_TARGET: STATE_QUERY_TEST_IDS[1:]}


def inventory_and_assignment(enumerated, lane):
    if lane not in {"a", "b"}:
        raise RuntimeError("native lane must be explicit a or b")
    inventory = sorted([{"crate": cwd.name, "target": name, "ids": sorted(ids),
                         "historical_excluded_ids": sorted(excluded)}
                        for _, _, name, ids, cwd, excluded, _ in enumerated],
                       key=lambda item: (item["crate"], item["target"]))
    assigned = partition(inventory)[lane]
    return inventory, assigned


def partition(inventory):
    result = {"a": [], "b": []}
    seen = set()
    for item in inventory:
        if set(item) != {"crate", "target", "ids", "historical_excluded_ids"}:
            raise RuntimeError("native inventory fields disagree")
        pair = (item["crate"], item["target"])
        if pair in seen or any(not isinstance(value, str) or not value for value in pair):
            raise RuntimeError("native target identity is missing or duplicated")
        seen.add(pair)
        ids, excluded = item["ids"], item["historical_excluded_ids"]
        if (not isinstance(ids, list) or not isinstance(excluded, list)
                or any(not isinstance(value, str) or not value for value in ids + excluded)
                or len(ids) != len(set(ids)) or len(excluded) != len(set(excluded)) or set(ids) & set(excluded)):
            raise RuntimeError("native test inventory is duplicated or malformed")
        result["b" if pair in LANE_B_TARGETS else "a"].append(list(pair))
    return result


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def file_hash(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def write_bounded(path, value):
    data = encoded(pack_native_inventory(value))
    if len(data) > MANIFEST_LIMIT:
        raise RuntimeError("phase manifest exceeds 64 KiB")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return sha(data)


def read_bounded(path, expected_hash):
    if (not re.fullmatch(r"[0-9a-f]{64}", expected_hash or "")
            or path.is_symlink() or not path.is_file() or path.stat().st_size > MANIFEST_LIMIT):
        raise RuntimeError("phase manifest path, size or expected digest is invalid")
    data = path.read_bytes()
    if len(data) > MANIFEST_LIMIT:
        raise RuntimeError("phase manifest size changed while reading")
    if sha(data) != expected_hash:
        raise RuntimeError("phase manifest digest mismatch")
    return unpack_native_ids(json.loads(data))


def pack_native_ids(value):
    """Store repeated required IDs as permutations of the complete inventory.

    The semantic proof, plan hash and inventory hash are unchanged. Invalid
    proofs remain inline for the existing validators to reject, never repaired.
    """
    if not isinstance(value, dict) or value.get("phase") != "native":
        return value
    plan = value.get("plan", {})
    if not isinstance(plan, dict):
        return value
    required = plan.get("required_native_test_ids")
    if not isinstance(required, dict) or not required:
        return value
    inventory = value.get("inventory", [])
    partition(inventory)
    by_target = {f"{item['crate']}:{item['target']}": item["ids"] for item in inventory}
    if len(by_target) != len(inventory):
        raise RuntimeError("native encoding target identity is ambiguous")
    indices = {}
    for target, ids in required.items():
        available = by_target.get(target)
        if (not isinstance(ids, list) or not ids or available is None
                or any(not isinstance(item, str) for item in ids)
                or len(ids) != len(available) or set(ids) != set(available)):
            return value
        positions = {item: index for index, item in enumerate(available)}
        indices[target] = [positions[item] for item in ids]
    target_positions = {(item["crate"], item["target"]): index for index, item in enumerate(inventory)}
    targets = {}
    for field in ("assigned_targets", "completed_targets"):
        pairs = value.get(field)
        if (not isinstance(pairs, list)
                or any(not isinstance(pair, list) or len(pair) != 2
                       or any(not isinstance(part, str) for part in pair)
                       or tuple(pair) not in target_positions for pair in pairs)
                or len({tuple(pair) for pair in pairs}) != len(pairs)):
            return value
        targets[field] = [target_positions[tuple(pair)] for pair in pairs]
    return {"encoding": NATIVE_ID_ENCODING,
            "proof": {**value, **targets, "plan": {**plan, "required_native_test_ids": indices}}}


def unpack_native_ids(value):
    if isinstance(value, dict) and value.get("encoding") == NATIVE_COMPRESSED_ID_ENCODING:
        value = unpack_compressed_native_inventory(value)
    if not isinstance(value, dict) or "encoding" not in value:
        return value
    if set(value) != {"encoding", "proof"} or value["encoding"] != NATIVE_ID_ENCODING:
        raise RuntimeError("native encoding fields or version are invalid")
    proof = value["proof"]
    if (not isinstance(proof, dict) or type(proof.get("version")) is not int or proof["version"] != 1
            or proof.get("phase") != "native" or not isinstance(proof.get("plan"), dict)
            or not isinstance(proof.get("inventory"), list)):
        raise RuntimeError("native encoding proof is invalid")
    inventory = proof["inventory"]
    partition(inventory)
    by_target = {f"{item['crate']}:{item['target']}": item["ids"] for item in inventory}
    if len(by_target) != len(inventory):
        raise RuntimeError("native encoding target identity is ambiguous")
    required = proof["plan"].get("required_native_test_ids")
    if not isinstance(required, dict) or not required:
        raise RuntimeError("native encoding required targets are missing")
    restored = {}
    for target, indices in required.items():
        ids = by_target.get(target)
        if (ids is None or not isinstance(indices, list) or not indices
                or len(indices) != len(ids)
                or any(type(index) is not int or index < 0 or index >= len(ids) for index in indices)
                or len(set(indices)) != len(indices)):
            raise RuntimeError("native encoding indices are not an exact target permutation")
        restored[target] = [ids[index] for index in indices]
    targets = {}
    for field in ("assigned_targets", "completed_targets"):
        indices = proof.get(field)
        if (not isinstance(indices, list) or len(indices) > len(inventory)
                or any(type(index) is not int or index < 0 or index >= len(inventory) for index in indices)
                or len(set(indices)) != len(indices)):
            raise RuntimeError("native encoding target indices are invalid")
        targets[field] = [[inventory[index]["crate"], inventory[index]["target"]] for index in indices]
    expanded = {**proof, **targets, "plan": {**proof["plan"], "required_native_test_ids": restored}}
    # Every target is referenced at most once and each index is a permutation:
    # each target-pair list is also bounded by the inventory count. Cap the
    # complete reconstructed evidence as well as the 64 KiB wire representation.
    if len(encoded(expanded)) > NATIVE_PROOF_LIMIT:
        raise RuntimeError("reconstructed native proof exceeds its bounded expansion")
    if (expanded.get("plan_sha256") != sha(encoded(expanded["plan"]))
            or expanded.get("inventory_sha256") != sha(encoded(inventory))):
        raise RuntimeError("reconstructed native plan or inventory digest mismatch")
    return expanded


def pack_native_inventory(value):
    """Compress only ID lists when the unchanged indexed proof cannot fit.

    Inline/v1 output stays byte-identical. Invalid or over-expanded proofs are
    not repaired by compression; write_bounded retains its wire-size failure.
    """
    indexed = pack_native_ids(value)
    if (len(encoded(indexed)) <= MANIFEST_LIMIT or not isinstance(indexed, dict)
            or indexed.get("encoding") != NATIVE_ID_ENCODING
            or len(encoded(value)) > NATIVE_PROOF_LIMIT):
        return indexed
    proof = indexed["proof"]
    inventory = proof["inventory"]
    ids = encoded([[item["ids"], item["historical_excluded_ids"]] for item in inventory])
    return {"encoding": NATIVE_COMPRESSED_ID_ENCODING,
            "proof": {**proof, "inventory": [{"crate": item["crate"], "target": item["target"]}
                                              for item in inventory]},
            "inventory_ids": {"decoded_bytes": len(ids),
                              "data": base64.b64encode(zlib.compress(ids, level=9)).decode("ascii")}}


def unpack_compressed_native_inventory(value):
    """Bound zlib output before JSON allocation, then reuse every v1 check."""
    if set(value) != {"encoding", "proof", "inventory_ids"}:
        raise RuntimeError("native compressed encoding fields are invalid")
    proof, payload = value["proof"], value["inventory_ids"]
    if (not isinstance(proof, dict) or type(proof.get("version")) is not int or proof["version"] != 1
            or proof.get("phase") != "native" or not isinstance(proof.get("plan"), dict)
            or not isinstance(proof.get("inventory"), list)
            or not isinstance(payload, dict) or set(payload) != {"decoded_bytes", "data"}):
        raise RuntimeError("native compressed proof or payload fields are invalid")
    inventory = proof["inventory"]
    seen = set()
    for item in inventory:
        if (not isinstance(item, dict) or set(item) != {"crate", "target"}
                or any(not isinstance(item[field], str) or not item[field] for field in ("crate", "target"))):
            raise RuntimeError("native compressed target fields are invalid")
        pair = (item["crate"], item["target"])
        if pair in seen:
            raise RuntimeError("native compressed target is duplicated")
        seen.add(pair)
    size, text = payload["decoded_bytes"], payload["data"]
    if (type(size) is not int or size <= 0 or size > 2 * MANIFEST_LIMIT
            or not isinstance(text, str) or not text or len(text) > MANIFEST_LIMIT):
        raise RuntimeError("native compressed payload bounds are invalid")
    try:
        compressed = base64.b64decode(text, validate=True)
        if base64.b64encode(compressed).decode("ascii") != text:
            raise ValueError("noncanonical base64")
        stream = zlib.decompressobj()
        # Never use an unbounded decompress or flush. One extra byte detects a
        # lying length; EOF and both tails reject truncation/concatenation/junk.
        raw = stream.decompress(compressed, size + 1)
        if len(raw) != size or not stream.eof or stream.unused_data or stream.unconsumed_tail:
            raise ValueError("incomplete, trailing or oversized zlib stream")
    except (ValueError, binascii.Error, zlib.error) as error:
        raise RuntimeError("native compressed payload is invalid or exceeds its bound") from error
    try:
        lists = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise RuntimeError("native compressed ID JSON is invalid") from error
    if (not isinstance(lists, list) or len(lists) != len(inventory)
            or any(not isinstance(item, list) or len(item) != 2
                   or any(not isinstance(ids, list) for ids in item) for item in lists)):
        raise RuntimeError("native compressed ID list shape is invalid")
    restored = [{**target, "ids": names[0], "historical_excluded_ids": names[1]}
                for target, names in zip(inventory, lists)]
    # Existing partition/permutation validation checks full ID strings, exact
    # uniqueness, selected/excluded separation and target ownership. Existing
    # semantic hashes and the complete 192 KiB expansion bound remain required.
    return {"encoding": NATIVE_ID_ENCODING, "proof": {**proof, "inventory": restored}}


def output(name, value):
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as stream:
        stream.write(f"{name}={value}\n")


def identity(feedback):
    if feedback.capture(["git", "rev-parse", "HEAD"]) != os.environ["GITHUB_SHA"]:
        raise RuntimeError("phase checkout differs from candidate")
    if feedback.capture(["git", "diff", "--name-only", "HEAD", "--"]):
        raise RuntimeError("phase tracked source differs from exact candidate")
    return {
        "product_sha": os.environ["GITHUB_SHA"], "workflow_sha": os.environ["GITHUB_WORKFLOW_SHA"],
        "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
        "files": {key: file_hash(feedback.ROOT / path) for key, path in IDENTITY_FILES.items()},
        "toolchain": feedback.capture(["rustc", "--version"], feedback.RUST),
        "target": next(line.split(": ", 1)[1] for line in
                       feedback.capture(["rustc", "-vV"], feedback.RUST).splitlines()
                       if line.startswith("host: ")),
        "profile": "test", "features": "default",
    }


def validate_control_query_inventory(plan, inventory):
    """Any selected current query target requires its exact process witness."""
    selected = [item for item in inventory if (item["crate"], item["target"]) == CONTROL_QUERY_TARGET]
    required = plan.get("requires_current_control_query", False)
    if type(required) is not bool or (selected and not required):
        raise RuntimeError("current control query requirement is absent or not boolean")
    if not required:
        return
    identity = ":".join(CONTROL_QUERY_TARGET)
    if (len(selected) != 1 or sorted(selected[0]["ids"]) != sorted(CONTROL_QUERY_TEST_IDS)
            or selected[0]["historical_excluded_ids"]
            or plan.get("requires_worker_executable") is not True
            or plan.get("required_native_test_ids", {}).get(identity) != CONTROL_QUERY_TEST_IDS
            or plan.get("required_native_targets", {}).get("er-cli", []).count(CONTROL_QUERY_TARGET[1]) != 1
            or list(CONTROL_QUERY_TARGET) not in partition(inventory)["a"]):
        raise RuntimeError("current control query process inventory, binding or lane ownership disagrees")


def validate_state_query_inventory(plan, inventory):
    """Any selected current query target requires its exact process witness."""
    selected = [item for item in inventory if (item["crate"], item["target"]) in STATE_QUERY_IDENTITIES]
    required = plan.get("requires_current_state_query", False)
    if type(required) is not bool or (selected and not required):
        raise RuntimeError("current state query requirement is absent or not boolean")
    if not required:
        return
    if plan.get("requires_current_control_query") is not True:
        raise RuntimeError("current state query requires the exact control-query prerequisite")
    validate_control_query_inventory(plan, inventory)
    if len(selected) != 2 or plan.get("requires_worker_executable") is not True:
        raise RuntimeError("current state query process inventory, binding or lane ownership disagrees")
    for target, ids in STATE_QUERY_IDENTITIES.items():
        rows = [item for item in selected if (item["crate"], item["target"]) == target]
        lane = "b" if target == STATE_QUERY_WORKER_TARGET else "a"
        if (len(rows) != 1 or rows[0]["ids"] != ids or rows[0]["historical_excluded_ids"]
                or plan.get("required_native_test_ids", {}).get(":".join(target)) != ids
                or plan.get("required_native_targets", {}).get("er-cli", []).count(target[1]) != 1
                or list(target) not in partition(inventory)[lane]):
            raise RuntimeError("current state query process inventory, binding or lane ownership disagrees")


def validate_native(proof, expected_identity):
    if (proof.get("version") != 1 or proof.get("phase") != "native"
            or proof.get("status") != "passed" or proof.get("qualification") != "pending"
            or proof.get("identity") != expected_identity):
        raise RuntimeError("native phase identity or completion mismatch")
    plan = proof["plan"]
    if proof.get("plan_sha256") != sha(encoded(plan)):
        raise RuntimeError("native phase plan digest mismatch")
    for flag in ("requires_wasm", "requires_browser", "requires_cli_executable"):
        if type(plan.get(flag)) is not bool:
            raise RuntimeError("native phase requirements are not explicit booleans")
    counts = proof["tests"]
    inventory = proof["inventory"]
    from m9e_current_proposal import validate_obligations
    validate_obligations(plan, inventory, expected_identity["product_sha"])
    assignment = partition(inventory)
    validate_control_query_inventory(plan, inventory)
    validate_state_query_inventory(plan, inventory)
    lane = proof.get("lane")
    if lane not in assignment or proof.get("assigned_targets") != assignment[lane]:
        raise RuntimeError("native lane assignment is missing or differs from exact partition")
    if sorted(proof.get("completed_targets", [])) != sorted(assignment[lane]):
        raise RuntimeError("native lane completed targets are missing, duplicated or unexpected")
    if proof.get("inventory_sha256") != sha(encoded(inventory)):
        raise RuntimeError("native global inventory digest mismatch")
    selected_count = sum(len(item["ids"]) for item in inventory)
    assigned_count = sum(len(item["ids"]) for item in inventory if [item["crate"], item["target"]] in assignment[lane])
    if (set(counts) != {"selected", "executed", "passed", "failed", "skipped"}
            or any(type(value) is not int for value in counts.values())
            or counts["selected"] != selected_count or selected_count <= 0
            or not counts["executed"] == counts["passed"] == assigned_count
            or counts["failed"] != 0 or counts["skipped"] != 0
            or proof.get("selected_inventory_validated") is not True
            or not re.fullmatch(r"[0-9a-f]{64}", proof.get("selected_test_ids_sha256", ""))):
        raise RuntimeError("native phase inventory or counts are incomplete")
    required = {f"{crate}:{target}" for crate, targets in plan.get("required_native_targets", {}).items()
                for target in targets}
    actual = proof.get("required_native_target_counts", {})
    if set(actual) != required or any(type(count) is not int or count <= 0 for count in actual.values()):
        raise RuntimeError("native phase required witness counts disagree")
    by_target = {f"{item['crate']}:{item['target']}": item["ids"] for item in inventory}
    if any(target not in by_target or len(by_target[target]) != count for target, count in actual.items()):
        raise RuntimeError("native required witness inventory differs from counts")
    for target, ids in plan.get("required_native_test_ids", {}).items():
        if not ids or len(ids) != len(set(ids)) or target not in by_target or sorted(by_target[target]) != sorted(ids):
            raise RuntimeError("native required exact test identities disagree")
    for item in inventory:
        allowed = sorted(policy["test"] for policy in plan.get("historical_dispositions", [])
                         if (policy["crate"], policy["target"]) == (item["crate"], item["target"]))
        if item["historical_excluded_ids"] != allowed:
            raise RuntimeError("native inventory changed historical exclusion ownership")
    if lane == "a" and plan["requires_wasm"] and not re.fullmatch(r"[0-9a-f]{64}", proof.get("native_timer_parity_digest", "")):
        raise RuntimeError("native parity evidence is missing")
    if bool(plan.get("ledger_mutant")) != bool(plan.get("material_retention_focus")):
        raise RuntimeError("retention phase requires its exact ledger mutant policy")
    if "ledger_mutant" in proof and not plan.get("ledger_mutant"):
        raise RuntimeError("ledger mutant evidence is outside the retention scope")
    for key in ("timer_mutant", "replica_mutant", "ledger_mutant"):
        if lane == "b" and key in proof:
            raise RuntimeError("lane B cannot claim lane A mutant evidence")
        if lane == "a" and plan.get(key):
            evidence = proof.get(key, {})
            policy = plan[key]
            ordinary_pair = [policy["package"], policy["target"]]
            ordinary_ids = by_target.get(f"{policy['package']}:{policy['target']}", [])
            if (evidence.get("status") != "detected"
                    or any(evidence.get(field) != policy[field] for field in ("source", "test", "target"))
                    or ordinary_pair not in assignment["a"] or ordinary_ids.count(policy["test"]) != 1
                    or evidence.get("tests") != {"executed": 1, "passed": 0, "failed": 1, "skipped": 0}
                    or not re.fullmatch(r"[0-9a-f]{64}", evidence.get("original_sha256", ""))
                    or evidence.get("restored_sha256") != evidence["original_sha256"]):
                raise RuntimeError("selected mutant was omitted or not restored")
    binding = proof.get("cli")
    if bool(binding) != bool(plan.get("requires_cli_executable")):
        raise RuntimeError("native CLI transfer requirement mismatch")
    if binding is not None:
        if (set(binding) != {"file", "bytes", "sha256", "source_sha", "target", "profile", "cargo_package_id", "cargo_profile", "manifest_path"}
                or binding["file"] != "er-cli" or type(binding["bytes"]) is not int
                or not 0 < binding["bytes"] <= CLI_LIMIT
                or not re.fullmatch(r"[0-9a-f]{64}", binding["sha256"])
                or binding["source_sha"] != expected_identity["product_sha"]
                or binding["target"] != expected_identity["target"] or binding["profile"] != "test"
                or binding["manifest_path"] != "rust/crates/er-cli/Cargo.toml"
                or binding["cargo_profile"].get("test") is not False):
            raise RuntimeError("native CLI transfer metadata is invalid")
    worker = proof.get("worker")
    if bool(worker) != bool(plan.get("requires_worker_executable")):
        raise RuntimeError("native worker evidence requirement mismatch")
    if worker is not None and (worker.get("source_sha") != expected_identity["product_sha"]
            or worker.get("target") != expected_identity["target"] or worker.get("profile") != "test"
            or worker.get("manifest_path") != "rust/crates/er-kernel-worker/Cargo.toml"
            or worker.get("cargo_profile", {}).get("test") is not False
            or type(worker.get("bytes")) is not int or worker["bytes"] <= 0
            or not re.fullmatch(r"[0-9a-f]{64}", worker.get("sha256", ""))):
        raise RuntimeError("native worker artifact evidence is invalid")


def export_native(feedback, summary):
    """Called after full discovery/lint and this lane's complete execution."""
    expected = identity(feedback)
    if summary["plan"].get("requires_current_proposal"):
        from m9e_current_proposal import source_binding
        if source_binding(feedback.ROOT, expected["product_sha"]) != summary["plan"].get("owner_source_binding"):
            raise RuntimeError("owner source changed after native execution")
    if (summary["product_sha"] != expected["product_sha"] or summary["harness_sha"] != expected["files"]["harness"]
            or summary["lockfile_hash"] != expected["files"]["lock"] or summary["profile"] != expected["profile"]
            or summary["toolchain"] != expected["toolchain"] or summary["target"] != expected["target"]
            or summary["content_manifest_hash"] != expected["files"]["content"]):
        raise RuntimeError("native source/build identity changed after compilation")
    proof = {"version": 1, "phase": "native", "status": "passed", "qualification": "pending",
             "identity": expected, "plan": summary["plan"], "plan_sha256": sha(encoded(summary["plan"])),
             "tests": summary["tests"], "selected_inventory_validated": summary["selected_inventory_validated"],
             "selected_test_ids_sha256": summary["selected_test_ids"]["sha256"],
             "required_native_target_counts": summary["required_native_target_counts"],
             "lane": summary["native_lane"], "inventory": summary["native_inventory"],
             "inventory_sha256": sha(encoded(summary["native_inventory"])),
             "assigned_targets": summary["assigned_targets"],
             "completed_targets": summary["completed_targets"],
             "native_target_timing_ms": summary.get("native_target_timing_ms", {}),
             "native_timer_parity_digest": summary.get("native_timer_parity_digest"), "cli": None}
    worker = summary.get("worker_executable")
    proof["worker"] = None
    if worker is not None:
        if file_hash(Path(worker["path"])) != worker["sha256"] or Path(worker["path"]).stat().st_size != worker["bytes"]:
            raise RuntimeError("native worker artifact changed after execution")
        proof["worker"] = {key: value for key, value in worker.items() if key != "path"}
    for key in ("timer_mutant", "replica_mutant", "ledger_mutant"):
        if key in summary:
            proof[key] = summary[key]
    transfer = Path(os.environ["M9E_PHASE_DIR"])
    binding = summary.get("cli_executable")
    if binding is not None:
        feedback.browser_cli_env(binding, expected["product_sha"])
        proof["cli"] = {key: binding[key] for key in (
            "bytes", "sha256", "source_sha", "target", "profile", "cargo_package_id", "cargo_profile", "manifest_path")}
        proof["cli"]["file"] = "er-cli"
    validate_native(proof, expected)
    if binding is not None and proof["lane"] == "a":
        directory = transfer / "cli"
        directory.mkdir(parents=True, exist_ok=False)
        target = directory / "er-cli"
        shutil.copyfile(binding["path"], target)
        if target.stat().st_size != binding["bytes"] or file_hash(target) != binding["sha256"]:
            raise RuntimeError("CLI changed during bounded transfer preparation")
    proof_hash = write_bounded(transfer / f"proof/native-{proof['lane']}.json", proof)
    output("native_manifest_sha256", proof_hash)
    output("has_cli", "true" if binding is not None and proof["lane"] == "a" else "false")
    summary.update({"phase": "native", "qualification": "pending", "native_manifest_sha256": proof_hash})


def transfer_cli(proof, directory):
    binding = proof["cli"]
    if binding is None:
        if directory.exists() and any(directory.iterdir()):
            raise RuntimeError("unexpected CLI transfer")
        return None
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError("CLI transfer directory is invalid")
    paths = list(directory.iterdir())
    path = directory / "er-cli"
    if (paths != [path] or path.is_symlink() or not path.is_file()
            or path.stat().st_size != binding["bytes"] or file_hash(path) != binding["sha256"]):
        raise RuntimeError("CLI transfer file inventory, bytes or hash mismatch")
    # Artifact transport does not preserve executable permissions. Restore only
    # this one validated regular file; never execute a manifest-supplied path.
    path.chmod(0o755)
    return {**binding, "path": str(path.resolve()), "root": str(directory.resolve())}


def browser_worker_source_binding(root, product_sha):
    return {"source_sha": product_sha,
            "source_hashes": {path: file_hash(root / path) for path in WORKER_SOURCE_PATHS},
            "pnpm_lock_sha256": file_hash(root / "pnpm-lock.yaml")}


def browser_rtc_source_binding(root, product_sha):
    return {"source_sha": product_sha,
            "source_hashes": {path: file_hash(root / path) for path in RTC_SOURCE_PATHS},
            "pnpm_lock_sha256": file_hash(root / "pnpm-lock.yaml")}


def validate_browser_worker_assets(evidence, binding, cohort_assets, *, rtc=False):
    if not isinstance(evidence, dict) or set(evidence) != {"manifest_sha256", "manifest"}:
        raise RuntimeError("current Worker asset proof fields disagree")
    manifest = evidence["manifest"]
    fields = {"schema_version", "browser_worker_protocol_version", "source_sha", "assets", "entry", "worker",
              "cohort", "builder_sha256", "pnpm_lock_sha256", "source_hashes", "vite_version"}
    if (not isinstance(manifest, dict) or set(manifest) != fields
            or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1
            or type(manifest["browser_worker_protocol_version"]) is not int or manifest["browser_worker_protocol_version"] != 2
            or not isinstance(binding, dict) or set(binding) != {"source_sha", "source_hashes", "pnpm_lock_sha256"}
            or not isinstance(binding["source_hashes"], dict)
            or manifest["source_sha"] != binding["source_sha"] or manifest["source_hashes"] != binding["source_hashes"]
            or set(binding["source_hashes"]) != set(RTC_SOURCE_PATHS if rtc else WORKER_SOURCE_PATHS)
            or manifest["pnpm_lock_sha256"] != binding["pnpm_lock_sha256"]
            or manifest["builder_sha256"] != binding["source_hashes"][WORKER_SOURCE_PATHS[-1]]
            or not isinstance(manifest["vite_version"], str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?", manifest["vite_version"])
            or not isinstance(evidence["manifest_sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", evidence["manifest_sha256"])):
        raise RuntimeError("current Worker source or ABI binding disagrees")
    if not isinstance(binding["source_sha"], str) or not re.fullmatch(r"[0-9a-f]{40}", binding["source_sha"]):
        raise RuntimeError("current Worker source SHA is invalid")
    for value in [*binding["source_hashes"].values(), binding["pnpm_lock_sha256"]]:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise RuntimeError("current Worker source digest is invalid")
    assets = manifest["assets"]
    entry = "current-rtc-entry.js" if rtc else "current-worker-entry.js"
    if not isinstance(assets, dict) or not 2 <= len(assets) <= 8 or manifest["entry"] != entry:
        raise RuntimeError("current Worker asset inventory is invalid")
    total = 0
    roles = {"entry": [], "worker": [], "chunk": []}
    for path, metadata in assets.items():
        if (not isinstance(path, str) or not re.fullmatch(r"[a-zA-Z0-9_-]+\.js", path)
                or not isinstance(metadata, dict) or set(metadata) != {"bytes", "sha256", "role"}
                or type(metadata["bytes"]) is not int or not 0 < metadata["bytes"] <= 4_194_304
                or not isinstance(metadata["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", metadata["sha256"])
                or not isinstance(metadata["role"], str) or metadata["role"] not in roles):
            raise RuntimeError("current Worker asset path, size or digest is invalid")
        total += metadata["bytes"]
        roles[metadata["role"]].append(path)
    if (total > 4_194_304 or roles["entry"] != [manifest["entry"]] or roles["worker"] != [manifest["worker"]]
            or not isinstance(manifest["worker"], str)
            or not re.fullmatch(r"current-rtc-kernel-worker-[a-zA-Z0-9_-]+\.js" if rtc
                                else r"current-rust-kernel-worker-[a-zA-Z0-9_-]+\.js", manifest["worker"])):
        raise RuntimeError("current Worker emitted entry/Worker roles disagree")
    expected_cohort = {key: cohort_assets.get(path, {}).get("sha256") for key, path in (
        ("glue_sha256", "er_web.js"), ("wasm_sha256", "er_web_bg.wasm"),
        ("content_sha256", "game-content-bundle-v2.json"))}
    if manifest["cohort"] != expected_cohort or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value) for value in expected_cohort.values()):
        raise RuntimeError("current Worker Wasm/content cohort disagrees")
    # The builder emits sorted compact ASCII JSON plus newline. All strings above
    # are fixed ASCII fields, paths, digests or a validated version.
    raw = encoded(manifest)
    if len(raw) > 16_384 or sha(raw) != evidence["manifest_sha256"]:
        raise RuntimeError("current Worker manifest hash or byte bound disagrees")


def validate_browser_worker_tests(tests, evidence, binding):
    if (not isinstance(tests, dict) or set(tests) != {"expected", "passed", "failed", "skipped", "selected_test_ids", "positive", "negative"}
            or any(type(tests[key]) is not int for key in ("expected", "passed", "failed", "skipped"))
            or tests["expected"] != 2 or tests["passed"] != 2 or tests["failed"] != 0 or tests["skipped"] != 0
            or tests["selected_test_ids"] != WORKER_TEST_IDS):
        raise RuntimeError("current Worker witness counts or identities disagree")
    manifest = evidence["manifest"]
    common = {"schema_version", "source_sha", "manifest_sha256", "entry_sha256", "worker_sha256", "worker_path",
              "glue_sha256", "wasm_sha256", "content_sha256", "browser_worker_protocol_version", "observed_worker_count"}
    positive_fields = {"initial_control", "final_control", "presentation_count", "settled_presentation_count", "ui_change_count",
                       "held_cursor", "released_cursor", "final_snapshot_digest", "accepted_sequence", "disposed",
                       "rejected_event_code", "rejection_preserved_snapshot", "authority_material_count"}
    negative_fields = {"wrong_abi", "invalid_request_id", "pending_before_termination", "settled_after_termination", "rejected_after_termination",
                       "closed", "pending_after", "queued_bytes_after", "accepted_sequence", "post_termination_rejected"}
    for key, extra, worker_count in (("positive", positive_fields, 1), ("negative", negative_fields, 2)):
        item = tests[key]
        if (not isinstance(item, dict) or set(item) != common | extra
                or type(item["schema_version"]) is not int or item["schema_version"] != 1
                or type(item["browser_worker_protocol_version"]) is not int or item["browser_worker_protocol_version"] != 2
                or type(item["observed_worker_count"]) is not int or item["observed_worker_count"] != worker_count
                or item["source_sha"] != binding["source_sha"] or item["manifest_sha256"] != evidence["manifest_sha256"]
                or item["worker_path"] != manifest["worker"]
                or item["entry_sha256"] != manifest["assets"][manifest["entry"]]["sha256"]
                or item["worker_sha256"] != manifest["assets"][manifest["worker"]]["sha256"]
                or any(item[field] != manifest["cohort"][field] for field in manifest["cohort"])):
            raise RuntimeError("current Worker measured identity disagrees")
    positive, negative = tests["positive"], tests["negative"]
    if type(positive["authority_material_count"]) is not int or not 1 <= positive["authority_material_count"] <= 64:
        raise RuntimeError("current Worker authority material evidence is missing or unbounded")
    for field in ("presentation_count", "settled_presentation_count", "ui_change_count", "accepted_sequence"):
        if type(positive[field]) is not int or not 1 <= positive[field] <= (1 << 53) - 1:
            raise RuntimeError("current Worker positive counters are unsafe or empty")
    if (positive["initial_control"] != "TITLE" or positive["final_control"] != "BATTLE_COMMAND"
            or positive["presentation_count"] != positive["settled_presentation_count"]
            or positive["held_cursor"] != ["battle/command/party", "battle/command/party", "battle/command/fight"]
            or positive["released_cursor"] != "battle/command/fight" or positive["disposed"] is not True
            or positive["rejected_event_code"] != "HOST_REJECTED" or positive["rejection_preserved_snapshot"] is not True
            or not isinstance(positive["final_snapshot_digest"], str) or not re.fullmatch(r"[0-9a-f]{64}", positive["final_snapshot_digest"])):
        raise RuntimeError("current Worker positive causal evidence disagrees")
    expected_wrong = {"code": "INVALID_ABI", "acceptance": "REJECTED", "request_id": 1, "sequence": 0, "accepted_sequence": None}
    if negative["wrong_abi"] != expected_wrong or any(type(negative["wrong_abi"].get(key)) is not int for key in ("request_id", "sequence")):
        raise RuntimeError("current Worker ABI rejection evidence disagrees")
    if negative["invalid_request_id"] != {"code": "WORKER_FAILURE", "acceptance": "UNKNOWN", "request_id": None,
                                          "sequence": None, "accepted_sequence": None}:
        raise RuntimeError("current Worker invalid correlation evidence disagrees")
    for field, count in (("pending_before_termination", 2), ("settled_after_termination", 2),
                         ("rejected_after_termination", 2), ("pending_after", 0), ("queued_bytes_after", 0)):
        if type(negative[field]) is not int or negative[field] != count:
            raise RuntimeError("current Worker pending termination evidence disagrees")
    if negative["closed"] is not True or negative["accepted_sequence"] is not None or negative["post_termination_rejected"] is not True:
        raise RuntimeError("current Worker termination did not fence the client")


def validate_browser_rtc_tests(tests, evidence, binding, cohort_assets, *, owner_binding=None, owner_helper_hash=None):
    if owner_binding is not None:
        from m9e_current_proposal import legacy_rtc_view
        tests = legacy_rtc_view(tests, owner_binding, owner_helper_hash)
    if (not isinstance(tests, dict) or set(tests) != {"expected", "passed", "failed", "skipped", "selected_test_ids", "positive", "negative"}
            or any(type(tests[key]) is not int for key in ("expected", "passed", "failed", "skipped"))
            or [tests[key] for key in ("expected", "passed", "failed", "skipped")] != [2, 2, 0, 0]
            or tests["selected_test_ids"] != RTC_TEST_IDS):
        raise RuntimeError("current RTC witness counts or identities disagree")
    manifest = evidence["manifest"]
    common = {"source_sha", "manifest_sha256", "worker_sha256", "worker_path", "glue_sha256", "wasm_sha256",
              "content_sha256", "browser_worker_protocol", "generation", "observed_workers",
              "authority_fixture_sha256", "replica_fixture_sha256"}
    positive_fields = {"initial_turn", "final_turn", "proposal_sha256", "proposal_bytes", "material_sha256", "material_bytes",
                       "proposal_operation_id", "material_revision", "material_after_digest", "presentation_count",
                       "settled_presentation_count", "duplicate_proposal_effects", "duplicate_material_effects",
                       "private_duplicate_snapshot_equal", "left_sent", "right_sent", "left_kernel_delivered",
                       "right_kernel_delivered", "maximum_frame_bytes", "negotiated_frame_bound", "disconnected_events", "disposed"}
    negative_fields = {"mismatch", "stalled_callback_aborted", "queued_snapshot_rejected", "disposal_acknowledged",
                       "committed_delivery_failure_sequence", "pending_after", "queued_bytes_after", "worker_closed"}
    for key, fields in (("positive", positive_fields), ("negative", negative_fields)):
        item = tests[key]
        if (not isinstance(item, dict) or set(item) != common | fields
                or item["source_sha"] != binding["source_sha"] or item["manifest_sha256"] != evidence["manifest_sha256"]
                or item["worker_path"] != manifest["worker"]
                or item["worker_sha256"] != manifest["assets"][manifest["worker"]]["sha256"]
                or any(item[field] != manifest["cohort"][field] for field in manifest["cohort"])
                or item["authority_fixture_sha256"] != cohort_assets.get("coop-authority-snapshot.json", {}).get("sha256")
                or item["replica_fixture_sha256"] != cohort_assets.get("coop-replica-snapshot.json", {}).get("sha256")):
            raise RuntimeError("current RTC observed cohort or checkpoint binding disagrees")
        for field, expected in (("browser_worker_protocol", 2), ("generation", 1), ("observed_workers", 2)):
            if type(item[field]) is not int or item[field] != expected:
                raise RuntimeError("current RTC actual Worker topology identity disagrees")
        for field in ("authority_fixture_sha256", "replica_fixture_sha256"):
            if not isinstance(item[field], str) or not re.fullmatch(r"[0-9a-f]{64}", item[field]):
                raise RuntimeError("current RTC natural checkpoint hash is absent")
    positive, negative = tests["positive"], tests["negative"]
    counters = ("initial_turn", "final_turn", "proposal_bytes", "material_bytes", "material_revision", "presentation_count",
                "settled_presentation_count", "duplicate_proposal_effects", "duplicate_material_effects", "left_sent",
                "right_sent", "left_kernel_delivered", "right_kernel_delivered", "maximum_frame_bytes", "negotiated_frame_bound")
    if any(type(positive[field]) is not int or not 0 <= positive[field] <= (1 << 53) - 1 for field in counters):
        raise RuntimeError("current RTC causal counters are unsafe")
    if (positive["final_turn"] != positive["initial_turn"] + 1 or positive["material_revision"] < 1
            or not 1 <= positive["presentation_count"] <= 4096
            or positive["presentation_count"] != positive["settled_presentation_count"]
            or positive["duplicate_proposal_effects"] != 0 or positive["duplicate_material_effects"] != 0
            or positive["private_duplicate_snapshot_equal"] is not True
            or [positive[field] for field in ("left_sent", "right_sent", "left_kernel_delivered", "right_kernel_delivered")] != [4, 2, 2, 4]
            or not 4096 <= positive["negotiated_frame_bound"] <= 1 << 20
            or not max(positive["proposal_bytes"], positive["material_bytes"]) <= positive["maximum_frame_bytes"] <= positive["negotiated_frame_bound"]
            or min(positive["proposal_bytes"], positive["material_bytes"]) < 1
            or positive["disposed"] != [True, True] or any(type(value) is not bool for value in positive["disposed"])
            or positive["disconnected_events"] != [1, 1] or any(type(value) is not int for value in positive["disconnected_events"])):
        raise RuntimeError("current RTC turn/material/presentation/transport evidence disagrees")
    for field in ("proposal_sha256", "material_sha256"):
        if not isinstance(positive[field], str) or not re.fullmatch(r"[0-9a-f]{64}", positive[field]):
            raise RuntimeError("current RTC frame or state digest is invalid")
    if (not isinstance(positive["material_after_digest"], str)
            or not re.fullmatch(r"blake3-v1:[0-9a-f]{64}", positive["material_after_digest"])):
        raise RuntimeError("current RTC canonical material state digest is invalid")
    if not isinstance(positive["proposal_operation_id"], str) or not 1 <= len(positive["proposal_operation_id"].encode()) <= 1024:
        raise RuntimeError("current RTC proposal operation identity is absent or oversized")
    mismatch = {"workers": 2, "rejected_readiness": 2, "rejected_queued_sends": 16, "invalid_admissions": 3,
                "connected_events": [0, 0], "kernel_delivered": [0, 0], "snapshot_equal": True}
    # Encoded equality distinguishes bools from integer counters in nested data.
    if encoded(negative["mismatch"]) != encoded(mismatch):
        raise RuntimeError("current RTC mismatched-cohort admission evidence disagrees")
    if (negative["stalled_callback_aborted"] is not True or negative["queued_snapshot_rejected"] is not True
            or negative["disposal_acknowledged"] is not False or negative["worker_closed"] is not True
            or type(negative["committed_delivery_failure_sequence"]) is not int
            or not 0 < negative["committed_delivery_failure_sequence"] <= (1 << 53) - 1
            or any(type(negative[field]) is not int or negative[field] != 0 for field in ("pending_after", "queued_bytes_after"))):
        raise RuntimeError("current RTC accepted-delivery teardown evidence disagrees")


def validate_browser_worker_codec(evidence):
    if (not isinstance(evidence, dict) or set(evidence) != {"expected", "passed", "failed", "skipped", "selected_test_ids"}
            or any(type(evidence[key]) is not int for key in ("expected", "passed", "failed", "skipped"))
            or evidence["expected"] != 3 or evidence["passed"] != 3 or evidence["failed"] != 0 or evidence["skipped"] != 0
            or evidence["selected_test_ids"] != WORKER_CODEC_IDS):
        raise RuntimeError("current Worker codec identities/counts disagree")


def storage_source_binding(root, product_sha):
    hashes = {}
    for name in STORAGE_SOURCE_PATHS + ["pnpm-lock.yaml"]:
        path = root / name
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or not path.is_file() or not 0 < path.stat().st_size <= 4 * 1024 * 1024:
            raise RuntimeError("current storage source binding path or size is invalid")
        hashes[name] = file_hash(path)
    return {"source_sha": product_sha, "source_hashes": {name: hashes[name] for name in STORAGE_SOURCE_PATHS},
            "pnpm_lock_sha256": hashes["pnpm-lock.yaml"]}


def validate_storage_binding(binding, product_sha):
    if (not isinstance(binding, dict) or set(binding) != {"source_sha", "source_hashes", "pnpm_lock_sha256"}
            or binding["source_sha"] != product_sha or not re.fullmatch(r"[0-9a-f]{40}", product_sha or "")
            or not isinstance(binding["source_hashes"], dict) or set(binding["source_hashes"]) != set(STORAGE_SOURCE_PATHS)
            or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
                   for value in [*binding["source_hashes"].values(), binding["pnpm_lock_sha256"]])):
        raise RuntimeError("current storage source identities disagree")


def validate_storage_node(evidence, *, title_retirement=False):
    if title_retirement:
        from m9e_title_storage import validate_node
        return validate_node(evidence)
    if (not isinstance(evidence, dict) or set(evidence) != {"expected", "passed", "failed", "skipped", "selected_test_ids"}
            or any(type(evidence[key]) is not int for key in ("expected", "passed", "failed", "skipped"))
            or evidence["expected"] != 5 or evidence["passed"] != 5 or evidence["failed"] != 0 or evidence["skipped"] != 0
            or evidence["selected_test_ids"] != STORAGE_NODE_IDS):
        raise RuntimeError("current storage Node identities/counts disagree")


def validate_storage_browser(tests, binding):
    keys = {"expected", "passed", "failed", "skipped", "selected_test_ids", *STORAGE_EVIDENCE_KEYS}
    if (not isinstance(tests, dict) or set(tests) != keys
            or any(type(tests[key]) is not int for key in ("expected", "passed", "failed", "skipped"))
            or tests["expected"] != 3 or tests["passed"] != 3 or tests["failed"] != 0 or tests["skipped"] != 0
            or tests["selected_test_ids"] != STORAGE_BROWSER_IDS):
        raise RuntimeError("current storage Chromium identities/counts disagree")
    expected = {
        "reconciled": {"transaction_committed": True, "completion_deliberately_dropped": True,
                       "original_request": 1, "before_phase": "UNCERTAIN", "after_phase": "ACKNOWLEDGED",
                       "actual_generation": 1, "writes": 1, "callbacks": 1, "reopened_exact_bytes": True,
                       "slots_utf8_ordered": True, "payload_sha256": sha(bytes([0, 1, 255])),
                       "operation": sha(b'[1,"logical-save","fixture-v2","stable-session",1,"WRITE","slot-a",1]\x00' + bytes([0, 1, 255]))},
        "conflict": {"original_phase": "UNCERTAIN", "conflict_phase": "FAILED", "conflict_code": "CONFLICT",
                     "competing_generation": 2, "competing_receipt": "c" * 64,
                     "competing_exact_bytes_preserved": True, "original_writes": 1, "callbacks": 0},
        "abort-bound": {"actual_abort_settled": True, "owner_abort_phase": "FAILED", "owner_write_outcome": "ABORTED",
                        "aborted_record_absent": True, "original_request_retry_accepted": True, "slots": 64,
                        "overflow_rejected_without_record": True, "existing_slot_replacement_allowed": True,
                        "namespace_isolation": True},
    }
    for key, oracle in expected.items():
        attachment = tests[key]
        if (not isinstance(attachment, dict) or set(attachment) != {"schema_version", "capability", "source_sha", "source_hashes", "evidence"}
                or type(attachment["schema_version"]) is not int or attachment["schema_version"] != 1
                or attachment["capability"] != "INDEXEDDB_ADAPTER_ONLY"
                or attachment["source_sha"] != binding["source_sha"] or attachment["source_hashes"] != binding["source_hashes"]
                or len(encoded(attachment)) > 4096):
            raise RuntimeError("current storage attachment scope/source/bounds disagree")
        value = attachment["evidence"]
        fields = set(oracle)
        if (not isinstance(value, dict) or set(value) != fields
                or any(type(value[name]) is not type(wanted) or value[name] != wanted for name, wanted in oracle.items())):
            raise RuntimeError("current storage causal evidence disagrees")

def validate_platform(proof, native, native_hash):
    if (proof.get("version") != 1 or proof.get("phase") != "platform"
            or proof.get("status") != "passed" or proof.get("qualification") != "pending"
            or proof.get("identity") != native["identity"]
            or proof.get("native_manifest_sha256") != native_hash
            or proof.get("plan_sha256") != native["plan_sha256"]):
        raise RuntimeError("platform phase identity or completion mismatch")
    plan = native["plan"]
    from m9e_current_proposal import validate_obligations
    validate_obligations(plan, native["inventory"], native["identity"]["product_sha"])
    if plan.get("requires_browser_worker"):
        if not plan.get("requires_browser") or not plan.get("requires_wasm") or not plan.get("requires_cli_executable"):
            raise RuntimeError("current Worker plan omitted an existing platform requirement")
        binding = plan.get("browser_worker_binding")
        if not isinstance(binding, dict) or binding.get("source_sha") != native["identity"]["product_sha"]:
            raise RuntimeError("current Worker plan source binding disagrees")
        validate_browser_worker_assets(proof.get("browser_worker_assets"), binding, proof.get("browser_assets", {}).get("assets", {}))
        validate_browser_worker_tests(proof.get("browser_worker_tests"), proof["browser_worker_assets"], binding)
        validate_browser_worker_codec(proof.get("browser_worker_codec"))
    elif any(key in proof for key in ("browser_worker_assets", "browser_worker_tests", "browser_worker_codec")):
        raise RuntimeError("platform cannot claim an unrequested current Worker capability")
    if plan.get("requires_browser_rtc"):
        binding = plan.get("browser_rtc_binding")
        if (not plan.get("requires_browser_worker") or not isinstance(binding, dict)
                or binding.get("source_sha") != native["identity"]["product_sha"]):
            raise RuntimeError("current RTC plan omitted its Worker dependency or source binding")
        worker_binding = plan["browser_worker_binding"]
        if (binding.get("pnpm_lock_sha256") != worker_binding["pnpm_lock_sha256"]
                or any(binding.get("source_hashes", {}).get(path) != worker_binding["source_hashes"][path]
                       for path in WORKER_SOURCE_PATHS)):
            raise RuntimeError("current RTC and Worker dependency source bindings disagree")
        validate_browser_worker_assets(proof.get("browser_rtc_assets"), binding, proof.get("browser_assets", {}).get("assets", {}), rtc=True)
        if set(proof["browser_rtc_assets"]["manifest"]["assets"]) & set(proof["browser_worker_assets"]["manifest"]["assets"]):
            raise RuntimeError("current RTC and Worker bundle namespaces overlap")
        validate_browser_rtc_tests(proof.get("browser_rtc_tests"), proof["browser_rtc_assets"], binding, proof["browser_assets"]["assets"],
                                   owner_binding=plan.get("owner_source_binding") if plan.get("requires_current_proposal") else None,
                                   owner_helper_hash=native["identity"]["files"].get("owner_helper"))
    elif any(key in proof for key in ("browser_rtc_assets", "browser_rtc_tests")):
        raise RuntimeError("platform cannot claim an unrequested RTC capability")
    if plan.get("requires_current_storage"):
        if not all(plan.get(key) for key in ("requires_browser", "requires_browser_worker", "requires_wasm", "requires_cli_executable")):
            raise RuntimeError("current storage plan omitted existing platform requirements")
        binding = plan.get("current_storage_binding")
        validate_storage_binding(binding, native["identity"]["product_sha"])
        if binding["pnpm_lock_sha256"] != plan["browser_worker_binding"]["pnpm_lock_sha256"]:
            raise RuntimeError("current storage and Worker lock cohorts disagree")
        validate_storage_node(proof.get("current_storage_node"), title_retirement=plan.get("requires_title_retirement", False))
        validate_storage_browser(proof.get("current_storage_browser"), binding)
    elif any(key in proof for key in ("current_storage_node", "current_storage_browser")):
        raise RuntimeError("platform cannot claim unrequested current storage")
    import m9e_worker_storage as composition
    composition.validate_platform(proof, native)
    import m9e_title_storage as retirement
    retirement.validate_platform(proof, native)
    if plan["requires_wasm"]:
        wasm = proof.get("wasm_tests", {})
        if (wasm.get("expected") != 2 or wasm.get("passed") != 2 or wasm.get("failed") != 0
                or wasm.get("skipped") != 0 or len(wasm.get("selected_test_ids", [])) != 2
                or set(wasm["selected_test_ids"]) != WASM_IDS
                or wasm.get("timer_parity_digest") != native["native_timer_parity_digest"]
                or wasm.get("native_timer_parity_digest") != native["native_timer_parity_digest"]):
            raise RuntimeError("platform Wasm identities, counts or parity disagree")
    if plan["requires_browser"]:
        browser = proof.get("browser_tests", {})
        chromium, typed = browser.get("chromium", {}), browser.get("typed_effects", {})
        if (chromium.get("expected") != 2 or chromium.get("passed") != 2 or chromium.get("failed") != 0
                or chromium.get("skipped") != 0 or len(chromium.get("selected_test_ids", [])) != 2
                or set(chromium["selected_test_ids"]) != BROWSER_IDS
                or typed != {"expected": 1, "passed": 1, "failed": 0, "skipped": 0}
                or not re.fullmatch(r"[0-9a-f]{64}", proof.get("browser_assets", {}).get("manifest_sha256", ""))):
            raise RuntimeError("platform browser witnesses are missing or incomplete")
        if plan.get("requires_cli_executable"):
            bridge = proof.get("browser_current_repro_bridge", {})
            fields = {"source_sha", "executable_sha256", "positive_replay", "time_omission_rejected",
                      "base_position", "final_position", "processed_attempts", "snapshot_digest", "negative_divergence_position"}
            if (set(bridge) != fields or bridge.get("positive_replay") is not True or bridge.get("time_omission_rejected") is not True
                    or bridge.get("source_sha") != native["identity"]["product_sha"]
                    or bridge.get("executable_sha256") != native["cli"]["sha256"]):
                raise RuntimeError("platform current repro bridge is missing or mismatched")
            for field in ("base_position", "final_position", "processed_attempts", "negative_divergence_position"):
                if type(bridge[field]) is not int or not 0 <= bridge[field] <= (1 << 53) - 1:
                    raise RuntimeError("platform current repro bridge positions are unsafe")
            if (not 1 < bridge["processed_attempts"] <= 256
                    or bridge["final_position"] - bridge["base_position"] != bridge["processed_attempts"]
                    or not bridge["base_position"] < bridge["negative_divergence_position"] < bridge["final_position"]
                    or not isinstance(bridge["snapshot_digest"], str)
                    or not re.fullmatch(r"blake3-v1:[0-9a-f]{64}", bridge["snapshot_digest"])):
                raise RuntimeError("platform current repro bridge causal evidence is inconsistent")


def platform(feedback):
    source = Path(os.environ["M9E_PHASE_DIR"])
    native_hash = os.environ["M9E_NATIVE_MANIFEST_SHA256"]
    native = read_bounded(source / "proof/native-a.json", native_hash)
    expected = identity(feedback)
    validate_native(native, expected)
    if native["lane"] != "a":
        raise RuntimeError("platform requires lane A's candidate CLI and native parity")
    summary = {"version": 1, "phase": "platform", "status": "failed", "qualification": "pending",
               "identity": expected, "product_sha": expected["product_sha"],
               "native_manifest_sha256": native_hash, "plan_sha256": native["plan_sha256"],
               "plan": native["plan"], "native_timer_parity_digest": native["native_timer_parity_digest"],
               "timing_ms": feedback.TIMINGS}
    summary["cli_executable"] = transfer_cli(native, source / "cli")
    if native["plan"]["requires_wasm"]:
        write_bounded(feedback.COMPACT / "summary.json", {"phase": "platform", "status": "in_progress",
                      "qualification": "unfinished", "product_sha": expected["product_sha"], "active_phase": "wasm"})
        feedback.wasm_checks(native["plan"], summary)
    if native["plan"]["requires_browser"]:
        write_bounded(feedback.COMPACT / "summary.json", {"phase": "platform", "status": "in_progress",
                      "qualification": "unfinished", "product_sha": expected["product_sha"], "active_phase": "browser"})
        # browser_checks rehashes this exact relocated binding before the bridge.
        feedback.browser_checks(summary)
    summary["status"] = "passed"
    validate_platform(summary, native, native_hash)
    proof_hash = write_bounded(source / "platform/platform.json", summary)
    output("platform_manifest_sha256", proof_hash)
    return summary


def aggregate(feedback):
    if any(os.environ.get(key) != "success" for key in ("M9E_NATIVE_A_RESULT", "M9E_NATIVE_B_RESULT", "M9E_PLATFORM_RESULT")):
        raise RuntimeError("required native/platform job is absent, failed, skipped or cancelled")
    directory = Path(os.environ["M9E_PHASE_DIR"])
    native_hash = os.environ["M9E_NATIVE_MANIFEST_SHA256"]
    native = read_bounded(directory / "proof/native-a.json", native_hash)
    other_hash = os.environ["M9E_NATIVE_B_MANIFEST_SHA256"]
    other = read_bounded(directory / "proof/native-b.json", other_hash)
    expected = identity(feedback)
    validate_native(native, expected)
    validate_native(other, expected)
    if (native["lane"] != "a" or other["lane"] != "b" or native["plan_sha256"] != other["plan_sha256"]
            or native["inventory"] != other["inventory"] or native["inventory_sha256"] != other["inventory_sha256"]):
        raise RuntimeError("native lanes have different global plans, inventory or ownership")
    actual = native["assigned_targets"] + other["assigned_targets"]
    required = [[item["crate"], item["target"]] for item in native["inventory"]]
    if sorted(actual) != sorted(required):
        raise RuntimeError("native target union is incomplete or overlapping")
    totals = {"selected": native["tests"]["selected"], **{
        key: native["tests"][key] + other["tests"][key] for key in ("executed", "passed", "failed", "skipped")}}
    if not totals["selected"] == totals["executed"] == totals["passed"] or totals["failed"] or totals["skipped"]:
        raise RuntimeError("native lane union test counts disagree")
    result = read_bounded(directory / "platform/platform.json", os.environ["M9E_PLATFORM_MANIFEST_SHA256"])
    validate_platform(result, native, native_hash)
    return {"phase": "aggregate", "status": "passed", "qualification": "passed",
            "product_sha": native["identity"]["product_sha"], "identity": native["identity"],
            "native_manifest_sha256": native_hash,
            "native_b_manifest_sha256": other_hash, "inventory_sha256": native["inventory_sha256"],
            "plan_sha256": native["plan_sha256"], "content_manifest_hash": native["identity"]["files"]["content"],
            "cli_executable": native["cli"],
            "worker_executables": {"a": native.get("worker"), "b": other.get("worker")},
            "native_target_timing_ms": {**native.get("native_target_timing_ms", {}), **other.get("native_target_timing_ms", {})},
            "platform_manifest_sha256": os.environ["M9E_PLATFORM_MANIFEST_SHA256"],
            "tests": totals, "selected_test_ids_sha256": native["selected_test_ids_sha256"],
            "native_timer_parity_digest": native["native_timer_parity_digest"],
            "required_native_target_counts": native["required_native_target_counts"],
            **{key: result[key] for key in ("wasm_tests", "browser_tests", "browser_assets", "browser_current_repro_bridge", "browser_worker_assets", "browser_worker_tests", "browser_worker_codec", "browser_rtc_assets", "browser_rtc_tests", "current_storage_node", "current_storage_browser", "worker_storage_assets", "worker_storage_tests", "title_storage_assets", "title_storage_oracle", "title_storage_tests") if key in result},
            **{key: native[key] for key in ("timer_mutant", "replica_mutant", "ledger_mutant") if key in native}}


def compact_rtc_evidence(compact, full_hash):
    # Full platform/aggregate proofs retain every field and stay <=64KiB.
    # Avoid duplicating optional new RTC detail in the existing16KiB summary.
    for key in ("browser_rtc_assets", "browser_rtc_tests"):
        if len(encoded(compact)) <= 16000:
            break
        if key in compact:
            compact[key] = {"file": "phase-summary.json", "sha256": full_hash}


def compact_storage_evidence(compact, full_hash):
    # The full platform/aggregate proof keeps exact adapter evidence <=64KiB.
    # Only new storage details may become references after timing compaction.
    for key in ("current_storage_browser", "current_storage_node"):
        if len(encoded(compact)) <= 16000:
            break
        if key in compact:
            compact[key] = {"file": "phase-summary.json", "sha256": full_hash}


def main():
    import m9e_feedback as feedback
    feedback.FULL.mkdir(parents=True, exist_ok=True)
    feedback.COMPACT.mkdir(parents=True, exist_ok=True)
    phase = os.environ["M9E_PHASE"]
    summary = {"phase": phase, "status": "in_progress", "qualification": "unfinished",
               "product_sha": os.environ.get("GITHUB_SHA")}
    write_bounded(feedback.COMPACT / "summary.json", summary)
    code = 1
    try:
        if phase not in {"platform", "aggregate"}:
            raise RuntimeError("invalid phase entry")
        summary = platform(feedback) if phase == "platform" else aggregate(feedback)
        code = 0
    except Exception as error:
        summary.update({"status": "failed", "qualification": "unfinished", "first_failure": str(error)[:4096]})
        excerpt = (str(error)[:4096] + "\n").encode()
        match = re.search(r"see ([\w.-]+\.log)", str(error))
        if match:
            path = feedback.FULL / match[1]
            if path.is_file():
                with path.open("rb") as stream:
                    if path.stat().st_size > 12000:
                        stream.seek(-12000, 2)
                        excerpt += b"[TRUNCATED: full log retained remotely]\n"
                    excerpt += stream.read(12000)
        (feedback.COMPACT / "failure.txt").write_bytes(excerpt[:48000])
    finally:
        # Keep full platform logs with their owning job. The final result links
        # bounded proofs, not a duplicate archive of native diagnostics.
        full_hash = write_bounded(feedback.FULL / "phase-summary.json", summary)
        compact = {key: summary[key] for key in (
            "phase", "status", "qualification", "product_sha", "identity", "tests",
            "required_native_target_counts", "selected_test_ids_sha256", "inventory_sha256", "plan_sha256",
            "native_manifest_sha256", "native_b_manifest_sha256", "platform_manifest_sha256",
            "native_timer_parity_digest", "wasm_tests", "browser_tests", "browser_assets", "browser_current_repro_bridge", "browser_worker_assets", "browser_worker_tests", "browser_worker_codec", "browser_rtc_assets", "browser_rtc_tests", "current_storage_node", "current_storage_browser", "worker_storage_assets", "worker_storage_tests", "title_storage_assets", "title_storage_oracle", "title_storage_tests",
            "cli_executable", "worker_executables", "content_manifest_hash", "native_target_timing_ms", "timer_mutant", "replica_mutant", "ledger_mutant") if key in summary}
        compact.update({"phase_summary_sha256": full_hash, "timing_ms": feedback.TIMINGS})
        if "first_failure" in summary:
            compact["first_failure"] = summary["first_failure"]
        if len(encoded(compact)) > 16000:
            for key in ("native_target_timing_ms", "timing_ms"):
                if key in compact:
                    compact[key] = {"file": "phase-summary.json", "sha256": full_hash}
        compact_rtc_evidence(compact, full_hash)
        compact_storage_evidence(compact, full_hash)
        import m9e_worker_storage as composition
        composition.compact(compact, full_hash, encoded)
        import m9e_title_storage as retirement
        retirement.compact(compact, full_hash, encoded)
        if len(encoded(compact)) > 16000:
            raise RuntimeError("aggregate compact evidence exceeds 16 KiB; cannot claim bounded qualification")
        write_bounded(feedback.COMPACT / "summary.json", compact)
        print(json.dumps(compact), flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
