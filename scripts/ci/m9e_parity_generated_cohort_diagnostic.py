"""Remote two-cohort report/preimage diagnostic; never updates the parity oracle."""
import copy
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-parity-generated-cohort"
FULL, COMPACT = REPORT / "diagnostics", REPORT / "compact"
STARTED_AT = None
DEADLINE = None
run_bounded = None
BASE = "f501695d69dd7295000134b2ecaf72e421e99f2c"
TEST_SOURCE = "rust/crates/er-wasm/tests/m9e_parity.rs"
BUNDLE_PATH = "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
DIAGNOSTIC_ID = "generated_cohort_diagnostic::capture_actual_eventwise_report_and_preimages"
OLD_IDS = ["native_replays_v7_held_timers_eventwise", "native_replays_v7_raw_inputs_eventwise"]
COHORTS = {
    "old": {"commit": "9fbb9fa2a624f8341974ce27e18260a21063751f", "bytes": 15810979,
            "git_blob": "6b435b78bc4d62c7f492142752c91610b914a071",
            "sha256": "640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4",
            "bundle_hash": "blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429",
            "progression_hash": "751643168aa2c2405d700c13b6438b10dec901d969de2c6b1048663b421b2695",
            "report_digest": "42da262041f8b58b7c0bf95253e5560cfd1b4c2b571b46419555df6df94278f4"},
    "new": {"commit": "24beac2761fec35131380ba4b64fc5bd2cf4129d", "bytes": 16325821,
            "git_blob": "778d0bd4f31fac16c2823ad1ad0c6a8761fede68",
            "sha256": "9afce9fd3bc6e05e2159f19e8578ff64fc342b8a5974bec5f15648b0799d74d2",
            "bundle_hash": "blake3-v1:dc4ab1ede5c52152e40f1dc5579d93841898126903b3047bf66b60efd7646493",
            "progression_hash": "b167ad856885c95dab4f1e9cdf1456dd4924f6c4dbc8443e12918f232215192e",
            "report_digest": "c28ac3b994c687413a4d0bcae7c558f0e02dfafd5e9ec3482bbb9462f5598063"},
}
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0", "CARGO_PROFILE_TEST_OPT_LEVEL": "0",
           "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true", "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true",
           "CARGO_PROFILE_TEST_DEBUG": "0", "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
SOURCES = [TEST_SOURCE, "rust/crates/er-wasm/src/m9e_parity.rs", "rust/crates/er-wasm/src/lib.rs",
           "rust/crates/er-wasm/Cargo.toml", "rust/crates/er-kernel/src/game_kernel_v7.rs",
           "rust/crates/er-kernel/src/snapshot_v7.rs", "rust/crates/er-kernel/src/snapshot.rs",
           "rust/crates/er-kernel/src/lib.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs",
           "rust/crates/er-game/src/m9e_content_v2.rs", "rust/crates/er-game/src/m9e_new_run_v6.rs",
           "rust/crates/er-state/src/m9e_state_v6.rs", "rust/crates/er-progression/src/progression.rs",
           "rust/crates/er-progression/src/content_v2.rs", "rust/crates/er-canonical/src/lib.rs",
           "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml", "scripts/ci/m9e_current_cost.py",
           "scripts/ci/m9e_parity_generated_cohort_diagnostic.py", ".github/workflows/m9e-parity-generated-cohort-focused.yml"]
