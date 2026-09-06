"""Current owner policy and remote receipt oracle. No product codec is imported.

Full receipt bytes are remote diagnostics only. Pending snapshots, both runtime
ledgers and send/receive equality remain source-bound browser producer evidence.
"""

import base64
import contextlib
import csv
import hashlib
import importlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile


HELPER_PATH = "scripts/ci/m9e_current_proposal.py"
OWNER_PATHS = [
    "rust/crates/er-kernel/src/current_proposal_v7.rs",
    "rust/crates/er-kernel/src/game_kernel_v7.rs",
    "rust/crates/er-kernel/src/lib.rs",
    "rust/crates/er-kernel/src/snapshot_v7.rs",
    "rust/crates/er-kernel/tests/m9e_current_proposal_v7.rs",
    "rust/crates/er-kernel/tests/m9e_coop_v7.rs",
    "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
    "test/browser/rust-browser/m9e-v7-worker-rtc.spec.ts",
    "test/browser/rust-browser/m9e-v7-corrective.spec.ts",
]
OWNER_TRIGGERS = [OWNER_PATHS[0], OWNER_PATHS[4]]
TARGET = "er-kernel:m9e_current_proposal_v7"
NATIVE_IDS = ["current_proposal_publication_receipt_and_snapshot_conserve_ownership",
              "current_proposal_rejection_duplicate_and_terminal_are_transactional"]
OWNER_FIELDS = {"receipt_kind", "receipt_schema_version", "inner_material_sha256", "inner_material_bytes",
                "receipt_proposal_digest", "receipt_material_digest", "receipt_material_fingerprint",
                "exact_owner_retired", "owner_before_kind", "owner_after_kind",
                "owner_publication_replay_sequence", "owner_snapshot_sha256"}
RECEIPT_NAME = "m9e-current-rtc-exact-receipt"
RECEIPT_LIMIT = 1 << 20
PROPOSAL_LIMIT = 16 << 10
MATERIAL_LIMIT = 448 << 10
SAFE = (1 << 53) - 1
WHEEL = {
    "version": "1.0.8",
    "filename": "blake3-1.0.8-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "url": "https://files.pythonhosted.org/packages/5b/94/eafaa5cdddadc0c9c603a6a6d8339433475e1a9f60c8bb9c2eed2d8736b6/blake3-1.0.8-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
    "bytes": 388001,
    "sha256": "504d1399b7fb91dfe5c25722d2807990493185faa1917456455480c36867adb5",
}
# Official BLAKE3 1.8.2 test_vectors/test_vectors.json; input repeats 0..250.
VECTORS = {0: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
           3: "e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f5b",
           2048: "e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a9a"}


def require(condition, message):
    if not condition:
        raise RuntimeError("current owner: " + message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def safe(value, minimum=0):
    return type(value) is int and minimum <= value <= SAFE


def digest_value(value, prefix=""):
    return isinstance(value, str) and re.fullmatch(re.escape(prefix) + r"[0-9a-f]{64}", value) is not None


def exact(value, keys, label):
    require(isinstance(value, dict) and set(value) == set(keys), label + " fields")


def parse(data, maximum, *, canonical_required=True):
    require(isinstance(data, bytes) and 0 < len(data) <= maximum, "JSON byte bound")
    def pairs(items):
        value = {}
        for key, child in items:
            require(key not in value, "duplicate JSON key")
            value[key] = child
        return value
    def reject_number(value):
        raise RuntimeError("current owner: non-integral JSON number: " + value[:32])
    value = json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=pairs,
                       parse_float=reject_number, parse_constant=reject_number)
    def visit(item, depth=0):
        require(depth <= 128, "JSON nesting bound")
        if isinstance(item, dict):
            for key, child in item.items():
                key.encode("utf-8", errors="strict")
                visit(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                visit(child, depth + 1)
        elif type(item) is int:
            require(-SAFE <= item <= SAFE, "unsafe JSON integer")
        elif isinstance(item, str):
            item.encode("utf-8", errors="strict")
        else:
            require(item is None or type(item) is bool, "unsupported JSON form")
    visit(value)
    if canonical_required:
        require(canonical(value) == data, "noncanonical JSON")
    return value


def bounded_file(path, root, maximum, *, allow_empty=False):
    path, root = Path(path), Path(root).resolve(strict=True)
    require(path.is_absolute(), "absolute contained file required")
    require(path.resolve(strict=True).is_relative_to(root), "file escapes root")
    for component in [path, *path.parents]:
        require(not component.is_symlink(), "symlink component")
        if component == root:
            break
    before = path.stat()
    require(stat.S_ISREG(before.st_mode) and (0 if allow_empty else 1) <= before.st_size <= maximum,
            "regular file byte bound: " + path.relative_to(root).as_posix())
    with path.open("rb") as stream:
        data = stream.read(maximum + 1)
    after = path.stat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            and len(data) == before.st_size, "file changed during read")
    return data


