"""Remote current browser rebind and retained native/Worker/codec qualification."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-gen2-browser-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = ROOT / "rust/target"
WEB = REPORT / "web"
OWNED_TARGET = False
STARTED_AT = None
DEADLINE = None
run_bounded = None
BASE_SHA = "242b7cc890d1eac51b4b30fa4b432f95d0a7ba50"
BASE_TREE = "3cd57b76a2745515272b52e56f03c208510d4db3"
TARGETS = [
  [
    "er-web",
    "er_web",
    "rust/crates/er-web/src/lib.rs",
    [
      "host_v2::rebind_transaction_tests::browser_rebind_duplicates_noops_and_wrong_generation_keep_capture_exact",
      "host_v2::rebind_transaction_tests::browser_rebind_natural_controls_and_generation_two_gameplay_replay",
      "host_v2::rebind_transaction_tests::browser_rebind_receive_response_and_cache_rejection_preserve_transaction",
      "host_v2::rebind_transaction_tests::browser_rebind_wire_decoding_rejects_unknown_control_fields",
      "host_v2::transaction_tests::late_response_limit_rejection_preserves_state_cache_and_retry",
      "host_v2::transaction_tests::read_only_response_limit_failure_preserves_capture",
      "host_v2::transaction_tests::retained_response_byte_boundary_evicts_by_acceptance_and_preserves_retry",
      "host_v2::transaction_tests::sequence_exhaustion_preflight_preserves_current_session_and_cached_response",
      "host_v2::transaction_tests::single_response_cache_boundary_rejects_before_commit_and_disposal_clears_payloads"
    ]
  ],
  [
    "er-web",
    "m9e_host_v2",
    "rust/crates/er-web/tests/m9e_host_v2.rs",
    [
      "all_five_initialization_modes_and_repro_effect_are_live",
      "browser_host_survives_request_window",
      "browser_network_and_transport_requests_execute_protocol_state",
      "browser_requests_are_atomic_and_conflicting_retries_fail_closed",
      "browser_storage_results_apply_cas_and_loaded_state",
      "browser_time_and_lifecycle_requests_execute_kernel_state_changes",
      "current_repro_exact_cached_retry_does_not_record_twice",
      "current_session_and_browser_match_natural_input_and_external_outcomes",
      "exported_current_repro_replays_raw_non_key_rejection_and_continues",
      "invalid_current_capsule_initialization_is_atomic_and_can_retry",
      "natural_browser_route_produces_typed_ui_transport_presentation_audio_and_assets",
      "presentation_failure_retains_barrier_until_successful_settlement",
      "rejected_browser_sequence_preserves_state_and_exact_cached_response",
      "save_and_terminal_controls_produce_storage_and_terminal_effects"
    ]
  ],
  [
    "er-web",
    "m9e_title_storage",
    "rust/crates/er-web/tests/m9e_title_storage.rs",
    [
      "current_host_default_wire_omits_opt_in_and_non_authority_is_rejected",
      "current_host_title_ingress_emits_typed_list_read_missing_and_cancel"
    ]
  ],
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
  ]
]
REVERSE_PACKAGES = [
  "er-agent-protocol",
  "er-batch",
  "er-cli",
  "er-devplane",
  "er-lab",
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
  "er-lab:current_kernel_endpoint_faults_v2:test": "rust/crates/er-lab/tests/current_kernel_endpoint_faults_v2.rs",
  "er-lab:current_kernel_endpoint_v2:test": "rust/crates/er-lab/tests/current_kernel_endpoint_v2.rs",
  "er-lab:current_kernel_supervisor_v2:test": "rust/crates/er-lab/tests/current_kernel_supervisor_v2.rs",
  "er-lab:er_lab:lib": "rust/crates/er-lab/src/lib.rs",
  "er-lab:kernel_reload_acceptance:test": "rust/crates/er-lab/tests/kernel_reload_acceptance.rs",
  "er-lab:kernel_reload_artifact:test": "rust/crates/er-lab/tests/kernel_reload_artifact.rs",
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
  "er-web:production_save:test": "rust/crates/er-web/tests/production_save.rs"
}
BASE_SOURCES = {
  ".nvmrc": [
    "ca60797658d7260e78179fff372eda677f04040820d398ccbebb2934e85dc16f",
    7
  ],
  "package.json": [
    "b29655956a73f24aaff59781b9352f937598123900589d055abf1a10fd12f903",
    6588
  ],
  "playwright.rust-browser.config.ts": [
    "27e17af1a4ae26ec6c4a705891f8448fa0616875ce1643fcb1a7c2595a27e68e",
    742
  ],
  "pnpm-lock.yaml": [
    "dcbcaf6df44509c71b28becffdd70b33a7410a0873f5b1297ede84150a6effff",
    145307
  ],
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
  "rust/crates/er-web/examples/m9e_v7_browser_fixtures.rs": [
    "643660849fd654c41f3820e509d5be3760680f9378d1bededc607ffa8fc56f5c",
    8614
  ],
  "rust/crates/er-web/examples/m9e_v7_coop_startup.rs": [
    "04aa90df973ee798f94f8de41652d54a93da4d4d4010f45bba6b44699d14a262",
    6231
  ],
  "rust/crates/er-web/src/contracts_v2.rs": [
    "9793e9f344122a89f35a1a695fbfb14baa2fe3688fb3ba125d7ffd7383081534",
    7217
  ],
  "rust/crates/er-web/src/host_v2.rs": [
    "f9a792c5def9fef2e9e4637d8a44b6322c82e46b3b1673bcd7f53a142f26b523",
    48909
  ],
  "rust/crates/er-web/src/lib.rs": [
    "7dd19e7616116431666fc1af72600a4ad869a9a73812936317da1028544b562e",
    1498
  ],
  "rust/crates/er-web/tests/m9e_host_v2.rs": [
    "a218698bee24c393a7358204d5172ef3834883838ecf4d1ea9a51ee311326ba4",
    67597
  ],
  "rust/crates/er-web/tests/m9e_title_storage.rs": [
    "f81746ae6df4d168bacbdd3dea4141b13b8b6c696b13fb67dcc4b6dba23bd75c",
    11738
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
  "scripts/build-kernel-m9e-v7-web.mjs": [
    "45618ccdbe083682ad1bbc5886d1655cb1f9324c859cd0d8513876d09d19cffa",
    7546
  ],
  "scripts/ci/m9e_current_cost.py": [
    "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75",
    38615
  ],
  "src/rust-browser/contracts/browser-contracts-v2.ts": [
    "8c123cb0ed22718e0afccd55b799f20a6bb4f5ee9e0da9ee4927934796f6df04",
    9563
  ],
  "src/rust-browser/contracts/browser-contracts.ts": [
    "b630f4964adf81b822d35f3718e0629f1111697922a414cf56d29adb19cfeaf3",
    4539
  ],
  "src/rust-browser/host/current-rust-browser-host.ts": [
    "0b5ff5e7188ced0f399088f871eb2b9fa0e90276cb6ed1d01c442cc938802fa1",
    10187
  ],
  "src/rust-browser/routes/browser-effects-v2.ts": [
    "88e233f9025c5de3b201f37656687a2f161ac4b7ec916dd1a4e215a71e5556d2",
    3426
  ],
  "src/rust-browser/routes/rust-current-worker-entry.ts": [
    "1295712d83ec1a4f4352b392eba71d3f260cda988cea302720b5c560da1502bc",
    898
  ],
  "src/rust-browser/worker/current-rust-kernel-worker.ts": [
    "3baf6c8745fb7f8665af29d0907ef1054428ae382e19ff41518c9666d708042a",
    6039
  ],
  "src/rust-browser/worker/rust-wasm-loader.ts": [
    "181e66b054197461ec178263597e236ed3866ccbb44de5d6e3d4e03ac1dd4a15",
    7555
  ],
  "test/browser/rust-browser/m9e-v7-worker.spec.ts": [
    "6c50a856969846281d417f7d4c190c80698a3ffff1a993db148d00182e2b0024",
    22324
  ],
  "test/node/rust-browser/engineering/current-worker-codec.test.ts": [
    "019d9a7f21397a295a321f32d8c0fe23482101953de16ae38e14d89732b49f19",
    2964
  ],
  "test/node/vitest.config.ts": [
    "dff9c02859e641562b8db4e4652b8d74b80e29d3bde0924977d7e783b3831571",
    1379
  ],
  "tsconfig.json": [
    "963f966510990bc2c33b7288d3788142da2911b96d43e537e6557d1c4547f463",
    4514
  ],
  "vitest.config.ts": [
    "63f02204ea787fcd3c6b0598809f59f08be15995b6675bd34245d329eafc8e20",
    3291
  ]
}
PRODUCT_SOURCES = [
  "rust/crates/er-repro/src/current.rs",
  "rust/crates/er-web/src/contracts_v2.rs",
  "rust/crates/er-web/src/host_v2.rs",
  "rust/crates/er-web/src/host_v2/rebind_transaction_tests.rs",
  "src/rust-browser/contracts/browser-contracts-v2.ts",
  "src/rust-browser/host/current-rust-browser-host.ts",
  "test/browser/rust-browser/m9e-v7-rebind.spec.ts",
  "test/node/rust-browser/engineering/current-worker-codec.test.ts"
]
RUST_SOURCES = [name for name in PRODUCT_SOURCES if name.endswith(".rs")]
CI_SOURCES = [
  ".github/workflows/m9e-gen2-browser-focused.yml",
  "scripts/ci/m9e_gen2_browser_diagnostic.py"
]
CHANGED_SOURCES = sorted(PRODUCT_SOURCES + CI_SOURCES)
ADDED_SOURCES = [
  ".github/workflows/m9e-gen2-browser-focused.yml",
  "rust/crates/er-web/src/host_v2/rebind_transaction_tests.rs",
  "scripts/ci/m9e_gen2_browser_diagnostic.py",
  "test/browser/rust-browser/m9e-v7-rebind.spec.ts"
]
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


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20, environment=None):
    global sequence, failed_log
    if not 0 < seconds <= 600 or DEADLINE is None or run_bounded is None:
        raise RuntimeError("command exceeds fixed 600-second ceiling")
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT / "rust" if cwd is None else cwd,
                             environment=dict(os.environ) if environment is None else environment, output=output, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE - 20)
    except Exception:
        failed_log = output
        raise
    logs[name] = {**{key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")},
                  "seconds_cap": seconds, "byte_cap": bound}
    return output


def cleanup_target():
    if TARGET != ROOT / "rust/target" or TARGET.is_symlink() or TARGET.resolve().parent != ROOT / "rust":
        raise RuntimeError("owned fresh Cargo target containment differs")
    if TARGET.exists() and not OWNED_TARGET:
        raise RuntimeError("refusing cleanup of preexisting Cargo target")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    if WEB.is_symlink() or WEB.resolve().parent != REPORT.resolve():
        raise RuntimeError("owned web output containment differs")
    if WEB.exists():
        shutil.rmtree(WEB)
    if TARGET.exists() or WEB.exists():
        raise RuntimeError("owned build cleanup incomplete")


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
        raise RuntimeError("only exact eight browser product and two additive CI paths may differ from qualified session/repro successor")
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
    closure = {"er-repro", "er-web"}
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
    library = (crate, test_target) == ("er-web", "er_web")
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
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != (["cdylib", "rlib"] if library else ["test"])
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
               "source": test_source, "kind": artifact["target"]["kind"], "crate_types": artifact["target"]["crate_types"],
               "manifest_path": artifact["manifest_path"], "executable": str(binary),
               "execution_argv": [str(binary), "--format", "terse", "--nocapture", "--test-threads=1"],
               "execution_cwd": str(ROOT / f"rust/crates/{crate}"),
               "ids": list(test_ids), "listing_bytes": listing.stat().st_size, "listing_sha256": digest(listing)}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], label + "-execute",
                 cwd=ROOT / f"rust/crates/{crate}", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("all actual target tests must pass without ignored or filtered cases")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    receipt["execution_log"] = dict(logs[label + "-execute"])
    receipt["executed_sha256"] = digest(binary)
    receipt["tests"] = {"executed": len(test_ids), "passed": len(test_ids), "failed": 0, "skipped": 0}
    return receipt

def validate_browser_worker_assets(evidence, binding, cohort_assets, *, rtc=False):
    if not isinstance(evidence, dict) or set(evidence) != {"manifest_sha256", "manifest"}:
        raise RuntimeError("current Worker asset proof fields disagree")
    manifest = evidence["manifest"]
    fields = {"schema_version", "browser_worker_protocol_version", "source_sha", "assets", "entry", "worker",
              "cohort", "builder_sha256", "pnpm_lock_sha256", "source_hashes", "vite_version"}
    if (not isinstance(manifest, dict) or set(manifest) != fields
            or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1
            or type(manifest["browser_worker_protocol_version"]) is not int or manifest["browser_worker_protocol_version"] != 2
            or not isinstance(binding, dict) or set(binding) != {"source_sha", "source_hashes", "pnpm_lock_sha256"}
            or not isinstance(binding["source_hashes"], dict)
            or manifest["source_sha"] != binding["source_sha"] or manifest["source_hashes"] != binding["source_hashes"]
            or set(binding["source_hashes"]) != set(RTC_SOURCE_PATHS if rtc else WORKER_SOURCE_PATHS)
            or manifest["pnpm_lock_sha256"] != binding["pnpm_lock_sha256"]
            or manifest["builder_sha256"] != binding["source_hashes"][WORKER_SOURCE_PATHS[-1]]
            or not isinstance(manifest["vite_version"], str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?", manifest["vite_version"])
            or not isinstance(evidence["manifest_sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", evidence["manifest_sha256"])):
        raise RuntimeError("current Worker source or ABI binding disagrees")
    if not isinstance(binding["source_sha"], str) or not re.fullmatch(r"[0-9a-f]{40}", binding["source_sha"]):
        raise RuntimeError("current Worker source SHA is invalid")
    for value in [*binding["source_hashes"].values(), binding["pnpm_lock_sha256"]]:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise RuntimeError("current Worker source digest is invalid")
    assets = manifest["assets"]
    entry = "current-rtc-entry.js" if rtc else "current-worker-entry.js"
    if not isinstance(assets, dict) or not 2 <= len(assets) <= 8 or manifest["entry"] != entry:
        raise RuntimeError("current Worker asset inventory is invalid")
    total = 0
    roles = {"entry": [], "worker": [], "chunk": []}
    for path, metadata in assets.items():
        if (not isinstance(path, str) or not re.fullmatch(r"[a-zA-Z0-9_-]+\.js", path)
                or not isinstance(metadata, dict) or set(metadata) != {"bytes", "sha256", "role"}
                or type(metadata["bytes"]) is not int or not 0 < metadata["bytes"] <= 4_194_304
                or not isinstance(metadata["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", metadata["sha256"])
                or not isinstance(metadata["role"], str) or metadata["role"] not in roles):
            raise RuntimeError("current Worker asset path, size or digest is invalid")
        total += metadata["bytes"]
        roles[metadata["role"]].append(path)
    if (total > 4_194_304 or roles["entry"] != [manifest["entry"]] or roles["worker"] != [manifest["worker"]]
            or not isinstance(manifest["worker"], str)
            or not re.fullmatch(r"current-rtc-kernel-worker-[a-zA-Z0-9_-]+\.js" if rtc
                                else r"current-rust-kernel-worker-[a-zA-Z0-9_-]+\.js", manifest["worker"])):
        raise RuntimeError("current Worker emitted entry/Worker roles disagree")
    expected_cohort = {key: cohort_assets.get(path, {}).get("sha256") for key, path in (
        ("glue_sha256", "er_web.js"), ("wasm_sha256", "er_web_bg.wasm"),
        ("content_sha256", "game-content-bundle-v2.json"))}
    if manifest["cohort"] != expected_cohort or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value) for value in expected_cohort.values()):
        raise RuntimeError("current Worker Wasm/content cohort disagrees")
    # The builder emits sorted compact ASCII JSON plus newline. All strings above
    # are fixed ASCII fields, paths, digests or a validated version.
    raw = canonical(manifest)
    if len(raw) > 16_384 or hashlib.sha256(raw).hexdigest() != evidence["manifest_sha256"]:
        raise RuntimeError("current Worker manifest hash or byte bound disagrees")


def validate_browser_worker_tests(tests, evidence, binding):
    if (not isinstance(tests, dict) or set(tests) != {"expected", "passed", "failed", "skipped", "selected_test_ids", "positive", "negative"}
            or any(type(tests[key]) is not int for key in ("expected", "passed", "failed", "skipped"))
            or tests["expected"] != 2 or tests["passed"] != 2 or tests["failed"] != 0 or tests["skipped"] != 0
            or tests["selected_test_ids"] != WORKER_TEST_IDS):
        raise RuntimeError("current Worker witness counts or identities disagree")
    manifest = evidence["manifest"]
    common = {"schema_version", "source_sha", "manifest_sha256", "entry_sha256", "worker_sha256", "worker_path",
              "glue_sha256", "wasm_sha256", "content_sha256", "browser_worker_protocol_version", "observed_worker_count"}
    positive_fields = {"initial_control", "final_control", "presentation_count", "settled_presentation_count", "ui_change_count",
                       "held_cursor", "released_cursor", "final_snapshot_digest", "accepted_sequence", "disposed",
                       "rejected_event_code", "rejection_preserved_snapshot", "authority_material_count"}
    negative_fields = {"wrong_abi", "invalid_request_id", "pending_before_termination", "settled_after_termination", "rejected_after_termination",
                       "closed", "pending_after", "queued_bytes_after", "accepted_sequence", "post_termination_rejected"}
    for key, extra, worker_count in (("positive", positive_fields, 1), ("negative", negative_fields, 2)):
        item = tests[key]
        if (not isinstance(item, dict) or set(item) != common | extra
                or type(item["schema_version"]) is not int or item["schema_version"] != 1
                or type(item["browser_worker_protocol_version"]) is not int or item["browser_worker_protocol_version"] != 2
                or type(item["observed_worker_count"]) is not int or item["observed_worker_count"] != worker_count
                or item["source_sha"] != binding["source_sha"] or item["manifest_sha256"] != evidence["manifest_sha256"]
                or item["worker_path"] != manifest["worker"]
                or item["entry_sha256"] != manifest["assets"][manifest["entry"]]["sha256"]
                or item["worker_sha256"] != manifest["assets"][manifest["worker"]]["sha256"]
                or any(item[field] != manifest["cohort"][field] for field in manifest["cohort"])):
            raise RuntimeError("current Worker measured identity disagrees")
    positive, negative = tests["positive"], tests["negative"]
    if type(positive["authority_material_count"]) is not int or not 1 <= positive["authority_material_count"] <= 64:
        raise RuntimeError("current Worker authority material evidence is missing or unbounded")
    for field in ("presentation_count", "settled_presentation_count", "ui_change_count", "accepted_sequence"):
        if type(positive[field]) is not int or not 1 <= positive[field] <= (1 << 53) - 1:
            raise RuntimeError("current Worker positive counters are unsafe or empty")
    if (positive["initial_control"] != "TITLE" or positive["final_control"] != "BATTLE_COMMAND"
            or positive["presentation_count"] != positive["settled_presentation_count"]
            or positive["held_cursor"] != ["battle/command/party", "battle/command/party", "battle/command/fight"]
            or positive["released_cursor"] != "battle/command/fight" or positive["disposed"] is not True
            or positive["rejected_event_code"] != "HOST_REJECTED" or positive["rejection_preserved_snapshot"] is not True
            or not isinstance(positive["final_snapshot_digest"], str) or not re.fullmatch(r"[0-9a-f]{64}", positive["final_snapshot_digest"])):
        raise RuntimeError("current Worker positive causal evidence disagrees")
    expected_wrong = {"code": "INVALID_ABI", "acceptance": "REJECTED", "request_id": 1, "sequence": 0, "accepted_sequence": None}
    if negative["wrong_abi"] != expected_wrong or any(type(negative["wrong_abi"].get(key)) is not int for key in ("request_id", "sequence")):
        raise RuntimeError("current Worker ABI rejection evidence disagrees")
    if negative["invalid_request_id"] != {"code": "WORKER_FAILURE", "acceptance": "UNKNOWN", "request_id": None,
                                          "sequence": None, "accepted_sequence": None}:
        raise RuntimeError("current Worker invalid correlation evidence disagrees")
    for field, count in (("pending_before_termination", 2), ("settled_after_termination", 2),
                         ("rejected_after_termination", 2), ("pending_after", 0), ("queued_bytes_after", 0)):
        if type(negative[field]) is not int or negative[field] != count:
            raise RuntimeError("current Worker pending termination evidence disagrees")
    if negative["closed"] is not True or negative["accepted_sequence"] is not None or negative["post_termination_rejected"] is not True:
        raise RuntimeError("current Worker termination did not fence the client")

WORKER_TEST_IDS = [
    "current V7 Worker executes natural input and presentation settlement",
    "current V7 Worker rejects wrong ABI and settles pending work on termination",
]
REBIND_ID = "current V7 Workers replay owned generation two rebind and continue natural gameplay"
CODEC_IDS = [
    "current V2 canonical payload preserves signed state values",
    "current V2 canonical payload rejects ambiguous numeric values",
    "current V2 envelope keeps correlation IDs nonnegative",
    "current V2 rebind codec preserves typed controls and exact output bytes",
    "current V2 rebind codec rejects malformed generation frames and observation",
]
WORKER_SOURCE_PATHS = [
    "src/rust-browser/contracts/browser-contracts-v2.ts",
    "src/rust-browser/worker/rust-wasm-loader.ts",
    "src/rust-browser/worker/current-rust-kernel-worker.ts",
    "src/rust-browser/host/current-rust-browser-host.ts",
    "src/rust-browser/routes/rust-current-worker-entry.ts",
    "test/browser/rust-browser/m9e-v7-worker.spec.ts",
    "test/node/rust-browser/engineering/current-worker-codec.test.ts",
    "scripts/build-kernel-m9e-v7-web.mjs",
]
WORKER_SPEC = "test/browser/rust-browser/m9e-v7-worker.spec.ts"
REBIND_SPEC = "test/browser/rust-browser/m9e-v7-rebind.spec.ts"
CODEC_SPEC = "test/node/rust-browser/engineering/current-worker-codec.test.ts"
BUILDER = "scripts/build-kernel-m9e-v7-web.mjs"
NATURAL_SOURCE = "rust/crates/er-web/examples/m9e_v7_coop_startup.rs"


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RuntimeError("duplicate JSON field")
            result[key] = value
        return result
    def constant(_):
        raise RuntimeError("nonfinite JSON number")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def bounded_file(path, root, maximum):
    if (not path.is_absolute() or path.is_symlink() or not path.is_file()
            or path.resolve() != path or not path.is_relative_to(root)
            or not 0 < path.stat().st_size <= maximum):
        raise RuntimeError("regular bounded file escapes owned root: " + str(path))
    return path.read_bytes()


def asset(name, maximum):
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+", name):
        raise RuntimeError("flat emitted asset name required")
    raw = bounded_file(WEB / name, WEB, maximum)
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def validate_rebind(value, worker, source_sha, setup_hash):
    manifest = worker["manifest"]
    common = {"schema_version", "source_sha", "manifest_sha256", "entry_sha256", "worker_sha256", "worker_path",
              "glue_sha256", "wasm_sha256", "content_sha256", "browser_worker_protocol_version", "observed_worker_count"}
    extra = {"setup_manifest_sha256", "actual_workers", "disposed_workers", "generation", "transcript_controls",
             "raw_inputs", "presentations", "rebind_attempts", "known_rejections", "final_snapshot_sha256",
             "capsule_sha256", "proposal_sha256", "receipt_sha256", "midphase_replay", "final_replay",
             "deleted_control_rejected", "duplicate_receipt_exact", "retry_snapshot_conserved"}
    if not isinstance(value, dict) or set(value) != common | extra:
        raise RuntimeError("exact full rebind attachment fields required")
    for key, expected in (("schema_version", 1), ("browser_worker_protocol_version", 2),
                          ("observed_worker_count", 5), ("actual_workers", 5), ("disposed_workers", 5),
                          ("generation", 2), ("transcript_controls", 8), ("known_rejections", 1)):
        if type(value[key]) is not int or value[key] != expected:
            raise RuntimeError("actual rebind counts differ: " + key)
    expected_hashes = {"manifest_sha256": worker["manifest_sha256"], "setup_manifest_sha256": setup_hash,
                       "entry_sha256": manifest["assets"][manifest["entry"]]["sha256"],
                       "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"], **manifest["cohort"]}
    if (value["source_sha"] != source_sha or value["worker_path"] != manifest["worker"]
            or any(value[key] != expected for key, expected in expected_hashes.items())):
        raise RuntimeError("rebind attachment built cohort/source differs")
    if (value["rebind_attempts"] != [10, 9] or not isinstance(value["rebind_attempts"], list)
            or any(type(count) is not int for count in value["rebind_attempts"])):
        raise RuntimeError("ordered authority/replica rebind attempts differ")
    for key in ("raw_inputs", "presentations"):
        if (not isinstance(value[key], list) or len(value[key]) != 2
                or any(type(count) is not int or not 1 <= count <= (1 << 53) - 1 for count in value[key])):
            raise RuntimeError("actual two-peer causal counters differ")
    for key in ("final_snapshot_sha256", "capsule_sha256"):
        if (not isinstance(value[key], list) or len(value[key]) != 2
                or any(not isinstance(item, str) or not re.fullmatch(r"[0-9a-f]{64}", item) for item in value[key])):
            raise RuntimeError("actual two-peer checkpoint/capsule hashes differ")
    for key in ("proposal_sha256", "receipt_sha256"):
        if not isinstance(value[key], str) or not re.fullmatch(r"[0-9a-f]{64}", value[key]):
            raise RuntimeError("actual raw wire SHA256 missing")
    for key in ("midphase_replay", "final_replay", "deleted_control_rejected", "duplicate_receipt_exact", "retry_snapshot_conserved"):
        if value[key] is not True:
            raise RuntimeError("actual rebind conservation assertion missing: " + key)


def playwright_result(path, spec, expected, attachments):
    raw = bounded_file(path, FULL, 1 << 20)
    report = strict_json(raw)
    found = []
    def walk(suites):
        for suite in suites:
            for case in suite.get("specs", []):
                found.append(case)
            walk(suite.get("suites", []))
    walk(report.get("suites", []))
    if report.get("errors") or [case.get("title") for case in found] != expected:
        raise RuntimeError("complete exact Playwright case inventory differs")
    values = []
    for case, (attachment_name, maximum) in zip(found, attachments, strict=True):
        if case.get("file") not in (spec, Path(spec).name, str(ROOT / spec)) or case.get("ok") is not True:
            raise RuntimeError("actual browser case source or outcome differs")
        tests = case.get("tests", [])
        if len(tests) != 1:
            raise RuntimeError("one browser project result required")
        test = tests[0]
        results = test.get("results", [])
        if (test.get("projectName") != "chromium" or test.get("status") != "expected"
                or len(results) != 1):
            raise RuntimeError("one unretired passing Chromium result required")
        result = results[0]
        if (result.get("status") != "passed" or result.get("retry") != 0
                or type(result.get("duration")) is not int or not 0 <= result["duration"] <= 300000
                or result.get("error") or result.get("errors")):
            raise RuntimeError("actual browser result/cap differs")
        parts = result.get("attachments", [])
        if len(parts) != 1 or parts[0].get("name") != attachment_name or parts[0].get("contentType") != "application/json":
            raise RuntimeError("sole exact source-defined attachment required")
        part = parts[0]
        if "body" in part and "path" not in part:
            encoded = part["body"]
            if not isinstance(encoded, str) or len(encoded) > ((maximum + 2) // 3) * 4:
                raise RuntimeError("bounded attachment base64 required")
            payload = base64.b64decode(encoded, validate=True)
            if base64.b64encode(payload).decode() != encoded:
                raise RuntimeError("canonical attachment base64 required")
        elif "path" in part and "body" not in part:
            payload = bounded_file(Path(part["path"]), REPORT, maximum)
        else:
            raise RuntimeError("one actual attachment representation required")
        if not 0 < len(payload) <= maximum:
            raise RuntimeError("browser attachment exceeds unchanged cap")
        values.append({"id": case["title"], "source": spec, "source_sha256": digest(ROOT / spec),
                       "duration_ms": result["duration"], "attachment": attachment_name,
                       "attachment_bytes": len(payload), "attachment_sha256": hashlib.sha256(payload).hexdigest(),
                       "evidence": strict_json(payload)})
    return {"source": spec, "ids": expected, "passed": len(expected), "failed": 0, "skipped": 0,
            "report_sha256": hashlib.sha256(raw).hexdigest(), "report_bytes": len(raw), "cases": values}


def browser_platform(summary):
    # Copied per-command release environment: never leak opt0 rustflags into release Wasm.
    release = dict(os.environ)
    release.pop("CARGO_ENCODED_RUSTFLAGS", None)
    release.pop("RUSTFLAGS", None)
    release.pop("M9E_BUILD_CURRENT_RTC", None)
    release["M9E_BUILD_CURRENT_WORKER"] = "1"
    release.update(CARGO_PROFILE_RELEASE_OPT_LEVEL="3", CARGO_PROFILE_RELEASE_DEBUG="0",
                   CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS="false", CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS="false")
    node_version = run(["node", "--version"], "node-version", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    pnpm_version = run(["pnpm", "--version"], "pnpm-version", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if node_version != (ROOT / ".nvmrc").read_text().strip() or pnpm_version != "10.33.2":
        raise RuntimeError("exact pinned Node/pnpm tools required")
    summary["node_tools"] = {"node": node_version, "pnpm": pnpm_version}
    run(["pnpm", "install", "--frozen-lockfile"], "node-dependencies", cwd=ROOT)
    run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict",
         "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "bundler", "--lib", "ESNext,DOM",
         "--types", "node,vite/client", "src/rust-browser/routes/rust-current-worker-entry.ts", REBIND_SPEC, WORKER_SPEC, CODEC_SPEC],
        "browser-typecheck", cwd=ROOT, seconds=120)
    if shutil.which("wasm-bindgen") is None:
        run(["cargo", "install", "wasm-bindgen-cli", "--version", "0.2.127", "--locked"], "wasm-tools", environment=release)
    if run(["wasm-bindgen", "--version"], "wasm-version", seconds=30, bound=16384).read_text().strip() != "wasm-bindgen 0.2.127":
        raise RuntimeError("exact wasm-bindgen version required")
    build = run(["cargo", "build", "--locked", "--release", "--target", "wasm32-unknown-unknown", "-p", "er-web",
                 "--message-format=json"], "release-wasm-artifact", environment=release)
    rows = [strict_json(line) for line in build.read_text().splitlines() if line.startswith("{")]
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("manifest_path") == str(ROOT / "rust/crates/er-web/Cargo.toml")
               and row.get("target", {}).get("name") == "er_web"]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True] or len(matches) != 1:
        raise RuntimeError("one actual successful er-web release artifact required")
    artifact = matches[0]
    wasm = TARGET / "wasm32-unknown-unknown/release/er_web.wasm"
    data = bounded_file(wasm, TARGET, 32 << 20)
    if (artifact.get("target", {}).get("src_path") != str(ROOT / "rust/crates/er-web/src/lib.rs")
            or artifact["target"].get("kind") != ["cdylib", "rlib"] or artifact.get("features") != []
            or str(wasm) not in artifact.get("filenames", []) or artifact.get("executable") is not None
            or artifact.get("profile", {}).get("test") is not False
            or artifact["profile"].get("opt_level") != "3" or artifact["profile"].get("debug_assertions") is not False
            or artifact["profile"].get("debuginfo") != 0 or data[:8] != b"\0asm\x01\0\0\0"):
        raise RuntimeError("actual release Wasm source/profile/output binding differs")
    wasm_hash = hashlib.sha256(data).hexdigest()
    summary["release_wasm"] = {"target": "wasm32-unknown-unknown", "source": "rust/crates/er-web/src/lib.rs",
                               "profile": artifact["profile"], "path": str(wasm), "bytes": len(data), "sha256": wasm_hash,
                               "build_log_sha256": digest(build), "native_flags_removed": True, "kind": artifact["target"]["kind"],
                               "crate_types": artifact["target"]["crate_types"], "manifest_path": artifact["manifest_path"],
                               "release_overflow_checks": False, "candidate": summary["source_sha"]}
    run(["node", BUILDER, "--out-dir", str(WEB)], "original-worker-builder", cwd=ROOT, environment=release)
    if digest(wasm) != wasm_hash:
        raise RuntimeError("original builder must use the identical actual release artifact")
    cohort_raw = bounded_file(WEB / "m9e-v7-web-assets.json", WEB, 16384)
    cohort = strict_json(cohort_raw)
    if (set(cohort) != {"schema_version", "browser_worker_protocol_version", "source_sha", "assets"}
            or type(cohort["schema_version"]) is not int or cohort["schema_version"] != 1
            or type(cohort["browser_worker_protocol_version"]) is not int or cohort["browser_worker_protocol_version"] != 2
            or cohort["source_sha"] != summary["source_sha"]
            or set(cohort["assets"]) != {"er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json",
                                        "coop-authority-snapshot.json", "coop-replica-snapshot.json"}):
        raise RuntimeError("original exact web cohort manifest required")
    for name, expected in cohort["assets"].items():
        if set(expected) != {"bytes", "sha256"} or expected != asset(name, (4 if name.endswith(".js") else 32) << 20):
            raise RuntimeError("actual source-built web asset differs")
    if cohort["assets"]["game-content-bundle-v2.json"]["sha256"] != next(iter(FIXTURE_INPUTS.values()))[2]:
        raise RuntimeError("unchanged old-content runtime bytes required")
    worker_raw = bounded_file(WEB / "m9e-v7-worker-assets.json", WEB, 16384)
    worker = {"manifest": strict_json(worker_raw), "manifest_sha256": hashlib.sha256(worker_raw).hexdigest()}
    binding = {"source_sha": summary["source_sha"], "source_hashes": {name: digest(ROOT / name) for name in WORKER_SOURCE_PATHS},
               "pnpm_lock_sha256": digest(ROOT / "pnpm-lock.yaml")}
    validate_browser_worker_assets(worker, binding, cohort["assets"])
    for name, expected in worker["manifest"]["assets"].items():
        if {key: expected[key] for key in ("bytes", "sha256")} != asset(name, 4 << 20):
            raise RuntimeError("actual emitted Worker byte identity differs")
    summary["web_cohort"] = {"manifest": cohort, "manifest_sha256": hashlib.sha256(cohort_raw).hexdigest()}
    summary["worker_assets"] = worker
    summary["worker_source_binding"] = binding
    run(["cargo", "run", "--locked", "-p", "er-web", "--example", "m9e_v7_coop_startup", "--", str(WEB)], "natural-initializations")
    setup = {"schema_version": 1, "source_sha": summary["source_sha"], "assets": {
        name: asset(name, 65536) for name in ("coop-host-initialization.json", "coop-guest-initialization.json")}}
    for name in setup["assets"]:
        if strict_json(bounded_file(WEB / name, WEB, 65536)).get("kind") != "NATURAL_COOP":
            raise RuntimeError("unchanged example must emit actual natural cooperative initialization")
    setup_raw = canonical(setup)
    (WEB / "m9e-v7-coop-startup-assets.json").write_bytes(setup_raw)
    summary["natural_initializations"] = {"manifest": setup, "manifest_sha256": hashlib.sha256(setup_raw).hexdigest()}
    codec_report = FULL / "codec.json"
    run(["pnpm", "exec", "vitest", "run", "--config", "test/node/vitest.config.ts", CODEC_SPEC,
         "--reporter=json", "--outputFile", str(codec_report)], "codec-five", cwd=ROOT)
    codec_raw = bounded_file(codec_report, FULL, 1 << 20)
    codec = strict_json(codec_raw)
    assertions = [item for row in codec.get("testResults", []) for item in row.get("assertionResults", [])]
    if (codec.get("success") is not True or [item.get("title") for item in assertions] != CODEC_IDS
            or any(item.get("status") != "passed" for item in assertions)
            or any(type(codec.get(key)) is not int or codec[key] != expected for key, expected in
                   (("numTotalTests", 5), ("numPassedTests", 5), ("numFailedTests", 0), ("numPendingTests", 0), ("numTodoTests", 0)))):
        raise RuntimeError("five exact complete codec tests required")
    summary["codec_tests"] = {"ids": CODEC_IDS, "passed": 5, "failed": 0, "skipped": 0,
                              "source": CODEC_SPEC, "source_sha256": digest(ROOT / CODEC_SPEC),
                              "report_sha256": hashlib.sha256(codec_raw).hexdigest(), "report_bytes": len(codec_raw)}
    run(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], "chromium", cwd=ROOT)
    browser_env = dict(os.environ, M9E_V7_WEB_DIR=str(WEB))
    summary["browser_tests"] = {}
    for label, spec, ids, attachments in (
        ("rebind", REBIND_SPEC, [REBIND_ID], [("m9e-current-browser-rebind", 16384)]),
        ("worker", WORKER_SPEC, WORKER_TEST_IDS, [("m9e-current-worker-positive", 4096), ("m9e-current-worker-negative", 4096)]),
    ):
        report_path = FULL / (label + "-browser.json")
        environment = dict(browser_env, PLAYWRIGHT_JSON_OUTPUT_FILE=str(report_path))
        run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium",
             "--workers=1", "--retries=0", "--reporter=json", "--output", str(REPORT / (label + "-results")), spec],
            label + "-browser", cwd=ROOT, environment=environment)
        result = playwright_result(report_path, spec, ids, attachments)
        summary["browser_tests"][label] = result
        if label == "rebind":
            validate_rebind(result["cases"][0]["evidence"], worker, summary["source_sha"], summary["natural_initializations"]["manifest_sha256"])
        else:
            tests = {"expected": 2, "passed": 2, "failed": 0, "skipped": 0, "selected_test_ids": WORKER_TEST_IDS,
                     "positive": result["cases"][0]["evidence"], "negative": result["cases"][1]["evidence"]}
            validate_browser_worker_tests(tests, worker, binding)
        for name, expected in {**cohort["assets"], **worker["manifest"]["assets"], **setup["assets"]}.items():
            if asset(name, 32 << 20) != {key: expected[key] for key in ("bytes", "sha256")}:
                raise RuntimeError("actual built asset changed during browser execution")
        if (digest(WEB / "m9e-v7-coop-startup-assets.json") != summary["natural_initializations"]["manifest_sha256"]
                or digest(WEB / "m9e-v7-worker-assets.json") != worker["manifest_sha256"]
                or digest(WEB / "m9e-v7-web-assets.json") != summary["web_cohort"]["manifest_sha256"]):
            raise RuntimeError("actual cohort manifest changed during browser execution")
    summary["browser_totals"] = {"executed": 3, "passed": 3, "failed": 0, "skipped": 0,
                                "new_rebind_workers": 5, "retained_worker_case_workers": [1, 2]}


def main(summary):
    global STARTED_AT, DEADLINE, run_bounded, OWNED_TARGET
    if os.environ.get("GITHUB_REF_NAME") != "codex/m9e-gen2-browser-focused-20260907":
        raise RuntimeError("exact reviewed browser focused branch required")
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
    if TARGET.exists() or TARGET.is_symlink():
        raise RuntimeError("fresh source-only Cargo target must be absent")
    OWNED_TARGET = True
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
                         "test_binary_bytes": 128 << 20, "browser_test_seconds": 300, "browser_report_bytes": 1 << 20,
                         "rebind_attachment_bytes": 16384, "retained_worker_attachment_bytes": 4096}
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
    summary["test_artifacts"] = {}
    for crate, test_target, test_source, test_ids in TARGETS:
        summary["test_artifacts"][crate + ":" + test_target] = execute_target(
            summary, crate, test_target, test_source, test_ids)
    browser_platform(summary)
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during execution")
    if fixture_inputs("after") != summary["fixture_inputs"]:
        raise RuntimeError("unchanged historical fixture inputs changed during execution")
    source_conservation(summary, "after")
    ids = sorted(name for _, _, _, test_ids in TARGETS for name in test_ids)
    summary["native_tests"] = {"executed": len(ids), "passed": len(ids), "failed": 0, "skipped": 0, "ids": ids}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"schema_version": 1, "branch": os.environ.get("GITHUB_REF_NAME"), "status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "qualification": "45 current native tests across six whole targets;103 reverse targets compiled/linted;three real Worker cases and five codec cases. Old-content242b cohort; no RTC or CLI rebind qualification"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            cleanup_target()
            summary["cleanup"] = {"owned_target_removed": not TARGET.exists(), "owned_web_removed": not WEB.exists(), "contained": True}
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