BASE_TREE = "e35da245a3a175235626665fd28a4f203bd1bf90"
BASE_SOURCES = json.loads(r'''{
  "rust/Cargo.lock": [
    "77819112d183e14ad28244caaaadfe94956ab6b7c105a5810f0c2296346e65e9",
    32051
  ],
  "rust/Cargo.toml": [
    "fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",
    1615
  ],
  "rust/crates/er-canonical/src/lib.rs": [
    "2c80cb375cbc7aaf5018a4abacd67c74e584451347cac253448cc96238d12a3b",
    98923
  ],
  "rust/crates/er-game/src/m9e_content_v2.rs": [
    "2f597cba4b09edd84aa52d3120a9ed113be1002d134867496d8b296148e5ba25",
    23350
  ],
  "rust/crates/er-game/src/m9e_new_run_v6.rs": [
    "72af2d48c26794a1fc41352bb13b081199e9299a5716f12ef5f461a0f9dccd28",
    32864
  ],
  "rust/crates/er-game/src/m9e_runtime_v6.rs": [
    "51792a4093785dd24be3981867af1b3adbbe6c3d736d9c6dc2dedafce24d9fbc",
    110747
  ],
  "rust/crates/er-kernel/src/game_kernel_v7.rs": [
    "f3251fb4de9c24af5482d607af3acb8abfc9cd3249abfc12f4433555dcdca7b5",
    153862
  ],
  "rust/crates/er-kernel/src/lib.rs": [
    "4c04cb699d70a2de1aff23a86a3dfbc41a13db5142984623d8bad48441812e76",
    1085
  ],
  "rust/crates/er-kernel/src/snapshot_v7.rs": [
    "e247dbf85f7d473f9d02d54b08f0b86d5630aa37bfd39e5645ef7b3366449e7a",
    22224
  ],
  "rust/crates/er-kernel/src/snapshot.rs": [
    "13073f49f7598ee4ba20dff446fbfac50d87cea04ece523679e7258d552ca2f2",
    55220
  ],
  "rust/crates/er-progression/src/content_v2.rs": [
    "39d14bb3d7b4760261a6c2053be68ee987b61f3e916389bfc1cb03a066b976c9",
    17159
  ],
  "rust/crates/er-progression/src/progression.rs": [
    "842400cd68f24a2f431c62c64813c3600735e86dd8acdeea42dc6ba10d7baacd",
    27646
  ],
  "rust/crates/er-state/src/m9e_state_v6.rs": [
    "f4aeedff5dfad585f046c55856e1eb9cd66f1a997bda1286401c0012e0c26d23",
    14128
  ],
  "rust/crates/er-wasm/Cargo.toml": [
    "bc664365f8987e882b5433ac980c06ad61f64759c9280c0d6b164258e14d0de6",
    756
  ],
  "rust/crates/er-wasm/src/lib.rs": [
    "236e35c52a0bc6eb29752c47dde2f5b8f0070a05a05b269365e20c1baa76312c",
    14866
  ],
  "rust/crates/er-wasm/src/m9e_parity.rs": [
    "8a8c0272c89486be88f931045bbef41ab7bc1aed799f100528028467f486dfbb",
    5818
  ],
  "rust/crates/er-wasm/tests/m9e_parity.rs": [
    "87194b0983d3205e01f51106d78e62acbe52084f4b0a47ad042625709d9b7961",
    21963
  ],
  "rust/rust-toolchain.toml": [
    "0241de2190a0c1959d4ad182dfa6943b7ab9bd577dc8ef9b0fe7502d191835ec",
    123
  ],
  "scripts/ci/m9e_current_cost.py": [
    "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75",
    38615
  ]
}''')
CHANGED_SOURCES = [TEST_SOURCE, "scripts/ci/m9e_parity_generated_cohort_diagnostic.py", ".github/workflows/m9e-parity-generated-cohort-focused.yml"]
logs, sequence, failed_log = {}, 0, None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20):
    global sequence, failed_log
    if not 0 < seconds <= 600 or DEADLINE is None or run_bounded is None:
        raise RuntimeError("fixed600-second command ceiling and pre-checkout budget required")
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=cwd or ROOT / "rust", environment=dict(os.environ),
                             output=output, seconds=seconds, byte_limit=bound, global_deadline=DEADLINE - 20)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    return output


def verify_bundle(path, cohort):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != cohort["bytes"]:
        raise RuntimeError("exact regular cohort file size required")
    blob = hashlib.sha1(f"blob {cohort['bytes']}\0".encode())
    sha = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while chunk := stream.read(65536):
            total += len(chunk)
            if total > cohort["bytes"]:
                raise RuntimeError("cohort stream exceeded exact bound")
            sha.update(chunk)
            blob.update(chunk)
    if total != cohort["bytes"] or sha.hexdigest() != cohort["sha256"] or blob.hexdigest() != cohort["git_blob"]:
        raise RuntimeError("actual cohort SHA256/Git blob identity differs")


