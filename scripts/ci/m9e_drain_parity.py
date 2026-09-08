"""Actual paired published-drain content traces; original native/Wasm goldens remain unchanged."""
import copy
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time

ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-drain-parity"
TARGET = RUNNER / "m9e-drain-parity-target"
START = int(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []
BASE = "3b4ce13303bbfb05f2038931a5298bc090f1374c"
OLD = "ce47447f26eef093866f3424aa1377b64bde2ae3"
SOURCE = "rust/crates/er-wasm/tests/m9e_parity.rs"
ORIGINAL_BYTES = 29501
ORIGINAL_HASH = "625fdc6fd7ee0e8ef45bde564f4aa584b4edbb390ad0d1bd557509bdc7a5d750"
DIAGNOSTIC_HASH = "fc8d8dfa22874e549674f8b11fb7050adb3c04f20bf8e728e529426ff3668793"
CI = [".github/workflows/m9e-drain-parity-focused.yml", "scripts/ci/m9e_drain_parity.py"]
SOURCES = [SOURCE, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
    "rust/crates/er-wasm/Cargo.toml", "rust/crates/er-wasm/src/lib.rs", "rust/crates/er-wasm/src/m9e_parity.rs",
    "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-kernel/src/snapshot_v7.rs",
    "rust/crates/er-kernel/src/snapshot.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs",
    "rust/crates/er-game/src/m9e_new_run_v6.rs", "rust/crates/er-game/src/m9e_material_v6.rs",
    "rust/crates/er-game/src/m9e_content_v2.rs", "rust/crates/er-state/src/m9e_state_v6.rs",
    "rust/crates/er-save/src/m9e_save_v2.rs", "rust/crates/er-canonical/src/lib.rs"]
IDS = ["generated_cohort_diagnostic::capture_actual_eventwise_report_and_preimages",
       "native_replays_v7_held_timers_eventwise", "native_replays_v7_raw_inputs_eventwise"]


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def run(name, argv, cwd=ROOT, expected=0, maximum=16 << 20):
    remaining = DEADLINE - 20 - time.time()
    require(remaining > 0, "shared deadline exhausted")
    limit = min(600, remaining)
    started = time.monotonic()
    path = OUT / "diagnostics" / (name + ".log")
    with path.open("wb") as output:
        process = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        failed = False
        while process.poll() is None:
            if time.monotonic() - started >= limit or path.stat().st_size > maximum:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                failed = True
                break
            time.sleep(0.1)
    data = path.read_bytes()
    COMMANDS.append({"name": name, "argv": argv, "cwd": str(cwd.relative_to(ROOT)) or ".",
        "returncode": process.returncode, "limit_seconds": limit,
        "elapsed_ms": int((time.monotonic() - started) * 1000), "log_bytes": len(data), "log_sha256": sha(data)})
    require(not failed and len(data) <= maximum and process.returncode == expected, name + " failed")
    return data


def capture(name, checkout, proof):
    source_hashes = {path: sha((checkout / path).read_bytes()) for path in SOURCES}
    directory = OUT / "diagnostics" / name
    directory.mkdir()
    target = TARGET / name
    os.environ["CARGO_TARGET_DIR"] = str(target)
    os.environ["M9E_PARITY_DIAGNOSTIC_DIR"] = str(directory)
    os.environ["M9E_PARITY_COHORT"] = name
    raw = run(name + "-build", ["cargo", "test", "--locked", "-p", "er-wasm", "--test", "m9e_parity", "--no-run", "--message-format=json"], checkout / "rust")
    rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
    require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful build required")
    artifacts = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
    require(len(artifacts) == 1, "one whole parity executable required")
    artifact = artifacts[0]
    profile = artifact["profile"]
    binary = Path(artifact["executable"])
    require(artifact["target"]["name"] == "m9e_parity" and artifact["target"]["kind"] == ["test"]
        and artifact["target"]["src_path"] == str(checkout / SOURCE)
        and artifact["manifest_path"] == str(checkout / "rust/crates/er-wasm/Cargo.toml")
        and artifact["features"] == [] and profile == {"opt_level": "0", "debuginfo": 0,
            "debug_assertions": True, "overflow_checks": True, "test": True}
        and binary.resolve().is_relative_to(target.resolve()) and 0 < binary.stat().st_size <= 128 << 20, "actual source/profile/artifact differs")
    binary_hash = sha(binary.read_bytes())
    listing = run(name + "-list", [str(binary), "--list", "--format", "terse"], checkout / "rust/crates/er-wasm", maximum=16384)
    require(listing == "".join(test + ": test\n" for test in IDS).encode(), "all three source-derived IDs required")
    output = run(name + "-execute", [str(binary), "--format", "terse"], checkout / "rust/crates/er-wasm", expected=0 if name == "old" else 101, maximum=16384)
    expected = [(b"3", b"0", b"0", b"0", b"0")] if name == "old" else [(b"2", b"1", b"0", b"0", b"0")]
    require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == expected, "exact complete target result required")
    failed_ids = sorted(value.decode() for value in re.findall(rb"^([A-Za-z][A-Za-z0-9_:]+) --- FAILED$", output, re.M))
    require(failed_ids == ([] if name == "old" else ["native_replays_v7_raw_inputs_eventwise"]), "only the known unchanged golden assertion may fail")
    require(sha(binary.read_bytes()) == binary_hash, "executed binary changed")
    facts = {}
    for filename, maximum in (("capture.json", 8192), ("report.json", 65536), ("trace.jsonl", 64 << 20)):
        path = directory / filename
        require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= maximum, "bounded actual preimage required")
        raw = path.read_bytes()
        facts[filename] = {"bytes": len(raw), "sha256": sha(raw)}
    captured = json.loads((directory / "capture.json").read_bytes())
    require(captured["cohort"] == name and captured["events"] == 30 and captured["actual_preimages_match_full_report"] is True
        and captured["original_golden_changed"] is False and captured["new_wasm_qualification"] is False, "actual unchanged-golden trace capture required")
    require(source_hashes == {path: sha((checkout / path).read_bytes()) for path in SOURCES}, "runtime source changed during capture")
    proof["cohorts"][name] = {"source_sha": OLD if name == "old" else BASE, "source_hashes": source_hashes,
        "artifact": {"bytes": binary.stat().st_size, "sha256": binary_hash, "path": str(binary), "profile": profile,
                     "target": artifact["target"], "manifest_path": artifact["manifest_path"], "ids": IDS},
        "failed_ids": failed_ids, "files": facts, "capture": captured}


