"""Strict current release measurement records; no timing thresholds or allocator claims.

The caller must obtain host/content bindings from the actual candidate build and
fixture. Parsing a record alone does not qualify an executable or game semantics.
"""
import hashlib
import json
import re

SOURCE = "rust/crates/er-repro/tests/m9e_current_cost_probe.rs"
TARGET = ("er-repro", "m9e_current_cost_probe")
TEST_ID = "current_native_phase_costs_preserve_semantics"
PREFIX = b"M9E_CURRENT_COST_PROBE "
LINE_LIMIT = 8192
U64_MAX = (1 << 64) - 1
PHASES = ["fork", "snapshot", "validate", "observe", "canonical_encode_snapshot",
          "canonical_digest_snapshot", "blake3_preencoded_snapshot", "apply_effectful_raw_input",
          "recorder_append"]
CONTENT_PHASES = ["content_decode", "content_prepare_and_arc"]
CHECKPOINTS = ["title", "mode", "starter", "active"]
IDENTITY_FIELDS = ["oracle_sha", "bundle_hash", "battle_hash", "run_hash", "progression_hash",
                   "world_hash", "scenario_hash", "ai_hash", "bootstrap_hash", "presentation_hash",
                   "semantic_catalog_hash"]
LIMITATIONS = (
    "Wall time includes optimizer barriers, scheduling, internal validation/allocation and internal destruction. "
    "Setup, verification and final input/output teardown excluded. Warm-process fixed-order samples; no allocator "
    "or live-memory claims. API costs overlap and are not additive components. Digest includes canonical encoding; "
    "preencoded BLAKE3 isolates hashing. Recorder append excludes event apply and recorder construction; measures "
    "one accepted event on an empty tail, not rotation or accumulated history. Not transport or whole-run latency."
)


def fail(message):
    raise RuntimeError("current cost evidence: " + message)


def exact_fields(value, fields, label):
    if type(value) is not dict or set(value) != set(fields):
        fail(label + " fields disagree")


def integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        fail(label + " is not a bounded integer")


def lower_hex(value, digits, label):
    if type(value) is not str or re.fullmatch("[0-9a-f]{" + str(digits) + "}", value) is None:
        fail(label + " is not a lower hexadecimal digest")


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("duplicate JSON field " + key)
        result[key] = value
    return result


def content_binding(identity):
    exact_fields(identity, IDENTITY_FIELDS, "content identity")
    for name in IDENTITY_FIELDS:
        value = identity[name]
        prefix = {"battle_hash": "blake3-v3:", "bundle_hash": "blake3-v1:"}.get(name, "")
        if type(value) is not str or not value.startswith(prefix):
            fail("content hash prefix " + name)
        lower_hex(value[len(prefix):], 40 if name == "oracle_sha" else 64, name)


def phase_records(rows, names):
    if type(rows) is not list or len(rows) != len(names):
        fail("phase inventory length")
    for row, name in zip(rows, names, strict=True):
        exact_fields(row, ["phase", "min_ns", "median_ns"], "phase")
        if row["phase"] != name:
            fail("phase identity or order")
        integer(row["min_ns"], 0, U64_MAX, "minimum duration")
        integer(row["median_ns"], row["min_ns"], U64_MAX, "median duration")


def validate_measurements(value, *, architecture, operating_system, bundle_bytes, content_identity):
    exact_fields(value, ["schema_version", "probe", "warmups_per_phase", "samples_per_phase",
                         "debug_assertions", "architecture", "os", "bundle_bytes", "content_identity",
                         "content_phases", "checkpoints", "limitations"], "record")
    for name, expected in (("schema_version", 1), ("warmups_per_phase", 1), ("samples_per_phase", 3)):
        integer(value[name], expected, expected, name)
    if (value["probe"] != TEST_ID or value["debug_assertions"] is not False
            or architecture not in ("x86_64", "aarch64") or operating_system != "linux"
            or value["architecture"] != architecture or value["os"] != operating_system
            or value["limitations"] != LIMITATIONS):
        fail("probe/profile/host/limitations identity")
    integer(bundle_bytes, 1, U64_MAX, "bound bundle bytes")
    integer(value["bundle_bytes"], bundle_bytes, bundle_bytes, "bundle bytes")
    content_binding(content_identity)
    content_binding(value["content_identity"])
    if value["content_identity"] != content_identity:
        fail("actual bundle identity mismatch")
    phase_records(value["content_phases"], CONTENT_PHASES)
    rows = value["checkpoints"]
    if type(rows) is not list or len(rows) != len(CHECKPOINTS):
        fail("checkpoint inventory length")
    fields = ["checkpoint", "snapshot_digest", "snapshot_canonical_bytes", "observation_json_bytes",
              "menu_options", "event", "event_effects", "recorder_capsule_bytes", "recorder_maximum_bytes",
              "recorder_maximum_events", "phases"]
    for row, name in zip(rows, CHECKPOINTS, strict=True):
        exact_fields(row, fields, "checkpoint")
        if row["checkpoint"] != name:
            fail("checkpoint identity or order")
        lower_hex(row["snapshot_digest"], 64, "snapshot")
        for key in ("snapshot_canonical_bytes", "observation_json_bytes", "menu_options", "event_effects"):
            integer(row[key], 1, U64_MAX, key)
        integer(row["recorder_maximum_bytes"], 16_777_216, 16_777_216, "recorder byte cap")
        integer(row["recorder_maximum_events"], 4096, 4096, "recorder event cap")
        integer(row["recorder_capsule_bytes"], 1, row["recorder_maximum_bytes"], "recorder capsule")
        event = row["event"]
        exact_fields(event, ["kind", "input"], "event")
        exact_fields(event["input"], ["kind", "data"], "raw input")
        data = event["input"]["data"]
        exact_fields(data, ["code", "printable", "browser_repeat", "focus"], "raw key")
        exact_fields(data["code"], ["kind"], "key code")
        if (event["kind"] != "RAW_INPUT" or event["input"]["kind"] != "KEY_DOWN"
                or data["code"]["kind"] != ("ARROW_DOWN" if name == "active" else "SPACE")
                or data["printable"] is not False or data["browser_repeat"] is not False or data["focus"] != "GAME"):
            fail("actual checkpoint raw input differs")
        phase_records(row["phases"], PHASES)
    return value


def parse_line(raw, **binding):
    if (type(raw) is not bytes or not len(PREFIX) < len(raw) < LINE_LIMIT
            or not raw.startswith(PREFIX) or not raw.endswith(b"\n") or raw.count(b"\n") != 1
            or b"\r" in raw):
        fail("record framing or byte bound")
    try:
        text = raw[len(PREFIX):-1].decode("utf-8", errors="strict")
        value = json.loads(text, object_pairs_hook=strict_object,
                           parse_constant=lambda token: fail("non-finite JSON " + token))
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise RuntimeError("current cost evidence: invalid complete JSON record") from error
    return validate_measurements(value, **binding)


def validate_record(proof, **binding):
    exact_fields(proof, ["line", "bytes", "sha256"], "wire record")
    if type(proof["line"]) is not str:
        fail("wire line type")
    try:
        raw = proof["line"].encode("utf-8", errors="strict")
    except UnicodeError as error:
        raise RuntimeError("current cost evidence: invalid wire Unicode") from error
    integer(proof["bytes"], len(raw), len(raw), "wire bytes")
    lower_hex(proof["sha256"], 64, "wire SHA256")
    if hashlib.sha256(raw).hexdigest() != proof["sha256"]:
        fail("wire record hash mismatch")
    return parse_line(raw, **binding)
