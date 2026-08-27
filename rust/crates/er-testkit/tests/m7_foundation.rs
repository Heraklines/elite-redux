//! M7 foundation architecture and API-bypass proof.

use std::fmt::Debug;

use serde::{Serialize, de::DeserializeOwned};

const RESOLVER: &str = include_str!("../../er-battle/src/m7_resolver.rs");
const GAME_CONTENT: &str = include_str!("../../er-game/src/m7_content.rs");
const GAME_MATERIAL: &str = include_str!("../../er-game/src/m7_material.rs");
const GAME_RUNTIME: &str = include_str!("../../er-game/src/m7_runtime.rs");
const RUN_EXECUTOR: &str = include_str!("../../er-game/src/m7_run_executor.rs");
const PROGRESSION_CONTROL: &str = include_str!("../../er-game/src/m7_progression_control.rs");
const GAME_KERNEL: &str = include_str!("../../er-kernel/src/game_kernel_v6.rs");
const STATE: &str = include_str!("../../er-state/src/m7_state.rs");
const RUN_IR: &str = include_str!("../../er-types/src/m7_run_ir.rs");
const SCENARIO: &str = include_str!("../../er-scenario/src/lib.rs");
const SCENARIO_RUNTIME: &str = include_str!("../../er-scenario/src/runtime.rs");
const PROGRESSION: &str = include_str!("../../er-progression/src/lib.rs");
const PROGRESSION_RUNTIME: &str = include_str!("../../er-progression/src/progression.rs");
const LIFECYCLE_RUNTIME: &str = include_str!("../../er-progression/src/lifecycle.rs");
const LIFECYCLE_MATERIAL: &str = include_str!("../../er-progression/src/material.rs");
const WORLD: &str = include_str!("../../er-world/src/lib.rs");
const WORLD_RUNTIME: &str = include_str!("../../er-world/src/runtime.rs");
const AI: &str = include_str!("../../er-ai/src/lib.rs");
const SHOWDOWN: &str = include_str!("../../er-ai/src/showdown.rs");
const SAVE: &str = include_str!("../../er-save/src/lib.rs");
const SNAPSHOT: &str = include_str!("../../er-kernel/src/snapshot_v6.rs");
const ENVIRONMENT: &str = include_str!("../../er-env/src/lib.rs");
const WASM: &str = include_str!("../../er-wasm/src/m7_parity.rs");

fn assert_wire_type<T: Serialize + DeserializeOwned + Debug + PartialEq>() {}

#[test]
fn m7_canonical_types_are_strict_serializable_values() {
    assert_wire_type::<er_state::m7_state::GameStateV5>();
    assert_wire_type::<er_state::m7_state::RunStateV3>();
    assert_wire_type::<er_state::m7_state::PokemonStateV5>();
    assert_wire_type::<er_state::m7_state::BattleStateV5>();
    assert_wire_type::<er_game::m7_content::GameContentBundleV1>();
    assert_wire_type::<er_game::m7_material::BattleTurnMaterialV5>();
    assert_wire_type::<er_kernel::snapshot_v6::RestorableKernelSnapshotV6>();
    assert_wire_type::<er_kernel::snapshot_v6::KernelTraceV6>();
    assert_wire_type::<er_save::GameSaveV1>();
    assert_wire_type::<er_save::GameReplayV1>();
}

#[test]
fn direct_resolver_uses_prepared_m6_ir_without_legacy_projection() {
    for required in [
        "PreparedBattleContentV3",
        "execute_query_v2",
        "execute_hook_v2",
        "MechanicsOperationEvidenceV5",
        "RngCallsiteId::accuracy",
        "RngCallsiteId::critical_hit",
        "RngCallsiteId::damage_variance",
        "verify_v5_dispatch_closure",
        "handlers_for",
    ] {
        assert!(
            RESOLVER.contains(required),
            "missing direct resolver seam {required}"
        );
    }
    for forbidden in [
        "project_legacy_state",
        "merge_legacy_state",
        "LegacyResolver",
        "selected_content_pack",
        "BattleStartV1",
        "GameKernel::new_battle",
        "er_state::snapshot::GameState",
        "er_content::pack::ContentPack",
    ] {
        assert!(
            !RESOLVER.contains(forbidden),
            "legacy resolver seam {forbidden}"
        );
        assert!(
            !GAME_RUNTIME.contains(forbidden),
            "legacy runtime seam {forbidden}"
        );
    }
}

#[test]
fn host_and_replica_share_one_serialized_material_applier() {
    assert!(GAME_MATERIAL.contains("apply_serialized_turn_material_v5"));
    assert!(GAME_MATERIAL.contains("apply_turn_material_v5"));
    assert!(GAME_MATERIAL.contains("decode_canonical"));
    assert!(!GAME_MATERIAL.contains("host_apply"));
    assert!(!GAME_MATERIAL.contains("guest_apply"));
}

#[test]
fn new_canonical_surfaces_exclude_escape_hatches() {
    let sources = [
        RESOLVER,
        GAME_CONTENT,
        GAME_MATERIAL,
        GAME_RUNTIME,
        RUN_EXECUTOR,
        PROGRESSION_CONTROL,
        GAME_KERNEL,
        STATE,
        RUN_IR,
        SCENARIO,
        SCENARIO_RUNTIME,
        PROGRESSION,
        PROGRESSION_RUNTIME,
        LIFECYCLE_RUNTIME,
        LIFECYCLE_MATERIAL,
        WORLD,
        WORLD_RUNTIME,
        AI,
        SHOWDOWN,
        SAVE,
        SNAPSHOT,
        ENVIRONMENT,
        WASM,
    ];
    for source in sources {
        for forbidden in [
            "serde_json::Value",
            "HashMap",
            "HashSet",
            "unsafe {",
            "todo!",
            "unimplemented!",
            "Box<dyn",
            "Arc<dyn",
            "std::time::Instant",
            "std::fs",
            "std::net",
            "saturating_",
        ] {
            assert!(
                !source.contains(forbidden),
                "canonical escape hatch {forbidden}"
            );
        }
    }
}

#[test]
fn run_and_scenario_ir_are_closed_vocabs() {
    assert!(RUN_IR.contains("pub enum RunOperation"));
    assert!(!RUN_IR.contains("CallFunction"));
    assert!(!RUN_IR.contains("Script"));
    assert!(SCENARIO.contains("pub enum ScenarioNode"));
    assert!(!SCENARIO.contains("Callback"));
    assert!(!SCENARIO.contains("JavaScript"));
}