def main():
    require(0 <= time.time() - START < 1780 and not OUT.exists() and not TARGET.exists(), "fresh owned roots and precheckout budget required")
    (OUT / "diagnostics").mkdir(parents=True)
    (OUT / "compact").mkdir()
    TARGET.mkdir()
    proof = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
        "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE, "baseline_sha": OLD,
        "commands": COMMANDS, "cohorts": {}, "qualification": "diagnostic preimages only; original golden failure is retained; no new parity or M9 qualification"}
    try:
        require(run("head", ["git", "rev-parse", "HEAD"]).decode().strip() == proof["source_sha"], "candidate HEAD differs")
        require(run("baseline-head", ["git", "rev-parse", "HEAD"], ROOT / "baseline").decode().strip() == OLD, "baseline HEAD differs")
        changes = run("source-delta", ["git", "diff", "--name-only", BASE, "HEAD"]).decode().splitlines()
        require(sorted(changes) == sorted([SOURCE, *CI]), "only diagnostic appendix and two CI files may change")
        current = (ROOT / SOURCE).read_bytes()
        old = (ROOT / "baseline" / SOURCE).read_bytes()
        require(len(old) == ORIGINAL_BYTES and sha(old) == ORIGINAL_HASH and current[:ORIGINAL_BYTES] == old
            and sha(current) == DIAGNOSTIC_HASH, "original complete tests and goldens must remain byte-identical")
        proof["diagnostic_source_sha256"] = sha(current)
        proof["original_source_sha256"] = sha(old)
        proof["ci_source_hashes"] = {path: sha((ROOT / path).read_bytes()) for path in CI}
        for path in ("rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml"):
            require((ROOT / path).read_bytes() == (ROOT / "baseline" / path).read_bytes(), "unchanged build policy required")
        for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS"):
            require(not os.environ.get(key), "ordinary unmodified execution environment required")
        run("toolchain", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal", "--component", "rustfmt", "--component", "clippy"])
        proof["rustc"] = run("rustc", ["rustc", "--version", "--verbose"]).decode()
        run("format", ["rustfmt", "--check", "--edition", "2024", "--config", "skip_children=true", SOURCE])
        os.environ["CARGO_TARGET_DIR"] = str(TARGET / "new")
        run("clippy", ["cargo", "clippy", "--locked", "-p", "er-wasm", "--tests", "--no-deps", "--", "-D", "warnings"], ROOT / "rust")
        (ROOT / "baseline" / SOURCE).write_bytes(current)
        capture("old", ROOT / "baseline", proof)
        capture("new", ROOT, proof)
        compare_actual_preimages(proof)
        proof["status"] = "observed"
    except Exception as error:
        proof["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-drain-parity-target", "cleanup must remain in owned runner target")
        cleanup_started = time.monotonic()
        try:
            result = subprocess.run(["python3", "-c", "import shutil,sys;shutil.rmtree(sys.argv[1])", str(TARGET)], timeout=20, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            cleanup_ok = result.returncode == 0 and not TARGET.exists()
        except (OSError, subprocess.TimeoutExpired):
            cleanup_ok = False
        proof["cleanup"] = {"success": cleanup_ok, "elapsed_ms": int((time.monotonic() - cleanup_started) * 1000), "limit_seconds": 20}
        proof["elapsed_seconds"] = time.time() - START
        if not cleanup_ok or time.time() > DEADLINE:
            proof["status"] = "failed"
            proof["first_failure"] = "shared deadline or cleanup failed"
        if proof["status"] != "observed":
            failure = (proof.get("first_failure", "diagnostic failed") + "\n").encode()
            if COMMANDS:
                failure += (OUT / "diagnostics" / (COMMANDS[-1]["name"] + ".log")).read_bytes()[-20000:]
            (OUT / "compact/failure.txt").write_bytes(failure[:24576])
        raw = encoded(proof) + b"\n"
        require(len(raw) <= 65536, "bounded complete summary required")
        (OUT / "compact/summary.json").write_bytes(raw)
    raise SystemExit(0 if proof["status"] == "observed" else 1)

FULL = OUT / 'diagnostics'

def digest(path):
    return sha(path.read_bytes())

def difference_inventory(left, right, rows, path, sequence):
    if time.time() > DEADLINE - 20:
        raise RuntimeError("diagnostic comparison deadline")
    if type(left) is type(right) and left == right:
        return
    if isinstance(left, dict) and isinstance(right, dict):
        for key in sorted(set(left) | set(right)):
            difference_inventory(left.get(key, {"__diagnostic_absent__": True}), right.get(key, {"__diagnostic_absent__": True}), rows, path + "." + key, sequence)
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
    # Diagnostic only: no state normalization and no new golden qualification.
    return encoded(left) == encoded(right)

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
    full = {"actual_events": comparisons, "decoded_authority_material_counts": decoded_material_counts, "mechanical_states_equal_without_normalization": mechanical_equal,
            "all_mechanical_states_equal_without_normalization": mechanical_equal == comparisons,
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


if __name__ == '__main__':
    main()
