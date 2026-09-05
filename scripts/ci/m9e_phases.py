"""Same-run native/platform handoff; only aggregate can qualify a candidate.

The workflow uploads two single-file artifacts from bounded producer directories:
native.json (<=64 KiB) and optionally er-cli (<=128 MiB). Consumers never receive
worker/test binaries or a target tree. No archive supplied by a manifest is opened.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys


MANIFEST_LIMIT = 64 * 1024
CLI_LIMIT = 128 * 1024 * 1024
IDENTITY_FILES = {
    "harness": "scripts/ci/m9e_feedback.py",
    "phases": "scripts/ci/m9e_phases.py",
    "selftests": "scripts/ci/test_m9e_feedback.py",
    "config": "scripts/ci/m9e-targets.json",
    "workflow": ".github/workflows/m9e-focused-feedback.yml",
    "lock": "rust/Cargo.lock",
    "content": "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json",
}
WASM_IDS = {"wasm_replays_v7_raw_inputs_eventwise", "wasm_replays_v7_held_timers_eventwise"}
BROWSER_IDS = {"natural V7 browser startup reaches the real battle command",
               "two V7 browser hosts wait for both humans and converge one turn"}
LANE_B_TARGETS = {("er-web", "m9e_host_v2"), ("er-cli", "m9e_current_repro"),
                  ("er-cli", "m9e_current_batch")}


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
    data = encoded(value)
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
    if sha(data) != expected_hash:
        raise RuntimeError("phase manifest digest mismatch")
    return json.loads(data)


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
    assignment = partition(inventory)
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
    for key in ("timer_mutant", "replica_mutant"):
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
    for key in ("timer_mutant", "replica_mutant"):
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


def validate_platform(proof, native, native_hash):
    if (proof.get("version") != 1 or proof.get("phase") != "platform"
            or proof.get("status") != "passed" or proof.get("qualification") != "pending"
            or proof.get("identity") != native["identity"]
            or proof.get("native_manifest_sha256") != native_hash
            or proof.get("plan_sha256") != native["plan_sha256"]):
        raise RuntimeError("platform phase identity or completion mismatch")
    plan = native["plan"]
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
            **{key: result[key] for key in ("wasm_tests", "browser_tests", "browser_assets", "browser_current_repro_bridge") if key in result},
            **{key: native[key] for key in ("timer_mutant", "replica_mutant") if key in native}}


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
            "native_timer_parity_digest", "wasm_tests", "browser_tests", "browser_assets", "browser_current_repro_bridge",
            "cli_executable", "worker_executables", "content_manifest_hash", "native_target_timing_ms", "timer_mutant", "replica_mutant") if key in summary}
        compact.update({"phase_summary_sha256": full_hash, "timing_ms": feedback.TIMINGS})
        if "first_failure" in summary:
            compact["first_failure"] = summary["first_failure"]
        if len(encoded(compact)) > 16000:
            for key in ("native_target_timing_ms", "timing_ms"):
                if key in compact:
                    compact[key] = {"file": "phase-summary.json", "sha256": full_hash}
        if len(encoded(compact)) > 16000:
            raise RuntimeError("aggregate compact evidence exceeds 16 KiB; cannot claim bounded qualification")
        write_bounded(feedback.COMPACT / "summary.json", compact)
        print(json.dumps(compact), flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
