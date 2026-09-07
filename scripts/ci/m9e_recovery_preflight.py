"""Remote actual-source planner preflight; no native/browser qualification."""
import json
import os
from pathlib import Path
os.environ["M9E_REPORT_DIR"] = str(Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/planner")
import m9e_feedback as feedback
import m9e_coop_startup as coop
from m9e_coop_preflight import BASELINE_TARGETS

# Deliberate composition ancestor; latest audited checkpoint is b27ce85f/34089719925.
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
            or plan.get("requires_checkpoint_healing") is not True
            or plan.get("requires_natural_campaign_witnesses") is not True
            or plan.get("requires_struggle") is not True
            or plan.get("requires_canonical_value_digest") is not True
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
    checkpoint = "er-kernel:" + feedback.CHECKPOINT_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.CHECKPOINT_TARGET) != 1
            or plan["required_native_test_ids"].get(checkpoint) != feedback.CHECKPOINT_IDS):
        raise RuntimeError("both exact default checkpoint identities must remain mandatory")
    struggle = "er-kernel:" + feedback.STRUGGLE_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.STRUGGLE_TARGET) != 1
            or plan["required_native_test_ids"].get(struggle) != feedback.STRUGGLE_IDS):
        raise RuntimeError("both exact Struggle regressions must remain mandatory")
    canonical = "er-canonical:" + feedback.CANONICAL_TARGET
    if (plan["required_native_targets"].get("er-canonical", []).count(feedback.CANONICAL_TARGET) != 1
            or plan["required_native_test_ids"].get(canonical) != feedback.CANONICAL_IDS
            or len(feedback.CANONICAL_IDS) != 32
            or plan["execution_scope"].get("er-canonical") != [feedback.CANONICAL_TARGET]):
        raise RuntimeError("the complete canonical library and both new digest tests must remain mandatory")
    for crate, target in feedback.CAMPAIGN_TARGETS.items():
        if (plan["required_native_targets"].get(crate, []).count(target) != 1
                or plan["required_native_test_ids"].get(crate + ":" + target) != feedback.CAMPAIGN_TEST_IDS[crate]
                or target not in plan["execution_scope"].get(crate, []) or crate not in plan["packages"]):
            raise RuntimeError("all growth, natural 200-wave and replay witnesses must remain mandatory")
    if plan.get("requires_current_rng_witnesses") is not True:
        raise RuntimeError("current RNG compatibility obligation missing")
    for target, ids in feedback.RNG_TEST_IDS.items():
        if (plan["required_native_targets"].get("er-rng", []).count(target) != 1
                or plan["required_native_test_ids"].get("er-rng:" + target) != ids
                or target not in plan["execution_scope"].get("er-rng", []) or "er-rng" not in plan["packages"]):
            raise RuntimeError("all30 exact RNG test identities must remain mandatory")
    if (plan.get("requires_natural_coop_campaign") is not True
            or plan["required_native_targets"].get("er-kernel", []).count(feedback.COOP_CAMPAIGN_TARGET) != 1
            or plan["required_native_test_ids"].get("er-kernel:" + feedback.COOP_CAMPAIGN_TARGET) != feedback.COOP_CAMPAIGN_IDS
            or feedback.COOP_CAMPAIGN_TARGET not in plan["execution_scope"].get("er-kernel", [])):
        raise RuntimeError("complete natural co-op campaign must remain mandatory")
    if (plan.get("requires_coop_lost_receipt") is not True
            or plan["required_native_targets"].get("er-kernel", []).count(feedback.COOP_RECEIPT_TARGET) != 1
            or plan["required_native_test_ids"].get("er-kernel:" + feedback.COOP_RECEIPT_TARGET) != feedback.COOP_RECEIPT_IDS
            or feedback.COOP_RECEIPT_TARGET not in plan["execution_scope"].get("er-kernel", [])):
        raise RuntimeError("all three exact lost authority reply witnesses must remain mandatory")
    guard = plan.get("current_recovery_dependency_guard")
    if (guard is None or guard.get("status") != "verified" or guard.get("baseline_sha") != QUALIFIED_BASELINE
            or guard.get("dev_dependencies") != feedback.RECOVERY_DEV_EDGES
            or guard.get("manifests") != [f"rust/crates/{crate}/Cargo.toml" for crate in feedback.RECOVERY_DEV_EDGES]
            or guard.get("lock") != "rust/Cargo.lock"):
        raise RuntimeError("exact three test dependencies require a complete verified guard")
    product = [path for path in plan["changed_paths"] if path not in json.loads((feedback.ROOT / "scripts/ci/m9e-targets.json").read_bytes())["infrastructure_paths"]
               and not any(path.startswith(prefix) for prefix in json.loads((feedback.ROOT / "scripts/ci/m9e-targets.json").read_bytes())["documentation_prefixes"])]
    if len(product) != 34 or set(product) != set(feedback.RECOVERY_PATHS):
        raise RuntimeError("combined product source must be exactly the thirty-four reviewed paths")
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
    # A structural projection checks the real serializer's byte bound before a
    # costly combined run. These substituted fields are never game evidence.
    import copy
    import hashlib
    import m9e_phases as phases
    retained = list((Path(os.environ["RUNNER_TEMP"]) / "m9e-retained-aggregate").rglob("phase-summary.json"))
    if len(retained) != 1:
        raise RuntimeError("one qualified retained aggregate required")
    raw = retained[0].read_bytes()
    if len(raw) != 57869 or hashlib.sha256(raw).hexdigest() != "b6c57b85bcd7689d9a186fea91b32076784a692bdfa68e7322c0855f70ffbae2":
        raise RuntimeError("retained aggregate bytes differ")
    projected = json.loads(raw)
    if projected["product_sha"] != QUALIFIED_BASELINE or projected["identity"]["run_id"] != "34074237225":
        raise RuntimeError("retained aggregate identity differs")
    projected["identity"] = phases.identity(feedback)
    projected["product_sha"] = os.environ["GITHUB_SHA"]
    projected["current_coop_startup"]["replay_workers"] = 4
    projected["current_coop_startup"]["kernel_tests"] = 8
    projected["required_native_target_counts"]["er-kernel:m9e_coop_choices_v7"] = 8
    for target, ids in ((feedback.AI_COMMAND_TARGET, feedback.AI_COMMAND_IDS),
                        (feedback.REPLACEMENT_TARGET, feedback.REPLACEMENT_IDS),
                        (feedback.PROGRESSION_TARGET, feedback.PROGRESSION_IDS),
                        (feedback.CHECKPOINT_TARGET, feedback.CHECKPOINT_IDS),
                        (feedback.STRUGGLE_TARGET, feedback.STRUGGLE_IDS)):
        projected["required_native_target_counts"]["er-kernel:" + target] = len(ids)
    projected["required_native_target_counts"]["er-canonical:" + feedback.CANONICAL_TARGET] = 32
    for crate, target in feedback.CAMPAIGN_TARGETS.items():
        projected["required_native_target_counts"][crate + ":" + target] = len(feedback.CAMPAIGN_TEST_IDS[crate])
    projected["tests"] = {"selected": 741, "executed": 741, "passed": 741, "failed": 0, "skipped": 0}
    for target, ids in feedback.RNG_TEST_IDS.items():
        projected["required_native_target_counts"]["er-rng:" + target] = len(ids)
    projected["required_native_target_counts"]["er-kernel:" + feedback.COOP_CAMPAIGN_TARGET] = 1
    projected["required_native_target_counts"]["er-kernel:" + feedback.COOP_RECEIPT_TARGET] = 3
    projected["native_e_manifest_sha256"] = "0" * 64
    projected["natural_cooperative_campaign"] = {"status": "passed", "tests": 1, "wave": 200, "outcome": "Victory", "profile": "opt1-debug-assertions-overflow-checks", "decisions": 2188, "proposals": 258, "materials": 1675, "presentations": 3352, "rewards": 199, "progression": 950, "native_manifest_sha256": "0" * 64, "evidence_sha256": "0" * 64}
    frozen = copy.deepcopy(projected)
    digest = hashlib.sha256(phases.encoded(projected)).hexdigest()
    compact = phases.compact_summary(projected, digest, {})
    if projected != frozen or len(phases.encoded(compact)) > 16000:
        raise RuntimeError("projected compact bound or full metadata conservation failed")
    for key in ("identity", "tests", "required_native_target_counts", "current_coop_startup"):
        if compact[key] != projected[key]:
            raise RuntimeError("projected compact discarded required identity")
    receipt = {"status": "passed", "qualification": "structural compaction projection only; no native or platform qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "compact_bytes": len(phases.encoded(compact)), "retained_sha256": hashlib.sha256(raw).hexdigest()}
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/compact/compaction-projection.json").write_text(json.dumps(receipt, sort_keys=True) + "\n")
    print("Passed: actual combined thirty-four-path source scope, all79 prior targets, exact thirteen new kernel IDs and complete32-test canonical library, and retained co-op/platform/cost/rule/mutant obligations.")


if __name__ == "__main__":
    main()
