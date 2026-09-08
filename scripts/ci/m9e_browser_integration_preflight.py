"""Remote whole-harness feedback only; no native or Browser qualification."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-browser-integration-preflight"
FULL = REPORT / "full"
COMPACT = REPORT / "compact"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir()
    source = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if source != os.environ["GITHUB_SHA"]:
        raise RuntimeError("exact source checkout required")
    paths = sorted({*ROOT.glob("scripts/ci/test_m9e*.py"),
                    *(ROOT / name for name in (
                        "scripts/ci/m9e_feedback.py", "scripts/ci/m9e_phases.py", "scripts/ci/m9e_browser_rebind.py",
                        "scripts/ci/m9e_friendship_inputs.py", ".github/workflows/m9e-focused-feedback.yml",
                        "scripts/ci/m9e_browser_integration_preflight.py", "scripts/ci/m9e-owned-foundations-inventory.json",
                        "scripts/ci/m9e-targets.json", "scripts/ci/fixtures/m9e-browser-rebind-proof.json",
                        ".github/workflows/m9e-browser-integration-preflight.yml"))})
    import m9e_friendship_inputs as friendship
    receipt_path = Path(os.environ["RUNNER_TEMP"]) / "m9e-feedback/full/qualified-oracle.json"
    if (receipt_path.is_symlink() or not receipt_path.is_file()
            or not 0 < receipt_path.stat().st_size <= 16384):
        raise RuntimeError("actual qualified friendship receipt required")
    receipt = json.loads(receipt_path.read_bytes())
    expected_inputs = {name: {"bytes": size, "sha256": sha, "member": "generated/" + name}
                       for name, (size, sha) in friendship.ORACLE_FILES.items()}
    if receipt["files"] != expected_inputs or receipt["source_run"]["id"] != friendship.ORACLE_RUN:
        raise RuntimeError("qualified friendship source identity differs")
    for name, expected in expected_inputs.items():
        path = receipt_path.parent / "qualified-oracle" / name
        if (path.is_symlink() or not path.is_file() or path.stat().st_size != expected["bytes"]
                or digest(path) != expected["sha256"]):
            raise RuntimeError("actual original friendship input differs")
    receipt["receipt_sha256"] = digest(receipt_path)
    before = {str(path.relative_to(ROOT)): digest(path) for path in paths}
    log = FULL / "harness-tests.log"
    argv = [sys.executable, "-m", "unittest", "discover", "-s", "scripts/ci", "-p", "test_m9e*.py", "-v"]
    started = time.monotonic()
    with log.open("wb") as output:
        result = subprocess.run(argv, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, timeout=450, check=False)
    raw = log.read_bytes()
    found = re.findall(rb"(?m)^Ran ([0-9]+) tests in ([0-9.]+)s$", raw)
    count = int(found[0][0]) if len(found) == 1 else None
    planner = None
    planner_error = None
    if result.returncode == 0 and count == 477:
        try:
            os.environ["M9E_REPORT_DIR"] = str(REPORT / "planner")
            import m9e_feedback as feedback
            import m9e_browser_rebind as rebind
            feedback.FULL.mkdir(parents=True, exist_ok=True)
            plan = feedback.plan()
            inventory = feedback.owned_foundation_inventory()
            feedback.validate_owned_foundation_inventory(plan, inventory)
            feedback.validate_owned_foundation_sources(ROOT)
            expected_binding = rebind.source_binding(ROOT, source)
            if (plan.get("current_recovery_integration") is not True
                    or plan.get("requires_owned_foundations") is not True
                    or plan.get("requires_current_browser_rebind") is not True
                    or plan.get("current_browser_rebind_binding") != expected_binding
                    or plan.get("requires_browser_worker") is not True
                    or plan.get("requires_current_coop_startup") is not True
                    or plan["unknown_paths"] or plan["boundary_paths"]
                    or len(inventory) != 105 or sum(len(row["ids"]) for row in inventory) != 803
                    or sum(map(len, plan["required_native_targets"].values())) != 61
                    or len(plan["required_native_test_ids"]) != 55
                    or len(feedback.OWNED_FOUNDATION_SOURCES) != 55):
                raise RuntimeError("actual803 full source plan or Browser obligations differ")
            for row in inventory:
                if not ("*" in plan["execution_scope"].get(row["crate"], [])
                        or row["target"] in plan["execution_scope"].get(row["crate"], [])):
                    raise RuntimeError("actual whole native target omitted")
            import m9e_phases as phases
            partitions = phases.partition(inventory)
            lane_counts = {lane: sum(len(row["ids"]) for row in inventory
                                     if [row["crate"], row["target"]] in targets)
                           for lane, targets in partitions.items()}
            if lane_counts != {"a": 685, "b": 14, "c": 14, "d": 87, "e": 3}:
                raise RuntimeError("exact whole-target balanced lane assignment differs")
            planner = {"lane_counts": lane_counts, "status": "passed", "tests": 803, "targets": 105, "required_targets": 61,
                       "exact_maps": 55, "owned_sources": 55,
                       "inventory_sha256": feedback.OWNED_FOUNDATION_INVENTORY_SHA256,
                       "browser_binding": expected_binding}
        except Exception as error:
            planner_error = type(error).__name__ + ": " + str(error)
            (COMPACT / "planner-failure.txt").write_text(planner_error[:16000] + "\n")
    after = {str(path.relative_to(ROOT)): digest(path) for path in paths}
    elapsed = time.time() - int(os.environ["M9E_PREFLIGHT_STARTED"])
    passed = (result.returncode == 0 and count == 477 and planner is not None and before == after
              and 0 < elapsed <= 540 and 0 < len(raw) <= 256 << 10)
    summary = {"status": "passed" if passed else "failed", "source_sha": source,
               "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
               "tests": count, "expected_tests": 477, "returncode": result.returncode, "execution_argv": argv,
               "elapsed_seconds": round(time.monotonic() - started, 3), "including_checkout_seconds": round(elapsed, 3),
               "source_hashes": before, "source_unchanged": before == after,
               "log_bytes": len(raw), "log_sha256": hashlib.sha256(raw).hexdigest(),
               "planner": planner, "planner_error": planner_error, "friendship_inputs": receipt,
               "native_qualified": False, "browser_qualified": False, "full_integration_qualified": False}
    payload = (json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(payload) > 16384:
        raise RuntimeError("bounded summary required")
    (COMPACT / "summary.json").write_bytes(payload)
    if not passed:
        (COMPACT / "failure.txt").write_bytes(raw[-60000:])
    print(json.dumps({key: summary[key] for key in ("status", "source_sha", "tests", "expected_tests", "elapsed_seconds")}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