def source_binding(root, product_sha):
    require(isinstance(product_sha, str) and re.fullmatch(r"[0-9a-f]{40}", product_sha), "source SHA")
    root = Path(root).resolve(strict=True)
    return {"source_sha": product_sha, "source_hashes": {
        name: sha(bounded_file(root / name, root, 2 << 20)) for name in OWNER_PATHS}}


def validate_binding(binding, product_sha):
    exact(binding, {"source_sha", "source_hashes"}, "source binding")
    require(binding["source_sha"] == product_sha, "candidate source mismatch")
    exact(binding["source_hashes"], OWNER_PATHS, "source inventory")
    require(all(digest_value(value) for value in binding["source_hashes"].values()), "source hash")


def focus_policy(config, changes):
    policy = config.get("current_proposal_focus", {})
    if policy:
        require(policy == {"paths": OWNER_PATHS, "trigger_paths": OWNER_TRIGGERS,
                           "exact_test_ids": {TARGET: NATIVE_IDS}}, "policy identities")
    exclusive = any(path in OWNER_TRIGGERS for path in changes)
    if exclusive:
        require(bool(policy) and all(path in OWNER_PATHS for path in changes), "exclusive mixed source scope")
    return exclusive


def merge_targets(*mappings):
    result = {}
    for mapping in mappings:
        for crate, targets in mapping.items():
            result.setdefault(crate, [])
            for target in targets:
                if target not in result[crate]:
                    result[crate].append(target)
    return result


def selected_owner(packages, scope):
    return "er-kernel" in packages and (scope is None or any(
        item in scope.get("er-kernel", []) for item in ("*", "m9e_current_proposal_v7")))


def validate_obligations(plan, inventory, product_sha):
    actual = [item for item in inventory if item["crate"] == "er-kernel" and item["target"] == "m9e_current_proposal_v7"]
    required = plan.get("requires_current_proposal") is True
    require(not actual or required, "selected native owner omitted its RTC obligation")
    if not required:
        require(plan.get("owner_source_binding") is None, "unrequested owner binding")
        return
    validate_binding(plan.get("owner_source_binding"), product_sha)
    require(all(plan.get(key) is True for key in ("requires_browser_rtc", "requires_browser_worker", "requires_browser",
                                                 "requires_wasm", "requires_cli_executable")), "missing causal platform obligation")
    require(plan.get("required_native_test_ids", {}).get(TARGET) == NATIVE_IDS, "exact native IDs omitted")
    require("m9e_current_proposal_v7" in plan.get("required_native_targets", {}).get("er-kernel", []), "native target omitted")
    require(len(actual) == 1 and sorted(actual[0]["ids"]) == sorted(NATIVE_IDS), "actual native owner IDs")