def retrieve_old_blob(path):
    # One exact source blob, only on the runner. No archive, checkout or report body.
    cohort = COHORTS["old"]
    request = urllib.request.Request(
        "https://api.github.com/repos/Heraklines/elite-redux/git/blobs/" + cohort["git_blob"],
        headers={"Accept": "application/vnd.github.raw+json", "User-Agent": "m9e-parity-source-diagnostic",
                 "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    timeout = min(60, DEADLINE - 20 - time.monotonic())
    if timeout <= 0:
        raise RuntimeError("source download lacks shared budget and cleanup reserve")
    with opener.open(request, timeout=timeout) as response, path.open("xb") as output:
        if response.status != 200 or response.geturl() != request.full_url:
            raise RuntimeError("exact same-provider source response required")
        total = 0
        while chunk := response.read(65536):
            total += len(chunk)
            if total > cohort["bytes"] or time.monotonic() > DEADLINE - 20:
                raise RuntimeError("old source blob bound/deadline exceeded")
            output.write(chunk)
    verify_bundle(path, cohort)


def execute_cohort(name, summary):
    target = REPORT / ("target-" + name)
    os.environ["CARGO_TARGET_DIR"] = str(target)
    directory = FULL / name
    directory.mkdir()
    os.environ["M9E_PARITY_DIAGNOSTIC_DIR"] = str(directory)
    os.environ["M9E_PARITY_COHORT"] = name
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS[name])
    run(["cargo", "clippy", "--locked", "-p", "er-wasm", "--test", "m9e_parity", "--no-deps", "--", "-D", "warnings"], name + "-clippy")
    build = run(["cargo", "test", "--locked", "-p", "er-wasm", "--test", "m9e_parity", "--no-run", "--message-format=json"], name + "-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == "m9e_parity"]
    if len(matches) != 1:
        raise RuntimeError("unique actual parity executable required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    profile = artifact.get("profile", {})
    if (artifact.get("manifest_path") != str(ROOT / "rust/crates/er-wasm/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / TEST_SOURCE)
            or profile.get("test") is not True or profile.get("debug_assertions") is not True
            or profile.get("opt_level") != "0" or profile.get("debuginfo") != 0
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != target / "debug/deps"
            or not re.fullmatch(r"m9e_parity-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual parity source/profile/artifact differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], name + "-list", seconds=30, bound=16384)
    ids = sorted([DIAGNOSTIC_ID, *OLD_IDS])
    if listing.read_text() != "".join(value + ": test\n" for value in ids):
        raise RuntimeError("all old2 and appended1 exact native IDs required")
    selected = ids if name == "old" else [DIAGNOSTIC_ID, OLD_IDS[0]]
    execution = []
    execution_deadline = time.monotonic() + 600
    for ordinal, test_id in enumerate(selected):
        remaining = execution_deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("whole cohort target execution exceeds600 seconds")
        output = run([str(binary), test_id, "--exact", "--format", "terse", "--nocapture", "--test-threads=1"], name + "-execute-" + str(ordinal), cwd=ROOT / "rust/crates/er-wasm", seconds=remaining, bound=16384)
        counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output.read_text())
        if counts != [("1", "0", "0", "0", "2")]:
            raise RuntimeError("exact diagnostic selection/count differs")
        execution.append({"id": test_id, "passed": 1, "filtered_out": 2})
    if digest(binary) != binary_hash:
        raise RuntimeError("executed parity binary changed")
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS[name])
    capture = json.loads((directory / "capture.json").read_text())
    if (capture.get("cohort") != name or capture.get("report_digest") != COHORTS[name]["report_digest"]
            or capture.get("actual_preimages_match_full_report") is not True
            or capture.get("original_golden_changed") is not False or capture.get("new_wasm_qualification") is not False):
        raise RuntimeError("exact actual capture receipt differs")
    files = {}
    for filename, maximum in (("trace.jsonl", 64 << 20), ("report.json", 4 << 20), ("capture.json", 4096)):
        path = directory / filename
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= maximum:
            raise RuntimeError("bounded raw diagnostic file differs")
        files[filename] = {"bytes": path.stat().st_size, "sha256": digest(path)}
    if capture["trace_bytes"] != files["trace.jsonl"]["bytes"] or capture["report_bytes"] != files["report.json"]["bytes"]:
        raise RuntimeError("actual capture bytes differ")
    summary["cohorts"][name] = {"source_input": COHORTS[name], "artifact": {"sha256": binary_hash, "bytes": binary.stat().st_size,
        "profile": profile, "overflow_checks": True, "ids": ids, "listing_sha256": digest(listing)}, "executions": execution, "capture": capture, "files": files}

def difference_inventory(left, right, rows, path, sequence):
    if time.monotonic() > DEADLINE - 20:
        raise RuntimeError("diagnostic comparison deadline")
    if type(left) is type(right) and left == right:
        return
    if isinstance(left, dict) and isinstance(right, dict) and set(left) == set(right):
        for key in sorted(left):
            difference_inventory(left[key], right[key], rows, path + "." + key, sequence)
        return
    if isinstance(left, list) and isinstance(right, list) and len(left) == len(right):
        # Large exact numeric byte vectors remain hash/length bound below rather
        # than becoming millions of per-byte path records. Actual AuthorityMaterial
        # bytes are decoded separately, so their concrete inner differences survive.
        if not (left and all(type(value) is int and 0 <= value <= 255 for value in left + right)):
            for old, new in zip(left, right):
                difference_inventory(old, new, rows, path + "[]", sequence)
            return
    if len(path) > 2048 or (path not in rows and len(rows) >= 4096):
        raise RuntimeError("bounded diagnostic difference inventory exceeded")
    row = rows.setdefault(path, {"occurrences": 0, "first_sequence": sequence, "old_value_sha256": hashlib.sha256(encoded(left)).hexdigest(),
                                "new_value_sha256": hashlib.sha256(encoded(right)).hexdigest(), "old_type": type(left).__name__, "new_type": type(right).__name__})
    row["occurrences"] += 1


def mechanical_comparison(left, right):
    if left is None or right is None:
        return left == right
    if not isinstance(left, dict) or not isinstance(right, dict) or "content_identity" not in left or "content_identity" not in right:
        raise RuntimeError("actual typed mechanical state required")
    before, after = left["content_identity"], right["content_identity"]
    if (not isinstance(before, dict) or not isinstance(after, dict) or set(before) != set(after)
            or before.get("bundle_hash") != COHORTS["old"]["bundle_hash"]
            or before.get("progression_hash") != COHORTS["old"]["progression_hash"]
            or after.get("bundle_hash") != COHORTS["new"]["bundle_hash"]
            or after.get("progression_hash") != COHORTS["new"]["progression_hash"]):
        raise RuntimeError("exact two-cohort typed identity required")
    normalized = copy.deepcopy(right)
    for field in ("bundle_hash", "progression_hash"):
        normalized["content_identity"][field] = before[field]
    # Exact complete mechanical comparison; no other fields/digests are erased.
    return encoded(left) == encoded(normalized)


def authority_preimages(effects):
    result = []
    for index, effect in enumerate(effects):
        if isinstance(effect, dict) and set(effect) == {"AuthorityMaterial"}:
            value = effect["AuthorityMaterial"]
            if not isinstance(value, dict) or set(value) != {"operation_id", "bytes"}:
                raise RuntimeError("typed AuthorityMaterial shape differs")
            raw = value["bytes"]
            if (not isinstance(raw, list) or not 0 < len(raw) <= 4 << 20
                    or any(type(byte) is not int or not 0 <= byte <= 255 for byte in raw)):
                raise RuntimeError("actual AuthorityMaterial byte vector bound")
            result.append({"effect_index": index, "operation_id": value["operation_id"],
                           "bytes": len(raw), "sha256": hashlib.sha256(bytes(raw)).hexdigest(),
                           "decoded_json": json.loads(bytes(raw))})
    return result


def compare_actual_preimages(summary):
    rows = {}
    comparisons, mechanical_equal = 0, 0
    decoded_material_counts = {"old": 0, "new": 0}
    non_digest_fields = ("sequence", "input_digest", "control_kind", "wave")
    with (FULL / "old/trace.jsonl").open("rb") as old, (FULL / "new/trace.jsonl").open("rb") as new:
        for sequence, pair in enumerate(itertools.zip_longest(old, new)):
            left, right = pair
            if left is None or right is None or len(left) > (4 << 20) + 1 or len(right) > (4 << 20) + 1:
                raise RuntimeError("actual trace record count/size differs")
            left, right = json.loads(left), json.loads(right)
            if sequence == 0:
                if set(left) != {"kind", "snapshot"} or set(right) != set(left) or left["kind"] != right["kind"] or left["kind"] != "initial":
                    raise RuntimeError("actual initial snapshot record required")
            else:
                keys = {"kind", "sequence", "event", "effects", "internal_events", "mechanical_state", "kernel_snapshot", "observation"}
                if set(left) != keys or set(right) != keys or left["kind"] != "event" or right["kind"] != "event" or left["sequence"] != sequence or right["sequence"] != sequence:
                    raise RuntimeError("actual event record identity differs")
                if left["event"] != right["event"] or any(left["observation"][key] != right["observation"][key] for key in non_digest_fields):
                    raise RuntimeError("unchanged raw trace/sequence/control/wave contract differs")
                comparisons += 1
                mechanical_equal += int(mechanical_comparison(left["mechanical_state"], right["mechanical_state"]))
                old_materials, new_materials = authority_preimages(left["effects"]), authority_preimages(right["effects"])
                decoded_material_counts["old"] += len(old_materials)
                decoded_material_counts["new"] += len(new_materials)
                difference_inventory(old_materials, new_materials, rows, "event.authority_material_preimages", sequence)
            difference_inventory(left, right, rows, "initial" if sequence == 0 else "event", sequence)
    if comparisons != summary["cohorts"]["old"]["capture"]["events"] or comparisons != summary["cohorts"]["new"]["capture"]["events"]:
        raise RuntimeError("actual preimage/report event counts differ")
    if any(count <= 0 for count in decoded_material_counts.values()):
        raise RuntimeError("each cohort must contain actual decoded AuthorityMaterial records")
    reports = [json.loads((FULL / name / "report.json").read_text()) for name in ("old", "new")]
    difference_inventory(reports[0], reports[1], rows, "report", 0)
    full = {"actual_events": comparisons, "decoded_authority_material_counts": decoded_material_counts, "mechanical_states_equal_after_only_two_typed_identity_fields": mechanical_equal,
            "all_mechanical_states_equal_after_only_two_typed_identity_fields": mechanical_equal == comparisons,
            "raw_inputs_control_wave_sequences_equal": True, "differences": rows,
            "unrecognized_differences_automatically_allowed": False, "new_golden_qualified": False}
    data = encoded(full) + b"\n"
    if len(data) > 2 << 20:
        raise RuntimeError("bounded remote difference report exceeded")
    (FULL / "preimage-differences.json").write_bytes(data)
    summary["comparison"] = {key: value for key, value in full.items() if key != "differences"}
    summary["comparison"].update(difference_paths=len(rows), displayed_paths=min(64, len(rows)), omitted_paths=max(0, len(rows) - 64),
        first_path_differences={key: rows[key] for key in sorted(rows)[:64]},
        full_difference_file={"name": "preimage-differences.json", "bytes": len(data), "sha256": digest(FULL / "preimage-differences.json")})


def cleanup_owned_targets():
    for name in ("old", "new"):
        path = REPORT / ("target-" + name)
        if path.is_symlink() or path.resolve().parent != REPORT.resolve():
            raise RuntimeError("owned diagnostic target containment differs")
        if path.exists():
            shutil.rmtree(path)
        if path.exists():
            raise RuntimeError("owned target cleanup incomplete")


def source_conservation(summary, phase):
    if STARTED_AT is None or not 0 <= time.time() - STARTED_AT <= 1800:
        raise RuntimeError("pre-checkout shared budget absent or exhausted")
    tree = run(["git", "rev-parse", BASE + "^{tree}"], "base-tree-" + phase,
               cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if tree != BASE_TREE:
        raise RuntimeError("exact f501 base tree required")
    changes = run(["git", "diff", "--name-status", "--no-renames", "--no-ext-diff", "--no-textconv", BASE, "HEAD", "--"],
                  "base-delta-" + phase, cwd=ROOT, seconds=30, bound=16384).read_text().splitlines()
    expected = sorted(("M" if name == TEST_SOURCE else "A") + "\t" + name for name in CHANGED_SOURCES)
    if sorted(changes) != expected:
        raise RuntimeError("only exact parity test append and two new CI paths may differ from f501")
    status = run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-" + phase,
                 cwd=ROOT, seconds=30, bound=16384).read_text()
    if status:
        raise RuntimeError("tracked candidate source/fixtures differ from committed bytes")
    for name in SOURCES:
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.resolve() != path or not 0 < path.stat().st_size <= 4 << 20:
            raise RuntimeError("small source containment/size differs")
        if name in BASE_SOURCES and name != TEST_SOURCE:
            expected_hash, expected_bytes = BASE_SOURCES[name]
            if path.stat().st_size != expected_bytes or digest(path) != expected_hash:
                raise RuntimeError("unchanged dependency source differs from exact f501: " + name)
    summary["base_conservation"] = {"tree": BASE_TREE, "changed_paths": CHANGED_SOURCES,
                                    "unchanged_small_sources": len(BASE_SOURCES) - 1, "phase": phase}

def main(summary):
    global STARTED_AT, DEADLINE, run_bounded
    epoch = os.environ.get("M9E_FOCUS_STARTED_AT", "")
    if not re.fullmatch(r"[0-9]{10}", epoch):
        raise RuntimeError("exact pre-checkout workflow timestamp required")
    elapsed = time.time() - int(epoch)
    if not 0 <= elapsed < 1780:
        raise RuntimeError("negative elapsed or setup exhausted shared budget/cleanup reserve")
    STARTED_AT = int(epoch)
    DEADLINE = time.monotonic() + 1800 - elapsed
    helper = ROOT / "scripts/ci/m9e_current_cost.py"
    helper_hash, helper_bytes = BASE_SOURCES["scripts/ci/m9e_current_cost.py"]
    if (helper.is_symlink() or not helper.is_file() or helper.resolve() != helper
            or helper.stat().st_size != helper_bytes or digest(helper) != helper_hash
            or "m9e_current_cost" in sys.modules):
        raise RuntimeError("pinned bounded helper differs or was preloaded")
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != helper:
        raise RuntimeError("bounded helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    os.environ.update(PROFILE)
    os.environ["GIT_NO_LAZY_FETCH"] = "1"
    summary["started_at"] = STARTED_AT
    summary["elapsed_before_producer_seconds"] = elapsed
    summary["limits"] = {"command_seconds": 600, "cohort_target_seconds": 600,
                         "shared_seconds_including_checkout": 1800, "cleanup_reserve_seconds": 20,
                         "compact_bytes": 65536, "trace_bytes_per_cohort": 64 << 20,
                         "record_and_report_bytes": 4 << 20}
    if not re.fullmatch(r"[0-9a-f]{40}", summary["source_sha"]):
        raise RuntimeError("exact candidate SHA required")
    if run(["git", "rev-parse", "HEAD"], "head", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != summary["source_sha"]:
        raise RuntimeError("exact candidate source required")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    source_conservation(summary, "before")
    summary["source_hashes"] = {path: digest(ROOT / path) for path in SOURCES}
    prefix = (ROOT / TEST_SOURCE).read_bytes()[:21963]
    if len(prefix) != 21963 or hashlib.sha256(prefix).hexdigest() != "87194b0983d3205e01f51106d78e62acbe52084f4b0a47ad042625709d9b7961":
        raise RuntimeError("all original parity source bytes/goldens must survive")
    summary["original_test_prefix"] = {"bytes": 21963, "sha256": hashlib.sha256(prefix).hexdigest(), "all_old_bodies_unchanged": True}
    summary["compiler_configuration"] = dict(PROFILE)
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", str(ROOT / TEST_SOURCE)], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, str(ROOT / TEST_SOURCE)], "format-repair", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", TEST_SOURCE], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch), formatted_source_sha256=digest(ROOT / TEST_SOURCE))
        raise RuntimeError("remote formatting required; no report diagnostic executed")
    tree = run(["git", "ls-tree", "-l", "HEAD", "--", BUNDLE_PATH], "new-cohort-tree", cwd=ROOT, seconds=30, bound=16384).read_text().split()
    if tree != ["100644", "blob", COHORTS["new"]["git_blob"], str(COHORTS["new"]["bytes"]), BUNDLE_PATH]:
        raise RuntimeError("candidate must contain exact published new bundle")
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS["new"])
    new_backup, old_blob = REPORT / "new-bundle.json", REPORT / "old-bundle.json"
    shutil.copyfile(ROOT / BUNDLE_PATH, new_backup)
    retrieve_old_blob(old_blob)
    try:
        for name, source in (("old", old_blob), ("new", new_backup)):
            shutil.copyfile(source, ROOT / BUNDLE_PATH)
            execute_cohort(name, summary)
    finally:
        shutil.copyfile(new_backup, ROOT / BUNDLE_PATH)
        verify_bundle(ROOT / BUNDLE_PATH, COHORTS["new"])
    if any(digest(ROOT / path) != value for path, value in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during diagnostic")
    source_conservation(summary, "after")
    compare_actual_preimages(summary)


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE, "cohorts": {},
               "existing_new_cohort_golden_failure": {"source_sha": BASE, "run_id": "34140142350",
                   "failure_tail_sha256": "0606772c0b803c910665734a48f92511344893e8315999fcffcf39e712a6aae3",
                   "old_golden_not_claimed_passed_on_new_cohort": True},
               "qualification": "actual native two-cohort report/preimage diagnostic only; original goldens unchanged; not a new golden or Wasm/full qualification"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            cleanup_owned_targets()
            summary["cleanup"] = {"owned_targets_removed": True, "contained": True}
            if DEADLINE is None or time.monotonic() > DEADLINE:
                raise RuntimeError("final owned cleanup exceeded pre-checkout shared deadline")
            summary["post_cleanup_deadline_checked"] = True
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:2048]
    if summary["status"] != "passed":
        message = (summary.get("failure", summary.get("cleanup_failure", "diagnostic failed")) + "\nBounded tail; reports/preimages remain remote.\n").encode()[:4096]
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                allowance = 24576 - len(message)
                stream.seek(max(0, failed_log.stat().st_size - allowance))
                tail = stream.read(allowance)
        (COMPACT / "failure.txt").write_bytes(message + tail)
    summary["logs"] = logs
    summary["elapsed_seconds_including_checkout"] = None if STARTED_AT is None else time.time() - STARTED_AT
    data = encoded(summary) + b"\n"
    # A bounded view may reference the complete hash-bound remote difference map;
    # omitted paths are counted explicitly and never considered automatically safe.
    while len(data) > 65536 and summary.get("comparison", {}).get("first_path_differences"):
        view = summary["comparison"]
        view["first_path_differences"].pop(next(reversed(view["first_path_differences"])))
        view["displayed_paths"] -= 1
        view["omitted_paths"] += 1
        data = encoded(summary) + b"\n"
    if len(data) > 65536:
        raise RuntimeError("diagnostic receipt exceeds64KiB")
    (COMPACT / "summary.json").write_bytes(data)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
