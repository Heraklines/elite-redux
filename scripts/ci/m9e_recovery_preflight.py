"""Remote actual-source planner preflight; no native/browser qualification."""
import json
import os
from pathlib import Path
os.environ["M9E_REPORT_DIR"] = str(Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/planner")
import m9e_feedback as feedback
import m9e_coop_startup as coop
from m9e_coop_preflight import BASELINE_TARGETS

# Replace only after the complete six-job candidate audit succeeds.
QUALIFIED_BASELINE = "79ba483d35f0559b2d2413f6f46ef48f62ba6061"


def main():
    feedback.FULL.mkdir(parents=True, exist_ok=True)
    plan = feedback.plan()
    if (plan["base_sha"] != QUALIFIED_BASELINE
            or plan.get("current_ai_command_transaction_focus") is not True
            or plan.get("requires_ai_command_transaction") is not True
            or plan.get("current_coop_startup_focus") is not True
            or plan.get("current_recovery_integration") is not True
            or plan.get("requires_natural_replacement") is not True
            or plan.get("requires_natural_progression") is not True
            or plan["unknown_paths"] or plan["boundary_paths"]):
        raise RuntimeError("combined recovery source plan is not its exact qualified scope")
    previous = [*BASELINE_TARGETS, list(coop.KERNEL_TARGET), list(coop.ENTRY_TARGET), ["er-game", "m9e_new_run_v6"]]
    if len(previous) != 79 or len({tuple(target) for target in previous}) != 79:
        raise RuntimeError("qualified baseline target inventory differs")
    for crate, target in previous:
        scope = plan["execution_scope"].get(crate, [])
        if crate not in plan["packages"] or not ("*" in scope or target in scope):
            raise RuntimeError(f"previously qualified target omitted: {crate}:{target}")
    key = "er-kernel:" + feedback.AI_COMMAND_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.AI_COMMAND_TARGET) != 1
            or plan["required_native_test_ids"].get(key) != feedback.AI_COMMAND_IDS):
        raise RuntimeError("all three exact AI transaction identities must remain mandatory")
    replacement = "er-kernel:" + feedback.REPLACEMENT_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.REPLACEMENT_TARGET) != 1
            or plan["required_native_test_ids"].get(replacement) != feedback.REPLACEMENT_IDS):
        raise RuntimeError("both exact natural replacement identities must remain mandatory")
    progression = "er-kernel:" + feedback.PROGRESSION_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.PROGRESSION_TARGET) != 1
            or plan["required_native_test_ids"].get(progression) != feedback.PROGRESSION_IDS):
        raise RuntimeError("exact natural progression identity must remain mandatory")
    product = [path for path in plan["changed_paths"] if path not in json.loads((feedback.ROOT / "scripts/ci/m9e-targets.json").read_bytes())["infrastructure_paths"]
               and not any(path.startswith(prefix) for prefix in json.loads((feedback.ROOT / "scripts/ci/m9e-targets.json").read_bytes())["documentation_prefixes"])]
    if len(product) != 8 or set(product) != set(feedback.RECOVERY_PATHS):
        raise RuntimeError("combined product source must be exactly the eight reviewed paths")
    inventory = [{"crate": crate, "target": target, "ids": list(ids), "historical_excluded_ids": []}
                 for (crate, target), ids in ((coop.KERNEL_TARGET, coop.KERNEL_IDS), (coop.ENTRY_TARGET, coop.ENTRY_IDS))]
    coop.validate_inventory(plan, inventory, os.environ["GITHUB_SHA"])
    if (plan["current_coop_startup_binding"] != coop.source_binding(feedback.ROOT, os.environ["GITHUB_SHA"])
            or plan.get("current_coop_dependency_guard") is not None):
        raise RuntimeError("retained co-op binding or unchanged dependency scope differs")
    for flag in ("requires_current_cost_probe", "requires_current_control_query", "requires_current_state_query",
                 "requires_current_proposal", "requires_read_rebind", "requires_ai_max_pp", "requires_title_storage",
                 "requires_title_retirement", "requires_worker_storage", "requires_current_storage",
                 "requires_current_coop_startup", "requires_browser", "requires_wasm", "requires_browser_worker",
                 "requires_browser_rtc", "requires_cli_executable", "requires_worker_executable"):
        if plan.get(flag) is not True:
            raise RuntimeError(f"previously qualified capability omitted: {flag}")
    if not plan.get("rule_worker") or not plan.get("timer_mutant") or not plan.get("replica_mutant"):
        raise RuntimeError("previously qualified rule or mutant evidence omitted")
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/diagnostics/integration-plan.json").write_text(json.dumps(plan, sort_keys=True) + "\n")
    print("Passed: actual combined eight-path source scope, all79 prior targets, exact six new IDs, and retained co-op/platform/cost/rule/mutant obligations.")


if __name__ == "__main__":
    main()