def receipt_attachment(attachments, root, positive):
    names = [item.get("name") for item in attachments]
    expected = ["m9e-current-rtc-positive", RECEIPT_NAME] if positive else ["m9e-current-rtc-negative"]
    require(sorted(names) == sorted(expected), "receipt attachment cardinality/test placement")
    compact = next(item for item in attachments if item["name"] != RECEIPT_NAME)
    require(compact.get("contentType") == "application/json", "compact attachment MIME")
    if not positive:
        return compact, None
    attachment = next(item for item in attachments if item["name"] == RECEIPT_NAME)
    require(attachment.get("contentType") == "application/octet-stream", "receipt MIME")
    if "body" in attachment and "path" not in attachment:
        body = attachment["body"]
        require(isinstance(body, str) and 0 < len(body) <= 4 * ((RECEIPT_LIMIT + 2) // 3), "receipt base64 bound")
        data = base64.b64decode(body, validate=True)
    elif "path" in attachment and "body" not in attachment:
        path = Path(attachment["path"])
        path = path if path.is_absolute() else Path(root) / path
        data = bounded_file(path, Path(root) / "test-results/rust-browser", RECEIPT_LIMIT)
    else:
        raise RuntimeError("current owner: receipt requires one body or path")
    require(0 < len(data) <= RECEIPT_LIMIT, "decoded receipt bound")
    return compact, data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("current owner: wheel redirect forbidden")


CONTEXT_FIELDS = {"sessionId", "runId", "sessionEpoch", "seatMapId", "membershipRevision",
                  "senderSeatId", "authoritySeatId", "connectionGeneration"}
MATERIAL_FIELDS = {"schema_version", "domain", "operation_id", "authority_seat", "authority_revision",
                   "content_identity", "accepted_action", "before_digest", "after_digest", "mutations",
                   "rng_audit", "after_state", "next_control", "presentation", "platform_effects"}


def fixture_identity(directory, assets):
    fixtures = []
    for name in ("coop-authority-snapshot.json", "coop-replica-snapshot.json"):
        data = bounded_file(Path(directory) / name, directory, 32 << 20)
        require(assets.get(name) == {"bytes": len(data), "sha256": sha(data)}, "fixture asset bytes/hash")
        fixtures.append(parse(data, 32 << 20, canonical_required=False))
    authority, replica = fixtures
    frames = []
    for snapshot, role in zip(fixtures, ("AUTHORITY", "REPLICA")):
        protocol = snapshot["protocol"]
        require(protocol["role"] == role, "fixture endpoint role")
        frame = protocol["frame_context"]["context"]
        exact(frame, CONTEXT_FIELDS, "fixture frame context")
        require(safe(frame["connectionGeneration"]) and frame["connectionGeneration"] == 1, "fixture generation")
        require(all(safe(frame[key]) for key in ("sessionEpoch", "membershipRevision", "senderSeatId", "authoritySeatId")), "fixture context counters")
        require(all(isinstance(frame[key], str) and 0 < len(frame[key].encode()) <= 4096
                    for key in ("sessionId", "runId", "seatMapId")), "fixture opaque context")
        require(len(protocol["connections"]) == 1, "fixture exact pair")
        frames.append(frame)
    left, right = frames
    require(left["senderSeatId"] == left["authoritySeatId"] and right["senderSeatId"] != left["senderSeatId"], "fixture authority topology")
    require(all(left[key] == right[key] for key in CONTEXT_FIELDS - {"senderSeatId"}), "fixture stable pair identity")
    require(authority["protocol"]["connections"][0]["peer_seat"] == right["senderSeatId"]
            and replica["protocol"]["connections"][0]["peer_seat"] == left["senderSeatId"], "fixture peer topology")
    require(authority["lifecycle"]["kind"] == replica["lifecycle"]["kind"] == "ACTIVE"
            and authority["lifecycle"]["value"] == replica["lifecycle"]["value"], "fixture shared initial state")
    state = authority["lifecycle"]["value"]
    run_id = state["active_run"]["run_id"]
    require(safe(run_id), "fixture numeric game run")
    return {"authority_context": left, "replica_context": right, "content_identity": state["content_identity"],
            "game_run_id": run_id, "initial_turn": state["active_run"]["battle"]["turn"]}


def revalidate_cohort(directory, assets):
    exact(assets, {"er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json",
                   "coop-authority-snapshot.json", "coop-replica-snapshot.json"}, "cohort asset inventory")
    for name, metadata in assets.items():
        exact(metadata, {"bytes", "sha256"}, "cohort asset metadata")
        require(safe(metadata["bytes"], 1) and digest_value(metadata["sha256"]), "cohort asset identity")
        data = bounded_file(Path(directory) / name, directory, (4 if name.endswith(".js") else 32) << 20)
        require(len(data) == metadata["bytes"] and sha(data) == metadata["sha256"], "cohort asset changed")


def decode_hex(value, maximum):
    require(isinstance(value, str) and 0 < len(value) <= maximum * 2
            and re.fullmatch(r"(?:[0-9a-f]{2})+", value), "canonical bounded hex")
    return bytes.fromhex(value)


def validate_owner_fields(positive):
    require(OWNER_FIELDS <= set(positive), "missing owner producer fields")
    require(positive["receipt_kind"] == "CURRENT_PROPOSAL_MATERIAL_RECEIPT"
            and type(positive["receipt_schema_version"]) is int and positive["receipt_schema_version"] == 1
            and positive["exact_owner_retired"] is True and positive["owner_before_kind"] == "PENDING"
            and positive["owner_after_kind"] is None and safe(positive["owner_publication_replay_sequence"], 1), "owner producer transition")
    require(digest_value(positive["owner_snapshot_sha256"]) and digest_value(positive["inner_material_sha256"])
            and safe(positive["inner_material_bytes"], 1) and positive["inner_material_bytes"] <= MATERIAL_LIMIT, "owner producer byte identity")
    for key, prefix in (("receipt_proposal_digest", "sha256-json-bytes-v1:"),
                        ("receipt_material_digest", "sha256-json-bytes-v1:"), ("receipt_material_fingerprint", "blake3-v1:")):
        require(digest_value(positive[key], prefix), "owner producer digest")


def receipt_oracle(data, positive, expected, primitive, provider, binding, helper_hash):
    validate_owner_fields(positive)
    wire = parse(data, RECEIPT_LIMIT)
    exact(wire, {"kind", "schema_version", "proposal_hex", "proposal_digest", "authority_context",
                 "material_hex", "material_digest", "material_fingerprint"}, "receipt")
    require(wire["kind"] == "CURRENT_PROPOSAL_MATERIAL_RECEIPT" and type(wire["schema_version"]) is int
            and wire["schema_version"] == 1, "receipt schema")
    exact(wire["authority_context"], CONTEXT_FIELDS, "receipt authority context")
    require(canonical(wire["authority_context"]) == canonical(expected["authority_context"]), "receipt fixture authority")
    proposal_bytes = decode_hex(wire["proposal_hex"], PROPOSAL_LIMIT)
    inner_bytes = decode_hex(wire["material_hex"], MATERIAL_LIMIT)
    proposal, material = parse(proposal_bytes, PROPOSAL_LIMIT), parse(inner_bytes, MATERIAL_LIMIT)
    exact(proposal, {"schema_version", "sender_seat", "connection_generation", "proposal"}, "proposal envelope")
    require(type(proposal["schema_version"]) is int and proposal["schema_version"] == 2 and safe(proposal["sender_seat"])
            and type(proposal["connection_generation"]) is int and proposal["connection_generation"] == 1
            and proposal["sender_seat"] == expected["replica_context"]["senderSeatId"], "proposal endpoint identity")
    command = proposal["proposal"]
    exact(command, {"schema_version", "context", "action"}, "proposal command")
    require(type(command["schema_version"]) is int and command["schema_version"] == 1, "proposal command schema")
    exact(command["action"], {"kind", "action"}, "RTC game action")
    require(command["action"]["kind"] == "BATTLE", "RTC natural battle action")
    move = command["action"]["action"]
    exact(move, {"kind", "actor", "move_slot"}, "RTC move action")
    require(move["kind"] == "SELECT_MOVE" and safe(move["actor"]) and safe(move["move_slot"])
            and move["move_slot"] < 4, "RTC move action identity")
    context = command["context"]
    exact(context, {"operation_id", "authority_seat", "authority_revision", "menu_instance"}, "proposal context")
    require(safe(context["authority_revision"], 1) and safe(context["authority_seat"]) and safe(context["menu_instance"])
            and isinstance(context["operation_id"], str) and 0 < len(context["operation_id"].encode()) <= 1024, "proposal context bounds")
    exact(material, {"kind", "value"}, "inner material")
    require(material["kind"] == "BATTLE_TURN", "RTC natural turn material kind")
    value = material["value"]
    exact(value, MATERIAL_FIELDS, "inner transition")
    require(type(value["schema_version"]) is int and value["schema_version"] == 6
            and value["domain"] == "BATTLE_TURN", "inner schema/domain")
    require(all(canonical(value[key]) == canonical(context[key]) for key in ("operation_id", "authority_seat", "authority_revision"))
            and value["authority_seat"] == expected["authority_context"]["authoritySeatId"]
            and value["accepted_action"] == command["action"], "material/proposal identity/action")
    state = value["after_state"]
    exact(state, {"schema_version", "content_identity", "identities", "profile", "active_run"}, "after state")
    require(type(state["schema_version"]) is int and state["schema_version"] == 6
            and canonical(value["content_identity"]) == canonical(state["content_identity"]) == canonical(expected["content_identity"])
            and safe(state["active_run"]["run_id"]) and state["active_run"]["run_id"] == expected["game_run_id"], "content/numeric run identity")
    require(safe(value["authority_revision"], 1) and digest_value(value["before_digest"], "blake3-v1:"), "material frontier")
    for key, maximum in (("mutations", 4096), ("rng_audit", 4096), ("presentation", 4096), ("platform_effects", 256)):
        require(isinstance(value[key], list) and len(value[key]) <= maximum, "material vector bound")
    # Hash exact canonical numeric byte vectors, not raw byte strings.
    proposal_digest = "sha256-json-bytes-v1:" + sha(canonical(list(proposal_bytes)))
    material_digest = "sha256-json-bytes-v1:" + sha(canonical(list(inner_bytes)))
    fingerprint = "blake3-v1:" + primitive(canonical(list(inner_bytes)))
    after_digest = "blake3-v1:" + primitive(canonical(state))
    require(wire["proposal_digest"] == proposal_digest and wire["material_digest"] == material_digest
            and wire["material_fingerprint"] == fingerprint and value["after_digest"] == after_digest, "independent receipt digests")
    observed = {"proposal_sha256": sha(proposal_bytes), "proposal_bytes": len(proposal_bytes),
                "material_sha256": sha(data), "material_bytes": len(data), "inner_material_sha256": sha(inner_bytes),
                "inner_material_bytes": len(inner_bytes), "receipt_proposal_digest": proposal_digest,
                "receipt_material_digest": material_digest, "receipt_material_fingerprint": fingerprint,
                "proposal_operation_id": value["operation_id"], "material_revision": value["authority_revision"],
                "material_after_digest": after_digest, "initial_turn": expected["initial_turn"],
                "final_turn": state["active_run"]["battle"]["turn"], "presentation_count": len(value["presentation"])}
    require(all(positive.get(key) == child for key, child in observed.items()), "receipt/browser producer binding")
    projection = {"schema_version": 1, "helper_sha256": helper_hash, "owner_binding_sha256": sha(canonical(binding)),
                  "provider": provider, "observed": observed, "before_digest": value["before_digest"],
                  "authority_context_sha256": sha(canonical(expected["authority_context"])),
                  "content_identity_sha256": sha(canonical(expected["content_identity"])),
                  "opaque_run_id_sha256": sha(canonical(expected["authority_context"]["runId"])),
                  "game_run_id": expected["game_run_id"], "pending_snapshot_evidence": "source-bound-browser-producer",
                  "runtime_ledger_evidence": "source-bound-browser-producer", "independent_full_snapshot": False}
    validate_projection(projection, positive, binding, helper_hash)
    return projection


def validate_projection(projection, positive, binding, helper_hash):
    exact(projection, {"schema_version", "helper_sha256", "owner_binding_sha256", "provider", "observed", "before_digest",
                       "authority_context_sha256", "content_identity_sha256", "opaque_run_id_sha256", "game_run_id",
                       "pending_snapshot_evidence", "runtime_ledger_evidence", "independent_full_snapshot"}, "receipt projection")
    require(len(canonical(projection)) <= 4096, "receipt projection bound")
    validate_owner_fields(positive)
    require(projection["schema_version"] == 1 and type(projection["schema_version"]) is int
            and projection["helper_sha256"] == helper_hash and digest_value(helper_hash)
            and projection["owner_binding_sha256"] == sha(canonical(binding)), "receipt projection source provenance")
    expected_provider = {"wheel": dict(WHEEL), "platform": "cp312-linux-x86_64", "vectors": list(VECTORS),
                         "verified_import": True, "download_limit": 512 << 10, "install_timeout": 60, "total_timeout": 120}
    require(canonical(projection["provider"]) == canonical(expected_provider), "receipt provider provenance")
    observed = projection["observed"]
    fields = {"proposal_sha256", "proposal_bytes", "material_sha256", "material_bytes", "inner_material_sha256",
              "inner_material_bytes", "receipt_proposal_digest", "receipt_material_digest", "receipt_material_fingerprint",
              "proposal_operation_id", "material_revision", "material_after_digest", "initial_turn", "final_turn", "presentation_count"}
    exact(observed, fields, "receipt observed projection")
    require(all(canonical(observed[key]) == canonical(positive[key]) for key in fields), "receipt projection producer mismatch")
    require(digest_value(projection["before_digest"], "blake3-v1:") and safe(projection["game_run_id"])
            and all(digest_value(projection[key]) for key in ("authority_context_sha256", "content_identity_sha256", "opaque_run_id_sha256")), "receipt projection identity hashes")
    require(projection["pending_snapshot_evidence"] == projection["runtime_ledger_evidence"] == "source-bound-browser-producer"
            and projection["independent_full_snapshot"] is False, "unsupported independent snapshot/ledger claim")


def legacy_rtc_view(tests, binding, helper_hash):
    """Validate new strict projection, then apply every existing RTC assertion."""
    exact(tests, {"expected", "passed", "failed", "skipped", "selected_test_ids", "positive", "negative", "receipt_oracle"}, "owner RTC proof")
    validate_projection(tests["receipt_oracle"], tests["positive"], binding, helper_hash)
    return {key: ({field: value for field, value in item.items() if field not in OWNER_FIELDS} if key == "positive" else item)
            for key, item in tests.items() if key != "receipt_oracle"}


@contextlib.contextmanager
def deadline(seconds):
    """Linux main-thread wall deadline includes blocking DNS, TLS and reads."""
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    def expired(signum, frame):
        raise TimeoutError("current owner: provider wall deadline")
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, min(seconds, previous_timer[0]) if previous_timer[0] else seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, previous_timer[0] - (time.monotonic() - started)), previous_timer[1])


