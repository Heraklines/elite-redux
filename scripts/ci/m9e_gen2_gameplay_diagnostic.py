"""Remote owned generation-two gameplay and receipt F; no CLI or browser claim."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-gen2-gameplay-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
STARTED_AT = None
DEADLINE = None
run_bounded = None
BASE_SHA = "9fbb9fa2a624f8341974ce27e18260a21063751f"
BASE_TREE = "e025db5e75c65ee152821a36e31c9eb5eeb6960c"
TARGETS = [
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
    "er-kernel",
    "m9e_coop_choices_v7",
    "rust/crates/er-kernel/tests/m9e_coop_choices_v7.rs",
    [
      "confirmed_independent_raw_starters_form_exact_owned_party_and_preserve_host",
      "constructed_cooperative_victory_preserves_each_seat_on_next_wave",
      "invalid_peer_choices_preserve_entire_state_rng_and_allocator",
      "natural_cooperative_battles_preserve_two_seats_across_rewards_and_disconnect",
      "natural_cooperative_fixed_party_replaces_guest_and_converges_to_defeat",
      "natural_cooperative_switches_use_each_seats_complete_party_without_cross_owner_choices",
      "natural_owned_startup_waits_for_both_orders_restores_and_retries_without_reexecution",
      "owned_startup_rejects_forged_frames_and_snapshots_atomically"
    ]
  ],
  [
    "er-kernel",
    "m9e_game_kernel_v7",
    "rust/crates/er-kernel/tests/m9e_game_kernel_v7.rs",
    [
      "authority_ai_can_choose_a_legal_enemy_switch",
      "authority_ai_exhausted_max_pp_uses_struggle_without_extra_decisions_or_pp",
      "authority_ai_max_pp_boundaries_drive_raw_choices_without_extra_rng",
      "final_wave_victory_terminates_the_run",
      "gamepad_buttons_drive_bootstrap_and_active_controls",
      "held_action_cannot_cross_bootstrap_menu_instance",
      "natural_solo_battle_reaches_terminal_using_only_physical_keys",
      "nonterminal_battle_progresses_to_next_wave",
      "raw_keys_complete_natural_start_and_install_serialized_v6_state",
      "read_rebind_clears_real_repeat_ownership_without_cancelling_unrelated_work",
      "read_rebind_keeps_larger_saved_floors_and_no_active_run_behavior",
      "read_rebind_preserves_saved_semantics_and_executes_write_after_restore",
      "read_rebind_rejects_stale_action_context_and_preserves_canonical_battle_root",
      "read_rebind_rolls_back_menu_revision_presentation_and_replay_exhaustion"
    ]
  ],
  [
    "er-kernel",
    "m9e_ai_command_transaction_v7",
    "rust/crates/er-kernel/tests/m9e_ai_command_transaction_v7.rs",
    [
      "command_cursor_rejection_preserves_ai_sequence_and_all_other_owners",
      "complete_two_actor_preparation_commits_once_and_replays_identical_commands",
      "later_actor_rejection_preserves_the_complete_ai_command_owner"
    ]
  ],
  [
    "er-kernel",
    "m9e_natural_replacement_v7",
    "rust/crates/er-kernel/tests/m9e_natural_replacement_v7.rs",
    [
      "natural_faint_offers_owned_reserves_restores_and_continues_raw_battle",
      "natural_replacement_rejects_wrong_receipt_field_and_fainted_party_choice"
    ]
  ],
  [
    "er-kernel",
    "m9e_coop_v7",
    "rust/crates/er-kernel/tests/m9e_coop_v7.rs",
    [
      "coop_waits_for_all_human_commands",
      "natural_coop_raw_proposal_converges_and_generation_is_fenced",
      "private_party_reopens_restore_exact_root_and_apply_canonical_material",
      "replica_delivers_save_presentation_once_without_repeating_authority_storage"
    ]
  ],
  [
    "er-kernel",
    "m9e_current_proposal_v7",
    "rust/crates/er-kernel/tests/m9e_current_proposal_v7.rs",
    [
      "current_proposal_publication_receipt_and_snapshot_conserve_ownership",
      "current_proposal_rejection_duplicate_and_terminal_are_transactional"
    ]
  ],
  [
    "er-kernel",
    "m9e_material_retention_v7",
    "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
    [
      "v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots",
      "v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix"
    ]
  ],
  [
    "er-kernel",
    "m9e_snapshot_v7",
    "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
    [
      "active_snapshot_round_trips_at_a_quiescent_boundary",
      "quiescent_v6_snapshot_migrates_without_gameplay_side_effects",
      "terminal_lifecycle_requires_complete_control_and_terminal_identity",
      "typed_pending_effects_cross_validate_allocator_and_content"
    ]
  ],
  [
    "er-kernel",
    "m9e_coop_lost_receipt_v7",
    "rust/crates/er-kernel/tests/m9e_coop_lost_receipt_v7.rs",
    [
      "natural_cooperative_lost_reply_restores_retries_and_continues_without_reexecution",
      "natural_cooperative_public_retry_restores_pending_publication_and_continues",
      "owned_reply_raw_admission_replaces_capacity_one_and_rejects_forged_snapshots"
    ]
  ]
]
KERNEL_TEST_TARGETS = [
  "m1_keyboard_menu",
  "m2_protocol_menu",
  "m3_authority_commands",
  "m3_battle_presentation",
  "m3_battle_ui",
  "m3_material_apply",
  "m3_tail_proof_routing",
  "m3_terminal_protocol",
  "m4_snapshot_v3",
  "m9e_ai_command_transaction_v7",
  "m9e_checkpoint_healing_v7",
  "m9e_coop_choices_v7",
  "m9e_coop_lost_receipt_v7",
  "m9e_coop_v7",
  "m9e_current_coop_rebind_v7",
  "m9e_current_proposal_v7",
  "m9e_domain_journeys_v7",
  "m9e_game_kernel_v7",
  "m9e_material_retention_v7",
  "m9e_natural_campaign_v7",
  "m9e_natural_coop_campaign_v7",
  "m9e_natural_progression_v7",
  "m9e_natural_replacement_v7",
  "m9e_snapshot_v7",
  "m9e_struggle_v7",
  "m9e_timers_v7",
  "m9e_title_storage"
]
BASE_SOURCES = {
  "rust/Cargo.lock": [
    "77819112d183e14ad28244caaaadfe94956ab6b7c105a5810f0c2296346e65e9",
    32051
  ],
  "rust/Cargo.toml": [
    "fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",
    1615
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
  "rust/crates/er-game/src/m9e_new_run_v6.rs": [
    "72af2d48c26794a1fc41352bb13b081199e9299a5716f12ef5f461a0f9dccd28",
    32864
  ],
  "rust/crates/er-game/src/m9e_runtime_v6.rs": [
    "51792a4093785dd24be3981867af1b3adbbe6c3d736d9c6dc2dedafce24d9fbc",
    110747
  ],
  "rust/crates/er-kernel/Cargo.toml": [
    "2b244502f54359df2852f5f05051a149154629a131f7b862c33a72c12f5aaabd",
    706
  ],
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs": [
    "6fd2e6413fa2d7b7419701729027436e5f31597d725e9e00c7c1b3c6fcda7057",
    25466
  ],
  "rust/crates/er-kernel/src/current_proposal_v7.rs": [
    "16c3cc29c3dbc8524c9488a1b466b9beb8141d58c2a4e3680d4ced55db1b7bd3",
    18958
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
  "rust/crates/er-kernel/tests/m1_keyboard_menu.rs": [
    "7b15c0a80e2304aa762cc0f4c27ee392c81c6defa3fe07914b37cdedac872b69",
    32009
  ],
  "rust/crates/er-kernel/tests/m2_protocol_menu.rs": [
    "63cc13fe66902a85c6e9756dfad99185d612edaa6da4ba47c06105319f1b1d95",
    76805
  ],
  "rust/crates/er-kernel/tests/m3_authority_commands.rs": [
    "aa732121b9837ccd40711d20ca53c9f2bf428d9a2eefb81a890a237176d9aacd",
    80236
  ],
  "rust/crates/er-kernel/tests/m3_battle_presentation.rs": [
    "fb65522eaaa660bbaec2f2fdfd3cc7650b8bb0e50a5ee6a4da082a82d761a193",
    17610
  ],
  "rust/crates/er-kernel/tests/m3_battle_ui.rs": [
    "a8ef189f40f240b41eff755706005818129e38b1d35babe90c3084b3662283d4",
    16266
  ],
  "rust/crates/er-kernel/tests/m3_material_apply.rs": [
    "bfc616e0b5c84dbfb8fb505c7835c046a1fb77d22e051fc7b0d0c9bc2b712d15",
    40057
  ],
  "rust/crates/er-kernel/tests/m3_tail_proof_routing.rs": [
    "fa9cd6800f3a8023809587215bb5a191e9d4d9396b9e58f0afedfa32ce44d187",
    28505
  ],
  "rust/crates/er-kernel/tests/m3_terminal_protocol.rs": [
    "355293d686c8c0a010adeecb583d6f451e9b697aedbc11a922bb2428b507123e",
    8156
  ],
  "rust/crates/er-kernel/tests/m4_snapshot_v3.rs": [
    "a606a52d6fa38a0c76d191c5e5b6c2abe65fce8c2578a95fa3dee24d78cc713c",
    4296
  ],
  "rust/crates/er-kernel/tests/m9e_ai_command_transaction_v7.rs": [
    "5a9f9d63f6d9da822acfd7e18e1eb3d379f1b681bf52f73a080aacde83a4b5bf",
    10393
  ],
  "rust/crates/er-kernel/tests/m9e_checkpoint_healing_v7.rs": [
    "ab8cbf4659108014f64938cee608b809c2c386ce9353e31205ae3abaaa69900d",
    12065
  ],
  "rust/crates/er-kernel/tests/m9e_coop_choices_v7.rs": [
    "34618941e4434159c8f05061550ee322b4aa434604f3b31c0d2c9e7697426243",
    53838
  ],
  "rust/crates/er-kernel/tests/m9e_coop_lost_receipt_v7.rs": [
    "e6dfd7a462127f25a3917a1ff71693f2788f9c0aacce0a30b9647e4fe08b85c4",
    38819
  ],
  "rust/crates/er-kernel/tests/m9e_coop_v7.rs": [
    "6f41a6eb991dca0a6291cf89f61cbd648f1875c559b6f77e55a8eb190e252d74",
    43882
  ],
  "rust/crates/er-kernel/tests/m9e_current_proposal_v7.rs": [
    "0dd6491e64bac378e947f9f0faa4e1080a421b57f1ffb8261b42ad04083da36f",
    48844
  ],
  "rust/crates/er-kernel/tests/m9e_domain_journeys_v7.rs": [
    "d75d0c0eb020374b15b699fcaecc2c5296c572d7d5f1f5ed6b814bcdcf27f1a9",
    37523
  ],
  "rust/crates/er-kernel/tests/m9e_game_kernel_v7.rs": [
    "1cb27d6fc507bc50c335879c25dd85ea10de1f17f7cb210c80c20cc8e55ce451",
    60862
  ],
  "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs": [
    "1343e6f1ce0f911706d22074fee62f9089fdde9b5b526a8cced2c6698b780718",
    13942
  ],
  "rust/crates/er-kernel/tests/m9e_natural_campaign_v7.rs": [
    "b3b9e5e0da0555ec32fbff4b980d7578c97a943f278b38affac63d0525e90574",
    15618
  ],
  "rust/crates/er-kernel/tests/m9e_natural_coop_campaign_v7.rs": [
    "0947cbff52edeb3568817ff18c0bc3282458740326782b2f54874d22c4639b1d",
    29980
  ],
  "rust/crates/er-kernel/tests/m9e_natural_progression_v7.rs": [
    "a0b106af6876c3c22d88a2544df9bd68aa7352b0c172562894e9151a06c38ad8",
    12099
  ],
  "rust/crates/er-kernel/tests/m9e_natural_replacement_v7.rs": [
    "180e442c42a35bbd241069489521dd3e20ce292f4be91fbcdd6a7ac81f335c13",
    12944
  ],
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs": [
    "d7e908a92b865ffa8539414517b25c3c2fb83a91aa456502cbb24e111af8f453",
    8659
  ],
  "rust/crates/er-kernel/tests/m9e_struggle_v7.rs": [
    "65bcd144b8a98ad339a3d79a58386d455238717302df1ceeb989e13f4ef1078c",
    10067
  ],
  "rust/crates/er-kernel/tests/m9e_timers_v7.rs": [
    "7f786caf7ee5cb5984a8a8e8717fad02ce12d422884cba39d6287852478b0a02",
    26431
  ],
  "rust/crates/er-kernel/tests/m9e_title_storage.rs": [
    "28c99dfa3be2eb923670c0a15e1cea611de6592bb79aef75526fb104631243b9",
    33185
  ],
  "rust/crates/er-protocol/Cargo.toml": [
    "c6c67ea6f4dff5dc520b9b039fe7606004fab00d1f9726195abf41e20d9f8e2e",
    327
  ],
  "rust/crates/er-protocol/src/authority_log.rs": [
    "92ea98e773b970cfc555ec99a48fec7c7c60c5c89df2aca57856de013398fbd1",
    77197
  ],
  "rust/crates/er-protocol/src/proposal.rs": [
    "b3d0c01bb30c4d6c5a232579d68b135eed6e6a12a101b0ec264f765d70fe1f4b",
    75784
  ],
  "rust/crates/er-protocol/src/recovery.rs": [
    "962061f0abdbd7adcfa2a91a9cd2826f0328fcfd612db733a91e91a705154cea",
    100044
  ],
  "rust/crates/er-protocol/src/scheduler.rs": [
    "20bf9f4f4ea38fbac7fd92043e34e647a4cd2b2fdb46a66102b93091b0a35559",
    23095
  ],
  "rust/crates/er-protocol/src/snapshot.rs": [
    "83705fbec76a1f705e0b0ec51a1217223e7638bdf5280e51a9a70e09d4f2455b",
    58540
  ],
  "rust/crates/er-state/src/m9e_state_v6.rs": [
    "f4aeedff5dfad585f046c55856e1eb9cd66f1a997bda1286401c0012e0c26d23",
    14128
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
  ]
}
RUST_SOURCES = [
  "rust/crates/er-kernel/src/current_coop_rebind_v7.rs",
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs",
  "rust/crates/er-kernel/src/current_proposal_v7.rs",
  "rust/crates/er-kernel/src/game_kernel_v7.rs",
  "rust/crates/er-kernel/tests/m9e_current_coop_rebind_v7.rs"
]
CI_SOURCES = ["scripts/ci/m9e_gen2_gameplay_diagnostic.py", ".github/workflows/m9e-gen2-gameplay-focused.yml"]
CHANGED_SOURCES = sorted(RUST_SOURCES + CI_SOURCES)
FIXTURE_INPUTS = {
  "rust/fixtures/m9/engineering/game-content-bundle-v2.json": [
    15810979,
    "6b435b78bc4d62c7f492142752c91610b914a071",
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
    expected = sorted(("M" if name in BASE_SOURCES else "A") + "\t" + name for name in CHANGED_SOURCES)
    if sorted(changes) != expected:
        raise RuntimeError("only exact five product and two additive CI paths may differ from 9fbb")
    status = run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-" + phase,
                 cwd=ROOT, seconds=30, bound=16384).read_text()
    if status:
        raise RuntimeError("tracked candidate bytes differ from committed source")
    for name in SOURCES:
        path = ROOT / name
        if (path.is_symlink() or not path.is_file() or path.resolve() != path
                or not 0 < path.stat().st_size <= 4 << 20):
            raise RuntimeError("named small source containment/size differs")
        if name in BASE_SOURCES and name not in RUST_SOURCES:
            expected_hash, expected_bytes = BASE_SOURCES[name]
            if path.stat().st_size != expected_bytes or digest(path) != expected_hash:
                raise RuntimeError("unchanged source differs from guarded cached 9fbb bytes: " + name)
    actual_tests = run(["git", "ls-tree", "-r", "--name-only", "HEAD", "--", "rust/crates/er-kernel/tests"],
                       "kernel-inventory-" + phase, cwd=ROOT, seconds=30, bound=16384).read_text().splitlines()
    if actual_tests != ["rust/crates/er-kernel/tests/" + name + ".rs" for name in KERNEL_TEST_TARGETS]:
        raise RuntimeError("complete kernel source target inventory differs")
    summary["base_conservation"] = {"tree": BASE_TREE, "changed_paths": CHANGED_SOURCES,
                                    "unchanged_small_sources": len(BASE_SOURCES) - 3,
                                    "phase": phase}


def compile_kernel_constructors(summary):
    # All 27 integration harnesses plus the library harness must really compile.
    # Only the ten separately discovered/executed targets qualify behavior.
    build = run(["cargo", "test", "--locked", "-p", "er-kernel", "--tests", "--no-run",
                 "--message-format=json"], "all-kernel-constructors-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete constructor Cargo artifact stream required")
    artifacts = [row for row in rows if row.get("reason") == "compiler-artifact"
                 and row.get("manifest_path") == str(ROOT / "rust/crates/er-kernel/Cargo.toml")
                 and row.get("executable") is not None]
    names = [row.get("target", {}).get("name") for row in artifacts]
    if sorted(names) != sorted([*KERNEL_TEST_TARGETS, "er_kernel"]):
        raise RuntimeError("all 27 kernel integration artifacts and library harness required exactly once")
    executed = {row[1] for row in TARGETS}
    receipts = {}
    for artifact in artifacts:
        name = artifact["target"]["name"]
        source = ("rust/crates/er-kernel/src/lib.rs" if name == "er_kernel"
                  else "rust/crates/er-kernel/tests/" + name + ".rs")
        binary = Path(artifact["executable"])
        if (artifact.get("features") != []
                or artifact["target"].get("kind") != (["lib"] if name == "er_kernel" else ["test"])
                or artifact["target"].get("src_path") != str(ROOT / source)
                or artifact.get("profile", {}).get("test") is not True
                or artifact["profile"].get("debug_assertions") is not True
                or artifact["profile"].get("opt_level") != "0" or artifact["profile"].get("debuginfo") != 0
                or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
                or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
                or not re.fullmatch(name + "-[0-9a-f]{16}", binary.name)
                or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
            raise RuntimeError("actual compile-only source/profile/artifact binding differs")
        if name in executed:
            prior = summary["test_artifacts"]["er-kernel:" + name]
            if digest(binary) != prior["sha256"] or binary.stat().st_size != prior["bytes"]:
                raise RuntimeError("constructor compile changed an already executed artifact")
        else:
            receipts["er-kernel:" + ("lib" if name == "er_kernel" else name)] = {
                "binary": binary.name, "bytes": binary.stat().st_size, "sha256": digest(binary),
                "profile": artifact["profile"], "source": source,
                "source_sha256": summary["source_hashes"][source], "executed": False}
    if len(receipts) != 18:
        raise RuntimeError("exact 18 compile-only harnesses required")
    return receipts


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
    run(["cargo", "clippy", "--locked", "-p", crate, "--test", test_target,
         "--no-deps", "--", "-D", "warnings"], label + "-clippy")
    build = run(["cargo", "test", "--locked", "-p", crate, "--test", test_target,
                 "--no-run", "--message-format=json"], label + "-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == test_target]
    if len(matches) != 1:
        raise RuntimeError("exact native rebind or compatibility test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / f"rust/crates/{crate}/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
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
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], label + "-execute",
                 cwd=ROOT / f"rust/crates/{crate}", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("all actual target tests must pass without ignored or filtered cases")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    receipt["tests"] = {"executed": len(test_ids), "passed": len(test_ids), "failed": 0, "skipped": 0}
    return receipt

def main(summary):
    global STARTED_AT, DEADLINE, run_bounded
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
                         "compact_bytes": 65536, "formatter_patch_bytes": 262144,
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
    summary["test_artifacts"] = {}
    for crate, test_target, test_source, test_ids in TARGETS:
        summary["test_artifacts"][crate + ":" + test_target] = execute_target(
            summary, crate, test_target, test_source, test_ids)
    summary["compile_only_artifacts"] = compile_kernel_constructors(summary)
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
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "qualification": "50 complete native tests: eight owned handshake and generation-two gameplay/receipt tests, 39 unchanged compatibility tests and three generation-one receipt/public-retry tests; 18 other kernel harnesses compile-only; no unequal-frontier repair, lost-reply rebind, CLI or browser qualification"}
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
