BASELINE_TARGETS = [["er-agent-protocol","er_agent_protocol"],["er-batch","er_batch"],["er-batch","m9e_current_batch"],["er-cli","er-cli"],["er-cli","m9e_current_batch"],["er-cli","m9e_current_control_query"],["er-cli","m9e_current_entry"],["er-cli","m9e_current_native_capture"],["er-cli","m9e_current_reload"],["er-cli","m9e_current_repro"],["er-cli","m9e_current_rulechange_reload"],["er-cli","m9e_current_state_query"],["er-cli","m9e_current_state_query_worker"],["er-cli","m9e_current_title_storage"],["er-cli","m9e_current_validation"],["er-env","er_env"],["er-kernel","er_kernel"],["er-kernel","m1_keyboard_menu"],["er-kernel","m2_protocol_menu"],["er-kernel","m3_authority_commands"],["er-kernel","m3_battle_presentation"],["er-kernel","m3_battle_ui"],["er-kernel","m3_material_apply"],["er-kernel","m3_tail_proof_routing"],["er-kernel","m3_terminal_protocol"],["er-kernel","m4_snapshot_v3"],["er-kernel","m9e_coop_v7"],["er-kernel","m9e_current_proposal_v7"],["er-kernel","m9e_domain_journeys_v7"],["er-kernel","m9e_game_kernel_v7"],["er-kernel","m9e_material_retention_v7"],["er-kernel","m9e_snapshot_v7"],["er-kernel","m9e_timers_v7"],["er-kernel","m9e_title_storage"],["er-kernel-worker","current_process_v2"],["er-kernel-worker","er-kernel-worker"],["er-kernel-worker","er_kernel_worker"],["er-kernel-worker","process_smoke"],["er-kernel-worker","protocol_and_framing"],["er-lab","current_kernel_endpoint_faults_v2"],["er-lab","current_kernel_endpoint_v2"],["er-lab","current_kernel_supervisor_v2"],["er-lab","kernel_reload_acceptance"],["er-lab","kernel_reload_artifact"],["er-protocol","authority_v2_contract_map"],["er-protocol","authority_v2_properties"],["er-protocol","er_protocol"],["er-protocol","m2_authority_log"],["er-protocol","m2_proposal"],["er-protocol","m2_recovery"],["er-protocol","m2_replica"],["er-protocol","m2_scheduler"],["er-protocol","m2_successor"],["er-protocol","m2_validation"],["er-protocol","m3_battle_material"],["er-protocol","m3_battle_terminal"],["er-protocol","m3_local_authority_log"],["er-protocol","m3_tail_proof"],["er-protocol","m3_terminal_authority_log"],["er-repro","er_repro"],["er-repro","m9e_current_cost_probe"],["er-repro","m9e_current_repro"],["er-state","er_state"],["er-state","m3_battle_state"],["er-state","m3_pokemon_state"],["er-state","m3_validation"],["er-state","m4_foundation_properties"],["er-state","m4_migration"],["er-state","m4_state_v2"],["er-testkit","m72_foundation"],["er-wasm","m9e_parity"],["er-web","browser_host"],["er-web","er_web"],["er-web","m9e_host_v2"],["er-web","m9e_title_storage"],["er-web","production_save"]]

# Remote source/planner preflight only; no Rust, browser, generator or game execution.
import json
import os
from pathlib import Path
import m9e_feedback as feedback
import m9e_coop_startup as coop


def main():
    feedback.FULL.mkdir(parents=True, exist_ok=True)
    plan = feedback.plan()
    if (not plan.get("current_coop_startup_focus") or not plan.get("requires_current_coop_startup")
            or plan["base_sha"] != "7521edad32c0ff71448a5ba2bae19f451911f7b3"
            or plan["unknown_paths"] or plan["boundary_paths"]):
        raise RuntimeError("co-op integration source plan did not admit its exact scope")
    for crate, target in BASELINE_TARGETS:
        scope = plan["execution_scope"].get(crate, [])
        if crate not in plan["packages"] or not ("*" in scope or target in scope):
            raise RuntimeError(f"previously qualified target omitted: {crate}:{target}")
    inventory = [{"crate": crate, "target": target, "ids": list(ids), "historical_excluded_ids": []}
                 for (crate, target), ids in ((coop.KERNEL_TARGET, coop.KERNEL_IDS), (coop.ENTRY_TARGET, coop.ENTRY_IDS))]
    coop.validate_inventory(plan, inventory, os.environ["GITHUB_SHA"])
    if plan["current_coop_startup_binding"] != coop.source_binding(feedback.ROOT, os.environ["GITHUB_SHA"]):
        raise RuntimeError("actual co-op integration source binding differs")
    if plan["current_coop_dependency_guard"] != {"dependency": "er-protocol", "manifest": "rust/crates/er-cli/Cargo.toml",
            "lock": "rust/Cargo.lock", "baseline_sha": plan["base_sha"]}:
        raise RuntimeError("actual paired CLI dependency change differs")
    for flag in ("requires_current_cost_probe", "requires_current_control_query", "requires_current_state_query",
                 "requires_current_proposal", "requires_read_rebind", "requires_ai_max_pp", "requires_title_storage",
                 "requires_title_retirement", "requires_worker_storage", "requires_current_storage"):
        if plan.get(flag) is not True:
            raise RuntimeError(f"previously qualified capability omitted: {flag}")
    if not plan.get("rule_worker") or not plan.get("timer_mutant") or not plan.get("replica_mutant"):
        raise RuntimeError("previously qualified rule/mutant evidence omitted")
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/diagnostics/integration-plan.json").write_text(json.dumps(plan, sort_keys=True) + "\n")
    print("Passed: exact co-op scope, actual dependency guard, all76 prior targets, both new native targets and existing platform/cost/rule/mutant obligations.")


if __name__ == "__main__":
    main()