def prepare_provider(required, runner_temp, log_directory):
    """One bounded remote-only install; called only by required owner platform."""
    if not required:
        return None
    require(os.environ.get("GITHUB_ACTIONS") == "true" and
            re.fullmatch(r"[1-9][0-9]*", os.environ.get("GITHUB_RUN_ID", "")), "remote runner identity")
    require(sys.implementation.name == "cpython" and sys.version_info[:2] == (3, 12)
            and platform.system() == "Linux" and platform.machine() == "x86_64", "wheel ABI/platform")
    require(not any(name == "blake3" or name.startswith("blake3.") for name in sys.modules), "preloaded BLAKE3 ambiguity")
    with deadline(120):
        root = Path(runner_temp).resolve(strict=True)
        work = Path(tempfile.mkdtemp(prefix="m9e-owner-blake3-", dir=root))
        try:
            require(work.resolve(strict=True).parent == root and not work.is_symlink(), "provider target containment")
            return install_provider(work, log_directory)
        finally:
            # Linux keeps the verified loaded extension mapped after unlink.
            # Delete only this fresh owned directory; full pip diagnostics remain.
            require(work.parent == root and work.resolve(strict=True).parent == root
                    and not work.is_symlink(), "provider cleanup containment")
            shutil.rmtree(work)


