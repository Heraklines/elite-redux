"""Remote typed Worker rebind and complete retained process/session qualification."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-gen2-worker-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
STARTED_AT = None
DEADLINE = None
run_bounded = None
BASE_SHA = "242b7cc890d1eac51b4b30fa4b432f95d0a7ba50"
BASE_TREE = "3cd57b76a2745515272b52e56f03c208510d4db3"
TARGETS = [
  [
    "er-repro",
    "m9e_current_rebind_repro",
    "rust/crates/er-repro/tests/m9e_current_rebind_repro.rs",
    [
      "deleted_reordered_or_forged_rebind_attempts_fail_replay",
      "natural_rebind_controls_and_generation_two_gameplay_replay_exactly",
      "rebind_response_admission_and_rejections_preserve_complete_session"
    ]
  ],
  [
    "er-repro",
    "m9e_current_repro",
    "rust/crates/er-repro/tests/m9e_current_repro.rs",
    [
      "broken_capture_continuity_cannot_export_a_false_complete_tail",
      "browser_generation_survives_rotation_import_and_kernel_rejections_without_protocol",
      "browser_transport_validation_checks_admission_continuity_and_outcome_separately",
      "byte_rotation_uses_full_serialized_capsule_bound",
      "count_rotation_retains_checkpoint_before_current_timer_consequence",
      "natural_title_to_battle_held_timer_capsule_replays_full_evidence",
      "oversized_attempt_adapter_gap_and_origin_failure_are_explicit_then_recover",
      "rejected_attempt_retains_game_frontier_and_replays_valid_retry",
      "replay_rejects_nonkey_omission_reordering_wrong_content_and_unsafe_positions"
    ]
  ],
  [
    "er-kernel",
    "m9e_current_coop_rebind_v7",
    "rust/crates/er-kernel/tests/m9e_current_coop_rebind_v7.rs",
    [
      "equal_frontier_native_rebind_commits_two_atomically_without_gameplay",
      "every_rebind_phase_restores_and_retries_exact_control_without_advancing_replay",
      "malformed_rebind_controls_and_generation_bypasses_preserve_full_snapshot",
      "open_rebind_executes_actual_owned_gameplay_and_retries_strict_v2_receipt",
      "open_rebind_receipt_and_owner_mutations_reject_with_complete_state_conservation",
      "open_rebind_replaces_original_v1_reply_atomically_at_capacity_one",
      "rebind_begin_and_replay_exhaustion_reject_without_retiring_existing_owners",
      "rebind_restore_checks_decision_binding_and_preserves_unrelated_scheduler_pause"
    ]
  ],
  [
    "er-kernel-worker",
    "current_process_v2",
    "rust/crates/er-kernel-worker/tests/current_process_v2.rs",
    [
      "actual_abi2_generations_restore_active_v7_and_continue_identical_typed_trace",
      "actual_abi2_process_rejects_bad_content_events_sequence_and_historical_snapshot",
      "actual_abi2_process_runs_current_natural_controls_and_non_key_time",
      "invalid_success_cap_rejects_bootstrap_and_omission_keeps_transport_default",
      "tiny_success_cap_reports_faults_without_initializing_or_disposing"
    ]
  ],
  [
    "er-lab",
    "current_kernel_supervisor_v2",
    "rust/crates/er-lab/tests/current_kernel_supervisor_v2.rs",
    [
      "accepted_activation_reports_failed_retirement_without_rejecting_candidate",
      "acknowledged_restore_context_survives_fault_and_is_preserved_by_reload",
      "byte_budget_rotates_at_absolute_frontier",
      "candidate_content_fault_and_generation_reuse_preserve_active",
      "effectful_success_budget_rejection_preserves_frontier_context_and_reload_limit",
      "exact_current_reload_replays_full_tail_then_continues_in_new_process",
      "prepared_reload_rejects_a_later_active_event_without_losing_progress",
      "retention_gap_reports_accepted_event_and_expires_previous_ticket",
      "tail_rotation_rejects_expired_ticket_and_replays_every_retained_event"
    ]
  ],
  [
    "er-lab",
    "current_kernel_endpoint_v2",
    "rust/crates/er-lab/tests/current_kernel_endpoint_v2.rs",
    [
      "current_executable_reference_rejects_wrong_hash_and_root_escape",
      "verified_current_endpoint_matches_session_and_restores_a_second_process"
    ]
  ],
  [
    "er-lab",
    "current_kernel_endpoint_faults_v2",
    "rust/crates/er-lab/tests/current_kernel_endpoint_faults_v2.rs",
    [
      "malformed_transport_peer_is_rejected_and_reaped",
      "silent_transport_peer_times_out_and_is_reaped"
    ]
  ],
  [
    "er-lab",
    "current_worker_rebind_v2",
    "rust/crates/er-lab/tests/current_worker_rebind_v2.rs",
    [
      "midphase_rebind_tail_reloads_and_explicit_gaps_expire_old_tickets",
      "natural_owned_workers_rebind_and_continue_generation_two_gameplay",
      "rebind_result_budget_rejection_preserves_worker_state_and_frontier"
    ]
  ]
]
REVERSE_PACKAGES = [
  "er-agent-protocol",
  "er-batch",
  "er-cli",
  "er-devplane",
  "er-env",
  "er-kernel-worker",
  "er-lab",
  "er-production",
  "er-repro",
  "er-sim",
  "er-testkit",
  "er-web"
]
REVERSE_TARGETS = {
  "er-agent-protocol:er_agent_protocol:lib": "rust/crates/er-agent-protocol/src/lib.rs",
  "er-batch:er_batch:lib": "rust/crates/er-batch/src/lib.rs",
  "er-batch:m9e_current_batch:test": "rust/crates/er-batch/tests/m9e_current_batch.rs",
  "er-cli:er-cli:bin": "rust/crates/er-cli/src/main.rs",
  "er-cli:m9e_current_batch:test": "rust/crates/er-cli/tests/m9e_current_batch.rs",
  "er-cli:m9e_current_control_query:test": "rust/crates/er-cli/tests/m9e_current_control_query.rs",
  "er-cli:m9e_current_coop_startup:test": "rust/crates/er-cli/tests/m9e_current_coop_startup.rs",
  "er-cli:m9e_current_entry:test": "rust/crates/er-cli/tests/m9e_current_entry.rs",
  "er-cli:m9e_current_native_capture:test": "rust/crates/er-cli/tests/m9e_current_native_capture.rs",
  "er-cli:m9e_current_reload:test": "rust/crates/er-cli/tests/m9e_current_reload.rs",
  "er-cli:m9e_current_repro:test": "rust/crates/er-cli/tests/m9e_current_repro.rs",
  "er-cli:m9e_current_rulechange_reload:test": "rust/crates/er-cli/tests/m9e_current_rulechange_reload.rs",
  "er-cli:m9e_current_state_query_worker:test": "rust/crates/er-cli/tests/m9e_current_state_query_worker.rs",
  "er-cli:m9e_current_state_query:test": "rust/crates/er-cli/tests/m9e_current_state_query.rs",
  "er-cli:m9e_current_title_storage:test": "rust/crates/er-cli/tests/m9e_current_title_storage.rs",
  "er-cli:m9e_current_validation:test": "rust/crates/er-cli/tests/m9e_current_validation.rs",
  "er-devplane:er_devplane:lib": "rust/crates/er-devplane/src/lib.rs",
  "er-env:er_env:lib": "rust/crates/er-env/src/lib.rs",
  "er-kernel-worker:current_process_v2:test": "rust/crates/er-kernel-worker/tests/current_process_v2.rs",
  "er-kernel-worker:er_kernel_worker:lib": "rust/crates/er-kernel-worker/src/lib.rs",
  "er-kernel-worker:er-kernel-worker:bin": "rust/crates/er-kernel-worker/src/main.rs",
  "er-kernel-worker:process_smoke:test": "rust/crates/er-kernel-worker/tests/process_smoke.rs",
  "er-kernel-worker:protocol_and_framing:test": "rust/crates/er-kernel-worker/tests/protocol_and_framing.rs",
  "er-lab:current_kernel_endpoint_faults_v2:test": "rust/crates/er-lab/tests/current_kernel_endpoint_faults_v2.rs",
  "er-lab:current_kernel_endpoint_v2:test": "rust/crates/er-lab/tests/current_kernel_endpoint_v2.rs",
  "er-lab:current_kernel_supervisor_v2:test": "rust/crates/er-lab/tests/current_kernel_supervisor_v2.rs",
  "er-lab:er_lab:lib": "rust/crates/er-lab/src/lib.rs",
  "er-lab:kernel_reload_acceptance:test": "rust/crates/er-lab/tests/kernel_reload_acceptance.rs",
  "er-lab:kernel_reload_artifact:test": "rust/crates/er-lab/tests/kernel_reload_artifact.rs",
  "er-production:er_production:lib": "rust/crates/er-production/src/lib.rs",
  "er-production:release_control:test": "rust/crates/er-production/tests/release_control.rs",
  "er-production:rollout_control:test": "rust/crates/er-production/tests/rollout_control.rs",
  "er-production:save_migration:test": "rust/crates/er-production/tests/save_migration.rs",
  "er-production:telemetry_control:test": "rust/crates/er-production/tests/telemetry_control.rs",
  "er-repro:er_repro:lib": "rust/crates/er-repro/src/lib.rs",
  "er-repro:m9e_current_cost_probe:test": "rust/crates/er-repro/tests/m9e_current_cost_probe.rs",
  "er-repro:m9e_current_rebind_repro:test": "rust/crates/er-repro/tests/m9e_current_rebind_repro.rs",
  "er-repro:m9e_current_repro:test": "rust/crates/er-repro/tests/m9e_current_repro.rs",
  "er-repro:m9e_natural_campaign_replay:test": "rust/crates/er-repro/tests/m9e_natural_campaign_replay.rs",
  "er-sim:er_sim:lib": "rust/crates/er-sim/src/lib.rs",
  "er-sim:m2_adapters:test": "rust/crates/er-sim/tests/m2_adapters.rs",
  "er-sim:m2_api_bypass:test": "rust/crates/er-sim/tests/m2_api_bypass.rs",
  "er-sim:m2_benchmark:bench": "rust/crates/er-sim/benches/m2_benchmark.rs",
  "er-sim:m2_clock:test": "rust/crates/er-sim/tests/m2_clock.rs",
  "er-sim:m2_command_campaign:test": "rust/crates/er-sim/tests/m2_command_campaign.rs",
  "er-sim:m2_interaction_campaign:test": "rust/crates/er-sim/tests/m2_interaction_campaign.rs",
  "er-sim:m2_network:test": "rust/crates/er-sim/tests/m2_network.rs",
  "er-sim:m2_recovery_campaign:test": "rust/crates/er-sim/tests/m2_recovery_campaign.rs",
  "er-sim:m2_replacement_campaign:test": "rust/crates/er-sim/tests/m2_replacement_campaign.rs",
  "er-sim:m2_resource_teardown:test": "rust/crates/er-sim/tests/m2_resource_teardown.rs",
  "er-sim:m2_suspend_reconnect:test": "rust/crates/er-sim/tests/m2_suspend_reconnect.rs",
  "er-sim:m3_api_bypass:test": "rust/crates/er-sim/tests/m3_api_bypass.rs",
  "er-sim:m3_benchmark:bench": "rust/crates/er-sim/benches/m3_benchmark.rs",
  "er-sim:m3_fault_recovery:test": "rust/crates/er-sim/tests/m3_fault_recovery.rs",
  "er-sim:m3_pair_trace_live:test": "rust/crates/er-sim/tests/m3_pair_trace_live.rs",
  "er-sim:m3_presenter:test": "rust/crates/er-sim/tests/m3_presenter.rs",
  "er-sim:m3_raw_key_coop:test": "rust/crates/er-sim/tests/m3_raw_key_coop.rs",
  "er-sim:m3_raw_key_local:test": "rust/crates/er-sim/tests/m3_raw_key_local.rs",
  "er-sim:m3_resource_teardown:test": "rust/crates/er-sim/tests/m3_resource_teardown.rs",
  "er-sim:m3_snapshot_continuation:test": "rust/crates/er-sim/tests/m3_snapshot_continuation.rs",
  "er-sim:m3_trace_v2:test": "rust/crates/er-sim/tests/m3_trace_v2.rs",
  "er-sim:m4_battle_start_v2:test": "rust/crates/er-sim/tests/m4_battle_start_v2.rs",
  "er-sim:m4_pair_snapshot_v3:test": "rust/crates/er-sim/tests/m4_pair_snapshot_v3.rs",
  "er-sim:m4_raw_key_coop:test": "rust/crates/er-sim/tests/m4_raw_key_coop.rs",
  "er-sim:m4_raw_key_local:test": "rust/crates/er-sim/tests/m4_raw_key_local.rs",
  "er-sim:m4_run_faults:test": "rust/crates/er-sim/tests/m4_run_faults.rs",
  "er-sim:m4_runtime_benchmark:bench": "rust/crates/er-sim/benches/m4_runtime_benchmark.rs",
  "er-sim:m9_solo_entry:test": "rust/crates/er-sim/tests/m9_solo_entry.rs",
  "er-testkit:er_testkit:lib": "rust/crates/er-testkit/src/lib.rs",
  "er-testkit:keyboard_driver_api:test": "rust/crates/er-testkit/tests/keyboard_driver_api.rs",
  "er-testkit:m2_pair_driver:test": "rust/crates/er-testkit/tests/m2_pair_driver.rs",
  "er-testkit:m3_foundation_properties:test": "rust/crates/er-testkit/tests/m3_foundation_properties.rs",
  "er-testkit:m5_atomic_executor:test": "rust/crates/er-testkit/tests/m5_atomic_executor.rs",
  "er-testkit:m5_runtime_benchmark:bench": "rust/crates/er-testkit/benches/m5_runtime_benchmark.rs",
  "er-testkit:m6_ability_parity:test": "rust/crates/er-testkit/tests/m6_ability_parity.rs",
  "er-testkit:m6_bespoke_closure:test": "rust/crates/er-testkit/tests/m6_bespoke_closure.rs",
  "er-testkit:m6_bypass:test": "rust/crates/er-testkit/tests/m6_bypass.rs",
  "er-testkit:m6_coop_campaigns:test": "rust/crates/er-testkit/tests/m6_coop_campaigns.rs",
  "er-testkit:m6_field_parity:test": "rust/crates/er-testkit/tests/m6_field_parity.rs",
  "er-testkit:m6_foundation:test": "rust/crates/er-testkit/tests/m6_foundation.rs",
  "er-testkit:m6_item_parity:test": "rust/crates/er-testkit/tests/m6_item_parity.rs",
  "er-testkit:m6_migration:test": "rust/crates/er-testkit/tests/m6_migration.rs",
  "er-testkit:m6_move_parity:test": "rust/crates/er-testkit/tests/m6_move_parity.rs",
  "er-testkit:m6_native_wasm:test": "rust/crates/er-testkit/tests/m6_native_wasm.rs",
  "er-testkit:m6_performance:test": "rust/crates/er-testkit/tests/m6_performance.rs",
  "er-testkit:m6_prepared_parity:test": "rust/crates/er-testkit/tests/m6_prepared_parity.rs",
  "er-testkit:m6_properties:test": "rust/crates/er-testkit/tests/m6_properties.rs",
  "er-testkit:m6_routine_mapping:test": "rust/crates/er-testkit/tests/m6_routine_mapping.rs",
  "er-testkit:m6_snapshot_v5:test": "rust/crates/er-testkit/tests/m6_snapshot_v5.rs",
  "er-testkit:m6_solo_campaigns:test": "rust/crates/er-testkit/tests/m6_solo_campaigns.rs",
  "er-testkit:m6_species_form_parity:test": "rust/crates/er-testkit/tests/m6_species_form_parity.rs",
  "er-testkit:m7_behavior_proofs:test": "rust/crates/er-testkit/tests/m7_behavior_proofs.rs",
  "er-testkit:m7_causal_spine:test": "rust/crates/er-testkit/tests/m7_causal_spine.rs",
  "er-testkit:m7_foundation:test": "rust/crates/er-testkit/tests/m7_foundation.rs",
  "er-testkit:m7_full_run_differential:test": "rust/crates/er-testkit/tests/m7_full_run_differential.rs",
  "er-testkit:m7_randomized_campaigns:test": "rust/crates/er-testkit/tests/m7_randomized_campaigns.rs",
  "er-testkit:m7_raw_key_coop:test": "rust/crates/er-testkit/tests/m7_raw_key_coop.rs",
  "er-testkit:m7_raw_key_solo:test": "rust/crates/er-testkit/tests/m7_raw_key_solo.rs",
  "er-testkit:m7_system_proof:test": "rust/crates/er-testkit/tests/m7_system_proof.rs",
  "er-testkit:m71_final_integration:test": "rust/crates/er-testkit/tests/m71_final_integration.rs",
  "er-testkit:m71_foundation:test": "rust/crates/er-testkit/tests/m71_foundation.rs",
  "er-testkit:m71_reproduction:test": "rust/crates/er-testkit/tests/m71_reproduction.rs",
  "er-testkit:m72_autonomous:test": "rust/crates/er-testkit/tests/m72_autonomous.rs",
  "er-testkit:m72_final:test": "rust/crates/er-testkit/tests/m72_final.rs",
  "er-testkit:m72_foundation:test": "rust/crates/er-testkit/tests/m72_foundation.rs",
  "er-web:browser_host:test": "rust/crates/er-web/tests/browser_host.rs",
  "er-web:er_web:cdylib,rlib": "rust/crates/er-web/src/lib.rs",
  "er-web:m9e_host_v2:test": "rust/crates/er-web/tests/m9e_host_v2.rs",
  "er-web:m9e_title_storage:test": "rust/crates/er-web/tests/m9e_title_storage.rs",
  "er-web:m9e_v7_browser_fixtures:example": "rust/crates/er-web/examples/m9e_v7_browser_fixtures.rs",
  "er-web:m9e_v7_coop_startup:example": "rust/crates/er-web/examples/m9e_v7_coop_startup.rs",
  "er-web:m9e_v7_storage_fixtures:example": "rust/crates/er-web/examples/m9e_v7_storage_fixtures.rs",
  "er-web:m9e_v7_title_storage_fixtures:example": "rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs",
  "er-web:production_save:test": "rust/crates/er-web/tests/production_save.rs",
  "er-lab:current_worker_rebind_v2:test": "rust/crates/er-lab/tests/current_worker_rebind_v2.rs"
}
BASE_SOURCES = {
  "rust/Cargo.lock": [
    "171f5b72e2a2816bdf46b78766a94fd231b65a70155ace5ac564924de321985b",
    32067
  ],
  "rust/Cargo.toml": [
    "fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",
    1615
  ],
  "rust/crates/er-agent-protocol/Cargo.toml": [
    "3ebb14a18c6d5b42b951f91025600a728df389104e9e1858a6800e716ff9041a",
    435
  ],
  "rust/crates/er-agent-protocol/src/ingress_diagnostic_tests.rs": [
    "fdb188092c31adacf55f4c7093bfd26c54bd6b0efb7bebdf7d6637eb78ebccf9",
    3685
  ],
  "rust/crates/er-agent-protocol/src/lib.rs": [
    "e78880be1f883dddccad8f12a642aa9587af6f341fafcbf33583997a42c9666f",
    24430
  ],
  "rust/crates/er-agent-protocol/src/m72.rs": [
    "1c26911fa67f5c8f25e91f9f27c9665002a38e3e90d24a9eec5c261902c57135",
    2427
  ],
  "rust/crates/er-ai/Cargo.toml": [
    "cbb210e7444fc482a409b051c3fd345d3bb95e937ec041668943ee11f69808d8",
    369
  ],
  "rust/crates/er-batch/Cargo.toml": [
    "b30c4189c81fc515421a2fa4c5050a3f5161cfad0fad3206a9d104ce9b725ab8",
    526
  ],
  "rust/crates/er-battle/Cargo.toml": [
    "2c132fed3acb005492e2e2880991a83b222a79da923de9527d1f21a2e96e92c7",
    523
  ],
  "rust/crates/er-canonical/Cargo.toml": [
    "e85c5c00c5ce0d090480c453ca66ef51b7904f454e438e9444c463917af7b771",
    272
  ],
  "rust/crates/er-cli/Cargo.toml": [
    "99a8a3e5ed468a3d8c234ef24347df0cf75c267f1635dd1e94475751b38888bc",
    800
  ],
  "rust/crates/er-cli/src/current_agent.rs": [
    "e82741335197df51758ae662e7e47616830b4aa1c193028595c854f828855cb5",
    34869
  ],
  "rust/crates/er-cli/src/current_commands.rs": [
    "b55422878ef013515e76ee54f5434d17ff8bf86edf4f493f5f509c4e4767c5d7",
    9748
  ],
  "rust/crates/er-cli/src/current_native_capture.rs": [
    "39097bd1d6a53316a47463325f9e8b8c9bf9b0c74b2454a5ff08864cdf2292e2",
    6644
  ],
  "rust/crates/er-cli/src/current_worker_agent.rs": [
    "affa4d5729689cbd84706c697e6811658c44ed87cb2ec50fc2a23d400a737c20",
    12975
  ],
  "rust/crates/er-cli/src/main.rs": [
    "b2aea1a208d77f40159dbb191e71f45f67dafc63ac314b95730baf6e515d415c",
    18744
  ],
  "rust/crates/er-cli/tests/m9e_current_coop_startup.rs": [
    "5f1de82e723d489952aa8a33637911d69a643f4d0220672179069196aebede0a",
    24866
  ],
  "rust/crates/er-cli/tests/m9e_current_entry.rs": [
    "38825b9628ce99e97458ee3c55b5f049b07b64bb6d88a5c68611fd7d9111a580",
    22692
  ],
  "rust/crates/er-cli/tests/m9e_current_native_capture.rs": [
    "d120fdb7c691afe15966c3939275d4c7c676a4a50de3ee4e66dda530fcb41978",
    40785
  ],
  "rust/crates/er-cli/tests/m9e_current_repro.rs": [
    "b4076de6dcb68c264517050923cf3461266b2e182a3dce566697bdbbfc840ee9",
    22926
  ],
  "rust/crates/er-cli/tests/support/m9e_coop_cli_process.rs": [
    "2065ee7babe6bed4be301361fd57c534f3889d889affb4b26c78a733cec88e42",
    9308
  ],
  "rust/crates/er-content-compiler/Cargo.toml": [
    "1d7e5526456515782ea15c8580fe7ea1b32a138b0b48c27d8dac5d484864639e",
    609
  ],
  "rust/crates/er-content/Cargo.toml": [
    "740a59247975794bd8128280bc57ff5b3077908cf77cdee68a87fd7e04d0c1bf",
    370
  ],
  "rust/crates/er-dev-types/Cargo.toml": [
    "f0eda99374bdef7ee4bdddd10f0d750bca130642ae8ada2a1b06df56fc0788bd",
    324
  ],
  "rust/crates/er-devplane/Cargo.toml": [
    "8875f40d8a4fe8c8060b4fc99c007d29ae88cc641cf63fcf60ad93450e967ef2",
    595
  ],
  "rust/crates/er-env/Cargo.toml": [
    "19d78de60a3d7a25fa3e81d181cf4d67424fc30e6426f975e846264a0aeda4c9",
    444
  ],
  "rust/crates/er-env/src/current.rs": [
    "44f79c9ec052de14e977c97588fdf2fe30cc04e7fc94fad524a5622ef8d3e574",
    14593
  ],
  "rust/crates/er-env/src/lib.rs": [
    "ee7c14bb80cb29dca8927bb5169eaa9b108f61cba4a7ce310b0be9938141bbed",
    6661
  ],
  "rust/crates/er-game/Cargo.toml": [
    "b70213bb098d0723abe81d944583620938f607237800354f66f401b058e99fb4",
    691
  ],
  "rust/crates/er-game/src/m72_bootstrap.rs": [
    "54369e34edc90a194f425e677a21e3ba7ce64dff46a4af9b688e4821a511dccc",
    30759
  ],
  "rust/crates/er-game/src/m9e_content_v2.rs": [
    "2f597cba4b09edd84aa52d3120a9ed113be1002d134867496d8b296148e5ba25",
    23350
  ],
  "rust/crates/er-game/src/m9e_material_v6.rs": [
    "0506f2c4d093036aef38ebcac5a0c5c05818e8c78202bccfe7a921afa853b467",
    23149
  ],
  "rust/crates/er-game/src/m9e_runtime_v6.rs": [
    "51792a4093785dd24be3981867af1b3adbbe6c3d736d9c6dc2dedafce24d9fbc",
    110747
  ],
  "rust/crates/er-impact/Cargo.toml": [
    "0184fd654e7f4d20739ba88aa9a081dc9398daefee52f87fc3d3d29794f0bcf5",
    329
  ],
  "rust/crates/er-kernel-worker/Cargo.toml": [
    "9d75a466a178f0ca1c53d49176fcc739a2d02e3d4a01bf94bddd0618a90fde0f",
    619
  ],
  "rust/crates/er-kernel-worker/src/framing.rs": [
    "0ba1ade1a059f8006f5d10f7613df2d76a43e1343a9cfbaf81777d1d65f034ba",
    1748
  ],
  "rust/crates/er-kernel-worker/src/lib.rs": [
    "c23f9e52ed28827c0c62f0655a021bddc80655a8b4cf8104909b68877d1cbc44",
    283
  ],
  "rust/crates/er-kernel-worker/src/main.rs": [
    "4f7cc39fdceefabb87a91b0a8d382aeab05ca8eead14e94d14d2b92d8be41b4b",
    3015
  ],
  "rust/crates/er-kernel-worker/src/protocol_v2.rs": [
    "c743d0419df7b9178225e372f0f49c0a72c3f72df38c700da2e6659d09717439",
    12144
  ],
  "rust/crates/er-kernel-worker/src/runtime_v2.rs": [
    "f013a716b8ef2b18f2dd07d46df82bfb814614effb9574c875f8cf3ab47eb35a",
    15899
  ],
  "rust/crates/er-kernel/Cargo.toml": [
    "2b244502f54359df2852f5f05051a149154629a131f7b862c33a72c12f5aaabd",
    706
  ],
  "rust/crates/er-kernel/src/current_coop_rebind_v7.rs": [
    "73f8f76e5ce3181682f519170599023ee41584dc95f1e00db47e3ca45393b086",
    36143
  ],
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs": [
    "c4e8dbeef2a41d4e316d5aac6082feff132348a4e8cd8cbb0620bab1682b37b7",
    29287
  ],
  "rust/crates/er-kernel/src/current_proposal_v7.rs": [
    "98cd877c1d54e3e2a7d9f388423b14e63a2ce89fcb42514f59e6ac48fa2ffa1e",
    24802
  ],
  "rust/crates/er-kernel/src/game_kernel_v7.rs": [
    "0a8cd79f25bae24a589bd6c38682708fa8816787241c83e534f746b707ce5ae0",
    161847
  ],
  "rust/crates/er-kernel/src/snapshot_v7.rs": [
    "e247dbf85f7d473f9d02d54b08f0b86d5630aa37bfd39e5645ef7b3366449e7a",
    22224
  ],
  "rust/crates/er-kernel/tests/m9e_current_coop_rebind_v7.rs": [
    "fc20a2a6985d47144e0a4012b7488895887874df8d452d5ea0e71f3d1a7c750c",
    47847
  ],
  "rust/crates/er-lab/Cargo.toml": [
    "7758e076e32a4f1a0aa50bdd2d23978e4cc8245c88657ec4fb9afa4bbaf88b2e",
    968
  ],
  "rust/crates/er-mechanics/Cargo.toml": [
    "db508b3d631f54ff1e983222f1144b3014c1f2cabe9f150320447f848e48f88c",
    304
  ],
  "rust/crates/er-model/Cargo.toml": [
    "769adc8ce1e5f25382daeca97baefe8c525be769985cf82e7a980a1e3b1c23b5",
    364
  ],
  "rust/crates/er-production/Cargo.toml": [
    "96246d9a96b02583450692caa39ef5fd63e84a425c55f2c84cf7e659be84114d",
    576
  ],
  "rust/crates/er-progression/Cargo.toml": [
    "4b05b5c0420d4813131ea673f25672afba4d1e13ee1cb3eec2f8ccc8e27ea0b0",
    474
  ],
  "rust/crates/er-protocol/Cargo.toml": [
    "c6c67ea6f4dff5dc520b9b039fe7606004fab00d1f9726195abf41e20d9f8e2e",
    327
  ],
  "rust/crates/er-render-model/Cargo.toml": [
    "f89a174a7c49f506e0d47198e8e48a550a8620e7aff61fcca0904e09bfbc101f",
    303
  ],
  "rust/crates/er-renderer/Cargo.toml": [
    "89d81edeedeec407da2501a07a8756090f67c4fb79b75701a60f641c432541fc",
    319
  ],
  "rust/crates/er-repro/Cargo.toml": [
    "9f45b6e0afbebc66d9d6a4da787c26d1d3ad50b986d0708c207cf238eac6aa19",
    674
  ],
  "rust/crates/er-repro/src/current.rs": [
    "b0c33a6b991af35b51105f0eedf0de6586a22f1b49e536ad8ae73466c141800b",
    37102
  ],
  "rust/crates/er-repro/src/lib.rs": [
    "7f05e3d3886cda23efc6467c3cff4cda907a11433e3b3dd9cd9d34bfa240de63",
    994
  ],
  "rust/crates/er-repro/tests/m9e_current_rebind_repro.rs": [
    "ea91f7112c8992095922fe1f53e28b7724537e0e7727fbf58089cb0e9a6b2eb4",
    37886
  ],
  "rust/crates/er-repro/tests/m9e_current_repro.rs": [
    "4bbf4d0818089220577878f1c99c08a2479da8ebf3a9e9c14f57cb7359498835",
    39994
  ],
  "rust/crates/er-rng/Cargo.toml": [
    "7692623c46143d0764e39cd50f53b00850abeb77f5e418be1c32ff1062e9ec93",
    322
  ],
  "rust/crates/er-run/Cargo.toml": [
    "77e7a257a4003635f7c219a221ef4e1ecc069f7ebff5728ece500ff1c01b5b0f",
    500
  ],
  "rust/crates/er-save/Cargo.toml": [
    "ab96feeb7b63dbe2165c57191f6dd90ffe80855b03f5efb8420434e5aacd0228",
    381
  ],
  "rust/crates/er-scenario/Cargo.toml": [
    "1557e9fd76fd7b88c12860261522324e6ed9b136fa4623c93663d3fc9caaaf12",
    335
  ],
  "rust/crates/er-sim/Cargo.toml": [
    "dd49e05b133537ef0f4b6db34c5996406b2459e11add95707a8f73dfdec9d832",
    756
  ],
  "rust/crates/er-state/Cargo.toml": [
    "ab600653565bead557af150815f5547c31b96d570264934dc60572d4b50509a6",
    400
  ],
  "rust/crates/er-state/src/m9e_state_v6.rs": [
    "f4aeedff5dfad585f046c55856e1eb9cd66f1a997bda1286401c0012e0c26d23",
    14128
  ],
  "rust/crates/er-testkit/Cargo.toml": [
    "ee8f5eaca0199618dc8d5e6d20e81cbf205775a119f1c155b15f385c3fe83320",
    1480
  ],
  "rust/crates/er-types/Cargo.toml": [
    "9fba0a9a17a94f7f9981570ee382750e6d56d727ee7a234718a636e37d36de42",
    244
  ],
  "rust/crates/er-wasm/Cargo.toml": [
    "bc664365f8987e882b5433ac980c06ad61f64759c9280c0d6b164258e14d0de6",
    756
  ],
  "rust/crates/er-web/Cargo.toml": [
    "5f42905bb819359deae3b08998cc80a5576e501cd5be23e25c7d6dad39b8f613",
    852
  ],
  "rust/crates/er-web/src/lib.rs": [
    "7dd19e7616116431666fc1af72600a4ad869a9a73812936317da1028544b562e",
    1498
  ],
  "rust/crates/er-world/Cargo.toml": [
    "00d217d27177ba0cf0b7fc434f8df648616dc3fa52a70ae0f7b9f4d8f9a84f48",
    332
  ],
  "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json": [
    "aa8da070c2f929dc4e9903d4adf0455e164d5980d9be506ce5700267cd187698",
    1219
  ],
  "rust/rust-toolchain.toml": [
    "0241de2190a0c1959d4ad182dfa6943b7ab9bd577dc8ef9b0fe7502d191835ec",
    123
  ],
  "scripts/ci/m9e_current_cost.py": [
    "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75",
    38615
  ],
  "rust/crates/er-lab/src/kernel_reload/endpoint_v2.rs": [
    "62e4c8184e471d92540746ac3f346101941e5a321f95d314e467891cc35b5207",
    21329
  ],
  "rust/crates/er-lab/src/kernel_reload/supervisor_v2.rs": [
    "4157d724f5e2461ea50df28ad7e705b24e2707fde8f29ac29eac5e7c5a0f9c40",
    15547
  ],
  "rust/crates/er-lab/src/kernel_reload/types_v2.rs": [
    "1d292f177a3e4ea034aa404ea15514bb166a8e89a6538ac43b138e08ab87620b",
    1584
  ],
  "rust/crates/er-kernel-worker/tests/current_process_v2.rs": [
    "4aedbb665d00126cfbd56ad72e434a570aa022b5239e0e7af6b5be8d608df0a1",
    23168
  ],
  "rust/crates/er-lab/tests/current_kernel_supervisor_v2.rs": [
    "1498018daa2785d0cfd5bce6c9d64190e862430f91401a5205af09cb0edf700d",
    26581
  ],
  "rust/crates/er-lab/tests/current_kernel_endpoint_v2.rs": [
    "30c0ba57d71a9a29fb37aac607bd2dcc1a004684271779e409f41ca2567f1b51",
    8616
  ],
  "rust/crates/er-lab/tests/current_kernel_endpoint_faults_v2.rs": [
    "203c3187fca57bf7407634be7c431f4edfc3fe86c52790b31a0d45633ee8297e",
    6404
  ]
}
RUST_SOURCES = [
  "rust/crates/er-kernel-worker/src/protocol_v2.rs",
  "rust/crates/er-kernel-worker/src/runtime_v2.rs",
  "rust/crates/er-lab/src/kernel_reload/endpoint_v2.rs",
  "rust/crates/er-lab/src/kernel_reload/supervisor_v2.rs",
  "rust/crates/er-lab/src/kernel_reload/types_v2.rs",
  "rust/crates/er-lab/tests/current_worker_rebind_v2.rs"
]
PRODUCT_SOURCES = ["rust/Cargo.lock","rust/crates/er-kernel-worker/src/protocol_v2.rs","rust/crates/er-kernel-worker/src/runtime_v2.rs","rust/crates/er-lab/Cargo.toml","rust/crates/er-lab/src/kernel_reload/endpoint_v2.rs","rust/crates/er-lab/src/kernel_reload/supervisor_v2.rs","rust/crates/er-lab/src/kernel_reload/types_v2.rs","rust/crates/er-lab/tests/current_worker_rebind_v2.rs"]
CI_SOURCES = ["scripts/ci/m9e_gen2_worker_diagnostic.py", ".github/workflows/m9e-gen2-worker-focused.yml"]
CHANGED_SOURCES = sorted(PRODUCT_SOURCES + CI_SOURCES)
ADDED_SOURCES = sorted(["rust/crates/er-lab/tests/current_worker_rebind_v2.rs", *CI_SOURCES])
FIXTURE_INPUTS = {
    "rust/fixtures/m9/engineering/game-content-bundle-v2.json": [
        15810979, "6b435b78bc4d62c7f492142752c91610b914a071",
        "640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4"
    ]
}
SOURCES = sorted(set(BASE_SOURCES) | set(CHANGED_SOURCES))
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0",
           "CARGO_PROFILE_TEST_OPT_LEVEL": "0", "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true",
           "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true", "CARGO_PROFILE_TEST_DEBUG": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
sequence = 0
logs = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20):
    global sequence, failed_log
    if not 0 < seconds <= 600 or DEADLINE is None or run_bounded is None:
        raise RuntimeError("command exceeds fixed 600-second ceiling")
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT / "rust" if cwd is None else cwd,
                             environment=dict(os.environ), output=output, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE - 20)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    return output


def cleanup_target():
    if TARGET.is_symlink() or TARGET.resolve().parent != REPORT.resolve():
        raise RuntimeError("owned target containment differs")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    if TARGET.exists():
        raise RuntimeError("owned target cleanup incomplete")


def source_conservation(summary, phase):
    if not 0 <= time.time() - STARTED_AT <= 1800:
        raise RuntimeError("pre-checkout shared deadline absent or exhausted")
    tree = run(["git", "rev-parse", BASE_SHA + "^{tree}"], "base-tree-" + phase,
               cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if tree != BASE_TREE:
        raise RuntimeError("exact unchanged base tree required")
    changes = run(["git", "diff", "--name-status", "--no-renames", BASE_SHA, "HEAD", "--"],
                  "base-delta-" + phase, cwd=ROOT, seconds=30, bound=16384).read_text().splitlines()
    expected = sorted(("A" if name in ADDED_SOURCES else "M") + "\t" + name for name in CHANGED_SOURCES)
    if sorted(changes) != expected:
        raise RuntimeError("only exact five protocol/CLI product and two additive CI paths may differ from qualified session/repro successor")
    status = run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-" + phase,
                 cwd=ROOT, seconds=30, bound=16384).read_text()
    if status:
        raise RuntimeError("tracked candidate bytes differ from committed source")
    for name in SOURCES:
        path = ROOT / name
        if (path.is_symlink() or not path.is_file() or path.resolve() != path
                or not 0 < path.stat().st_size <= 4 << 20):
            raise RuntimeError("named small source containment/size differs")
        if name in BASE_SOURCES and name not in PRODUCT_SOURCES:
            expected_hash, expected_bytes = BASE_SOURCES[name]
            if path.stat().st_size != expected_bytes or digest(path) != expected_hash:
                raise RuntimeError("unchanged source differs from reviewed qualified successor bytes: " + name)
    summary["base_conservation"] = {"tree": BASE_TREE, "changed_paths": CHANGED_SOURCES,
                                    "unchanged_small_sources": len(set(BASE_SOURCES) - set(PRODUCT_SOURCES)),
                                    "phase": phase}


def compile_reverse_consumers(summary):
    metadata = run(["cargo", "metadata", "--locked", "--no-deps", "--format-version=1"],
                   "reverse-source-metadata", seconds=60).read_text()
    packages = json.loads(metadata)["packages"]
    graph = {row["name"]: {dep["name"] for dep in row["dependencies"] if dep.get("path") is not None}
             for row in packages}
    closure = {"er-env", "er-repro"}
    while True:
        expanded = closure | {name for name, dependencies in graph.items() if dependencies & closure}
        if expanded == closure:
            break
        closure = expanded
    if sorted(closure) != REVERSE_PACKAGES:
        raise RuntimeError("actual complete reverse dependency closure differs from pinned manifests")
    selected = [row for row in packages if row["name"] in closure]
    expected = {}
    for row in selected:
        manifest = ROOT / f"rust/crates/{row['name']}/Cargo.toml"
        if row["manifest_path"] != str(manifest) or not row["targets"]:
            raise RuntimeError("reverse consumer package source differs")
        for target in row["targets"]:
            key = row["name"] + ":" + target["name"] + ":" + ",".join(target["kind"])
            source = Path(target["src_path"])
            if (key in expected or not source.is_absolute() or source.is_symlink()
                    or not source.is_file() or source.resolve() != source
                    or not source.is_relative_to(manifest.parent)):
                raise RuntimeError("reverse target source inventory differs")
            expected[key] = str(source.relative_to(ROOT))
    if expected != REVERSE_TARGETS:
        raise RuntimeError("actual complete target metadata differs from source-tree inventory")
    command = ["cargo", "check", "--locked", "--all-targets"]
    for package in REVERSE_PACKAGES:
        command.extend(["-p", package])
    build = run([*command, "--message-format=json"], "reverse-all-targets-check")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("reverse all-targets compilation did not complete")
    seen = set()
    manifests = {str(ROOT / f"rust/crates/{name}/Cargo.toml"): name for name in REVERSE_PACKAGES}
    for row in rows:
        if row.get("reason") != "compiler-artifact" or row.get("manifest_path") not in manifests:
            continue
        target = row["target"]
        key = manifests[row["manifest_path"]] + ":" + target["name"] + ":" + ",".join(target["kind"])
        if (key not in expected or target["src_path"] != str(ROOT / expected[key])
                or row.get("profile", {}).get("opt_level") != "0"
                or row["profile"].get("debug_assertions") is not True
                or row["profile"].get("debuginfo") != 0):
            raise RuntimeError("compiled reverse target/profile differs from actual source inventory")
        seen.add(key)
    if seen != set(expected):
        raise RuntimeError("all declared reverse-consumer targets must really compile")
    clippy = ["cargo", "clippy", "--locked", "--all-targets", "--no-deps"]
    for package in REVERSE_PACKAGES:
        clippy.extend(["-p", package])
    run([*clippy, "--", "-D", "warnings"], "reverse-all-targets-clippy")
    summary["reverse_compile"] = {
        "packages": REVERSE_PACKAGES,
        "target_inventory_sha256": hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
        "target_count": len(expected), "all_targets": True, "clippy_warnings_denied": True,
        "check_log_sha256": digest(build), "executed": False,
    }

def executable_bindings(summary):
    version = run(["rustc", "--version", "--verbose"], "compiler-host", seconds=30, bound=16384).read_text()
    hosts = re.findall(r"^host: ([a-z0-9_]+-[a-z0-9_-]+)$", version, re.M)
    if hosts != ["x86_64-unknown-linux-gnu"]:
        raise RuntimeError("actual Ubuntu runner compiler host differs")
    build = run(["cargo", "build", "--locked", "-p", "er-cli", "-p", "er-kernel-worker",
                 "--bins", "--message-format=json"], "actual-cli-and-worker-binaries")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("actual CLI and Worker binary build did not complete")
    bindings = {}
    for crate in ("er-cli", "er-kernel-worker"):
        matches = [row for row in rows if row.get("reason") == "compiler-artifact"
                   and row.get("target", {}).get("name") == crate
                   and row.get("target", {}).get("kind") == ["bin"]
                   and row.get("profile", {}).get("test") is False]
        if len(matches) != 1:
            raise RuntimeError("one exact current binary artifact required: " + crate)
        artifact = matches[0]
        path = Path(artifact.get("executable") or "")
        source = f"rust/crates/{crate}/src/main.rs"
        if (artifact.get("manifest_path") != str(ROOT / f"rust/crates/{crate}/Cargo.toml")
                or artifact["target"].get("src_path") != str(ROOT / source)
                or artifact.get("features") != []
                or artifact["profile"].get("opt_level") != "0"
                or artifact["profile"].get("debug_assertions") is not True
                or artifact["profile"].get("debuginfo") != 0
                or not path.is_absolute() or path.is_symlink() or not path.is_file()
                or path.resolve() != path or path != TARGET / "debug" / crate
                or not os.access(path, os.X_OK) or not 0 < path.stat().st_size <= 128 << 20):
            raise RuntimeError("current binary source/profile/containment differs: " + crate)
        bindings[crate] = {"path": str(path), "sha256": digest(path), "bytes": path.stat().st_size,
                           "source_sha": summary["source_sha"], "source_sha256": summary["source_hashes"][source],
                           "target": hosts[0], "profile": "debug", "cargo_profile": artifact["profile"]}
    cli, worker = bindings["er-cli"], bindings["er-kernel-worker"]
    os.environ.update({"ER_M9E_CLI_EXECUTABLE": cli["path"], "ER_M9E_CLI_ROOT": str(TARGET),
                       "ER_M9E_CLI_SHA256": cli["sha256"], "ER_M9E_CLI_SOURCE_SHA": cli["source_sha"],
                       "ER_M9E_WORKER_EXECUTABLE": worker["path"],
                       "ER_M9E_WORKER_EXECUTABLE_SHA256": worker["sha256"],
                       "ER_M9E_WORKER_SOURCE_SHA": worker["source_sha"],
                       "ER_M9E_WORKER_BUILD_TARGET": worker["target"],
                       "ER_M9E_WORKER_BUILD_PROFILE": worker["profile"]})
    summary["process_executables"] = bindings


def verify_process_executables(summary):
    for crate, binding in summary["process_executables"].items():
        path = Path(binding["path"])
        if (path.is_symlink() or not path.is_file() or path.resolve() != path
                or path != TARGET / "debug" / crate or path.stat().st_size != binding["bytes"]
                or digest(path) != binding["sha256"]):
            raise RuntimeError("qualified process executable changed: " + crate)


def fixture_inputs(phase):
    result = {}
    for index, (name, (length, expected_blob, expected_sha)) in enumerate(FIXTURE_INPUTS.items(), 1):
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != length:
            raise RuntimeError("exact unchanged historical fixture size/containment differs")
        actual_sha = digest(path)
        if expected_sha is not None and actual_sha != expected_sha:
            raise RuntimeError("known historical export SHA256 differs")
        tree = run(["git", "ls-tree", "-l", "HEAD", "--", name], f"fixture-{phase}-tree-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text()
        if tree.split() != ["100644", "blob", expected_blob, str(length), name]:
            raise RuntimeError("actual candidate fixture tree differs from unchanged base")
        blob = run(["git", "hash-object", "--", name], f"fixture-{phase}-blob-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text().strip()
        if blob != expected_blob:
            raise RuntimeError("actual fixture bytes differ from unchanged committed blob")
        result[name] = {"bytes": length, "sha256": actual_sha, "git_blob": blob, "base_sha": BASE_SHA}
    return result


def execute_target(summary, crate, test_target, test_source, test_ids):
    label = crate + "-" + test_target
    library = (crate, test_target) == ("er-agent-protocol", "er_agent_protocol")
    selector = ["--lib"] if library else ["--test", test_target]
    run(["cargo", "clippy", "--locked", "-p", crate, *selector,
         "--no-deps", "--", "-D", "warnings"], label + "-clippy")
    build = run(["cargo", "test", "--locked", "-p", crate, *selector,
                 "--no-run", "--message-format=json"], label + "-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == test_target
               and row.get("profile", {}).get("test") is True]
    if len(matches) != 1:
        raise RuntimeError("exact native rebind or compatibility test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / f"rust/crates/{crate}/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != (["lib"] if library else ["test"])
            or artifact["target"].get("src_path") != str(ROOT / test_source)
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or artifact["profile"].get("opt_level") != "0" or artifact["profile"].get("debuginfo") != 0
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(test_target + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], label + "-list", seconds=30, bound=16384)
    if listing.read_text() != "".join(name + ": test\n" for name in test_ids):
        raise RuntimeError("exact complete sorted target test IDs required")
    receipt = {"crate": crate, "target": test_target, "sha256": binary_hash, "bytes": binary.stat().st_size,
               "profile": artifact["profile"], "source_sha256": summary["source_hashes"][test_source],
               "ids": list(test_ids), "listing_bytes": listing.stat().st_size, "listing_sha256": digest(listing)}
    verify_process_executables(summary)
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], label + "-execute",
                 cwd=ROOT / f"rust/crates/{crate}", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("all actual target tests must pass without ignored or filtered cases")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    verify_process_executables(summary)
    receipt["tests"] = {"executed": len(test_ids), "passed": len(test_ids), "failed": 0, "skipped": 0}
    return receipt

def main(summary):
    global STARTED_AT, DEADLINE, run_bounded
    if os.environ.get("GITHUB_REF_NAME") != "codex/m9e-gen2-worker-focused-20260908":
        raise RuntimeError("exact reviewed Worker focused branch required")
    epoch = os.environ.get("M9E_FOCUS_STARTED_AT", "")
    if not re.fullmatch(r"[0-9]{10}", epoch):
        raise RuntimeError("exact pre-checkout workflow timestamp required")
    elapsed = time.time() - int(epoch)
    if not 0 <= elapsed < 1780:
        raise RuntimeError("invalid elapsed time or checkout/setup exhausted shared budget and cleanup reserve")
    STARTED_AT = int(epoch)
    DEADLINE = time.monotonic() + 1800 - elapsed
    summary["elapsed_before_producer_seconds"] = elapsed
    helper = ROOT / "scripts/ci/m9e_current_cost.py"
    helper_hash, helper_bytes = BASE_SOURCES["scripts/ci/m9e_current_cost.py"]
    if (helper.is_symlink() or not helper.is_file() or helper.resolve() != helper
            or helper.stat().st_size != helper_bytes or digest(helper) != helper_hash
            or "m9e_current_cost" in sys.modules):
        raise RuntimeError("pinned bounded-run helper differs or is preloaded")
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != helper:
        raise RuntimeError("bounded-run helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    os.environ.update(PROFILE)
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("exact Git candidate identity required")
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    source_conservation(summary, "before")
    summary["source_hashes"] = {name: digest(ROOT / name) for name in SOURCES}
    summary["source_bytes"] = {name: (ROOT / name).stat().st_size for name in SOURCES}
    summary["limits"] = {"command_seconds": 600, "shared_seconds_including_checkout": 1800,
                         "cleanup_reserve_seconds": 20,
                         "compact_bytes": 65536, "formatter_patch_bytes": 262144, "failure_bytes": 24576,
                         "command_log_bytes": 16 << 20, "test_output_bytes": 16384,
                         "test_binary_bytes": 128 << 20}
    summary["started_at"] = STARTED_AT
    summary["compiler_configuration"] = dict(PROFILE)
    summary["fixture_inputs"] = fixture_inputs("before")
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(formatted_hashes={name: digest(ROOT / name) for name in RUST_SOURCES},
                       format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch))
        raise RuntimeError("pinned formatting changes required; no native rebind qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    compile_reverse_consumers(summary)
    executable_bindings(summary)
    summary["test_artifacts"] = {}
    for crate, test_target, test_source, test_ids in TARGETS:
        summary["test_artifacts"][crate + ":" + test_target] = execute_target(
            summary, crate, test_target, test_source, test_ids)
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during execution")
    if fixture_inputs("after") != summary["fixture_inputs"]:
        raise RuntimeError("unchanged historical fixture inputs changed during execution")
    source_conservation(summary, "after")
    ids = sorted(name for _, _, _, test_ids in TARGETS for name in test_ids)
    summary["tests"] = {"executed": len(ids), "passed": len(ids), "failed": 0, "skipped": 0, "ids": ids}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"schema_version": 1, "branch": os.environ.get("GITHUB_REF_NAME"), "status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "qualification": "41 complete tests in eight whole targets: three actual Worker rebind and typed reload-tail cases, all18 retained process/endpoint/supervisor tests, and all20 qualified session/repro/kernel tests; all115 targets of twelve reverse consumers compile and lint. Initial cooperative Title snapshots are prepared by the real kernel; subsequent startup and rebind execute in actual subprocesses. Worker capsule export remains unsupported; no browser or physical-network claim."}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            cleanup_target()
            summary["cleanup"] = {"owned_target_removed": not TARGET.exists(), "contained": True}
            if DEADLINE is None or time.monotonic() > DEADLINE:
                raise RuntimeError("final owned cleanup exceeded pre-checkout shared deadline")
            summary["post_cleanup_deadline_checked"] = True
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:2048]
    if summary["status"] != "passed":
        message = (summary.get("failure", summary.get("cleanup_failure", "focused run failed"))
                   + "\nBounded tail; complete logs remain remote.\n").encode()[:4096]
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                allowance = 24576 - len(message)
                stream.seek(max(0, failed_log.stat().st_size - allowance))
                tail = stream.read(allowance)
        (FULL / "failure.txt").write_bytes(message + tail)
    summary["logs"] = logs
    summary["elapsed_seconds_including_checkout"] = None if STARTED_AT is None else time.time() - STARTED_AT
    encoded = (json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(encoded) > 65536:
        raise RuntimeError("focused compact result exceeds64KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