def install_provider(work, log_directory):
    started = time.monotonic()
    def remaining(limit):
        value = min(limit, 120 - (time.monotonic() - started))
        require(value > 0, "provider total deadline")
        return value
    opener = urllib.request.build_opener(NoRedirect())
    wheel = work / WHEEL["filename"]
    size = 0
    with deadline(30), opener.open(WHEEL["url"], timeout=remaining(30)) as response, wheel.open("xb") as stream:
        require(response.geturl() == WHEEL["url"] and response.status == 200, "wheel origin/status")
        while True:
            require(time.monotonic() - started <= 30, "wheel download deadline")
            block = response.read(min(65536, (512 << 10) + 1 - size))
            if not block:
                break
            size += len(block)
            require(size <= 512 << 10, "wheel download bound")
            stream.write(block)
    require(size == WHEEL["bytes"] and sha(wheel.read_bytes()) == WHEEL["sha256"], "wheel byte/hash pin")
    members = {}
    with zipfile.ZipFile(wheel) as archive:
        total = 0
        for info in archive.infolist():
            path = PurePosixPath(info.filename)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in info.filename
                    and info.filename not in members and not stat.S_ISLNK(info.external_attr >> 16), "wheel member containment")
            total += info.file_size
            require(total <= 16 << 20, "wheel uncompressed bound")
            if not info.is_dir():
                members[info.filename] = archive.read(info)
        record_name = "blake3-1.0.8.dist-info/RECORD"
        require(record_name in members, "wheel RECORD missing")
        records = list(csv.reader(io.StringIO(members[record_name].decode("utf-8"))))
        require({row[0] for row in records} == set(members) and len(records) == len(members), "wheel RECORD inventory")
        for name, hash_text, length in records:
            if name == record_name:
                require(hash_text == length == "", "wheel RECORD self entry")
            else:
                expected = "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(members[name]).digest()).rstrip(b"=").decode()
                require(hash_text == expected and length == str(len(members[name])), "wheel RECORD digest")
    target = work / "site"
    target.mkdir()
    log = Path(log_directory) / "owner-blake3-install.log"
    with log.open("wb") as stream:
        completed = subprocess.run([sys.executable, "-m", "pip", "--isolated", "install", "--no-deps", "--no-index",
                                    "--no-compile", "--disable-pip-version-check", "--target", str(target), str(wheel)],
                                   stdout=stream, stderr=subprocess.STDOUT, timeout=remaining(60), check=False)
    require(completed.returncode == 0, "pinned wheel install failed")
    for name, data in members.items():
        if name.startswith("blake3/"):
            # Wheels may contain empty package markers (for example py.typed).
            # Only the exact hash-pinned, RECORD-verified member permits emptiness.
            require(bounded_file(target / name, target, 16 << 20, allow_empty=not data) == data,
                    "installed provider differs from verified wheel")
    require(not any(name == "blake3" or name.startswith("blake3.") for name in sys.modules), "late preloaded BLAKE3 ambiguity")
    previous = list(sys.path)
    try:
        sys.path.insert(0, str(target))
        importlib.invalidate_caches()
        module = importlib.import_module("blake3")
    finally:
        sys.path[:] = previous
    require(getattr(module, "__version__", None) == WHEEL["version"], "imported provider version")
    loaded = [item for name, item in sys.modules.items() if name == "blake3" or name.startswith("blake3.")]
    require(any(str(getattr(item, "__file__", "")).endswith(".so") for item in loaded), "native provider absent")
    for item in loaded:
        path = Path(getattr(item, "__file__", ""))
        data = bounded_file(path, target, 16 << 20)
        require(members.get(path.relative_to(target).as_posix()) == data, "import path or module bytes mismatch")
    primitive = lambda data: module.blake3(data).hexdigest()
    for length, expected in VECTORS.items():
        require(primitive(bytes(index % 251 for index in range(length))) == expected, "official primitive vector")
    remaining(120)
    return primitive, {"wheel": dict(WHEEL), "platform": "cp312-linux-x86_64", "vectors": list(VECTORS),
                       "verified_import": True, "download_limit": 512 << 10, "install_timeout": 60, "total_timeout": 120}
