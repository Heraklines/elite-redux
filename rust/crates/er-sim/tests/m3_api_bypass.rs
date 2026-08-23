//! Architectural source-negative audit for the M3 Battle seam.
//!
//! This is intentionally a source audit, not a second implementation of the
//! kernel.  The legacy M2 kernel still contains its fixture plans and
//! canonical material/control effects, so the checks scope those exclusions
//! to the production `BattleMode` source and verify that the Battle path
//! rejects the compatibility acknowledgements instead of accepting them.

use std::error::Error;

// This source-negative audit exercises only one constructor from the full parity adapter.
#[allow(dead_code)]
#[path = "../../er-wasm/src/m3_parity.rs"]
mod m3_parity;

use er_types::{
    ControlProjectionOutcome, KernelInput, MaterialApplicationOutcome, PresentationEventId,
    PresentationOutcome, Revision, SafeU53, SeatId,
};

const BATTLE_KERNEL_SOURCE: &str = include_str!("../../er-kernel/src/battle_kernel.rs");
const KERNEL_SOURCE: &str = include_str!("../../er-kernel/src/kernel.rs");
const KERNEL_INPUT_SOURCE: &str = include_str!("../../er-types/src/protocol.rs");
const RUNTIME_SOURCE: &str = include_str!("../../er-game/src/runtime.rs");
const BATTLE_UI_TYPES_SOURCE: &str = include_str!("../../er-types/src/battle_ui.rs");
const PARITY_SOURCE: &str = include_str!("../../er-wasm/src/m3_parity.rs");
const TEARDOWN_SOURCE: &str = include_str!("m3_resource_teardown.rs");
const BENCHMARK_SOURCE: &str = include_str!("../benches/m3_benchmark.rs");
const M3_COVERAGE_MAP: &str = include_str!("../../../fixtures/m3/m3-coverage-map.json");

const LEGACY_PLAN_TYPES: [&str; 3] = [
    "ControlMenuPlan",
    "AuthorityResolutionPlan",
    "MenuProposalPlan",
];

const SEMANTIC_CAMPAIGN_OPERATIONS: [&str; 8] = [
    "select_move(",
    "select_target(",
    "submit_command(",
    "select_command(",
    "select_party_slot(",
    "choose_replacement(",
    "resolve_turn(",
    "resolve_replacement(",
];

fn between<'a>(source: &'a str, start: &str, end: &str) -> Option<&'a str> {
    source
        .split_once(start)?
        .1
        .split_once(end)
        .map(|(section, _)| section)
}

fn local_seat() -> SeatId {
    SeatId::new(SafeU53::new(1).unwrap_or(SafeU53::ZERO))
}

#[test]
fn battle_mode_has_no_fixture_plans_or_public_semantic_driver() {
    for forbidden in LEGACY_PLAN_TYPES {
        assert!(
            !BATTLE_KERNEL_SOURCE.contains(forbidden),
            "BattleMode must not carry legacy fixture plan type {forbidden}"
        );
    }
    assert!(
        !BATTLE_KERNEL_SOURCE.contains("pub fn "),
        "BattleMode methods must remain crate-private behind GameKernel"
    );
    for forbidden in SEMANTIC_CAMPAIGN_OPERATIONS {
        assert!(
            !PARITY_SOURCE.contains(forbidden),
            "parity adapter must not expose semantic campaign operation {forbidden}"
        );
        assert!(
            !TEARDOWN_SOURCE.contains(forbidden),
            "teardown test must not drive semantic campaign operation {forbidden}"
        );
        assert!(
            !BENCHMARK_SOURCE.contains(forbidden),
            "benchmark must not drive semantic campaign operation {forbidden}"
        );
    }
    for (label, source) in [
        ("parity adapter", PARITY_SOURCE),
        ("teardown test", TEARDOWN_SOURCE),
        ("benchmark", BENCHMARK_SOURCE),
    ] {
        assert!(
            source.contains("GameKernel::new_battle"),
            "{label} must construct the production Battle kernel"
        );
        assert!(
            source.contains("KernelInput::RawInput"),
            "{label} must cross the raw physical-input boundary"
        );
        assert!(
            !source.contains("GameRuntime::"),
            "{label} must not bypass GameKernel with a mutable runtime"
        );
        for forbidden in [".game.", ".battle.", ".protocol."] {
            assert!(
                !source.contains(forbidden),
                "{label} must not reach an internal mutable owner through {forbidden}"
            );
        }
        assert!(
            !source.contains("_trusted("),
            "{label} must not call a doc-hidden trusted-content transaction seam"
        );
    }
    assert!(RUNTIME_SOURCE.contains("resolve_turn_trusted_with_finalizer"));
    for (label, source) in [
        ("parity adapter", PARITY_SOURCE),
        ("teardown test", TEARDOWN_SOURCE),
        ("benchmark", BENCHMARK_SOURCE),
    ] {
        assert!(
            !source.contains("resolve_turn_trusted_with_finalizer"),
            "{label} must not call the doc-hidden resolver finalizer seam"
        );
    }

    let input_source = between(
        KERNEL_INPUT_SOURCE,
        "pub enum KernelInput",
        "pub enum KernelEffect",
    )
    .unwrap_or_default();
    assert!(
        !input_source.contains("UiIntent")
            && !input_source.contains("select_")
            && !input_source.contains("submit_")
            && !input_source.contains("resolve_"),
        "KernelInput must not expose semantic or UiIntent injection"
    );
    assert!(
        !BATTLE_UI_TYPES_SOURCE.contains("cursor"),
        "Battle menu identity must be stable option/menu-instance identity, not a numeric cursor"
    );
    assert!(BATTLE_UI_TYPES_SOURCE.contains("selected_option_id"));
    assert!(BATTLE_UI_TYPES_SOURCE.contains("MenuInstanceId"));

    let battle_protocol_config = between(
        KERNEL_SOURCE,
        "pub struct BattleProtocolConfig",
        "pub enum BattleProtocolRoleConfig",
    )
    .unwrap_or_default();
    assert!(
        !battle_protocol_config.contains("menu_plans")
            && !battle_protocol_config.contains("resolutions"),
        "BattleProtocolConfig must not carry fixture plans or authored resolutions"
    );
}

#[test]
fn battle_mode_emits_only_battle_owned_effects() {
    for forbidden_push in [
        "effects.push(KernelEffect::ApplyAuthorityMaterial",
        "effects.push(KernelEffect::ProjectAuthorityControl",
        "effects.push(KernelEffect::UiIntent",
        "self.effects.push(KernelEffect::ApplyAuthorityMaterial",
        "self.effects.push(KernelEffect::ProjectAuthorityControl",
        "self.effects.push(KernelEffect::UiIntent",
    ] {
        assert!(
            !BATTLE_KERNEL_SOURCE.contains(forbidden_push),
            "BattleMode must not emit {forbidden_push}"
        );
    }
    assert!(BATTLE_KERNEL_SOURCE.contains("KernelEffect::PresentBattle"));
    assert!(BATTLE_KERNEL_SOURCE.contains("KernelEffect::BattleUiChanged"));
}

#[test]
fn external_material_control_and_legacy_presentation_success_are_rejected() {
    for boundary in ["MaterialApplied", "ControlProjected", "PresentationSettled"] {
        assert!(
            BATTLE_KERNEL_SOURCE.contains(&format!("boundary: \"{boundary}\"")),
            "BattleMode must reject compatibility boundary {boundary}"
        );
    }
    assert!(BATTLE_KERNEL_SOURCE.contains("KernelInput::MaterialApplied { .. }"));
    assert!(BATTLE_KERNEL_SOURCE.contains("KernelInput::ControlProjected { .. }"));
    assert!(BATTLE_KERNEL_SOURCE.contains("KernelInput::PresentationSettled { .. }"));
    assert!(BATTLE_KERNEL_SOURCE.contains("CompatibilityBoundary"));
    assert!(!PARITY_SOURCE.contains("MaterialApplied {"));
    assert!(!PARITY_SOURCE.contains("ControlProjected {"));
    assert!(!PARITY_SOURCE.contains("PresentationSettled {"));
}

#[test]
fn battle_public_boundary_rejects_legacy_success_inputs_without_mutation()
-> Result<(), Box<dyn Error>> {
    let mut kernel = m3_parity::new_battle_kernel("m3-api-bypass-negative")?;
    let before_snapshot = kernel.snapshot();
    let before_resources = kernel.live_resources();
    let endpoint = local_seat();

    let inputs = [
        (
            "MaterialApplied",
            KernelInput::MaterialApplied {
                endpoint,
                revision: Revision::ZERO,
                outcome: MaterialApplicationOutcome::Applied,
            },
        ),
        (
            "ControlProjected",
            KernelInput::ControlProjected {
                endpoint,
                revision: Revision::ZERO,
                outcome: ControlProjectionOutcome::Installed {
                    control_id: "m3-api-bypass-control".to_owned(),
                },
            },
        ),
        (
            "PresentationSettled",
            KernelInput::PresentationSettled {
                endpoint,
                event_id: PresentationEventId::ZERO,
                outcome: PresentationOutcome::Settled,
            },
        ),
    ];

    for (boundary, input) in inputs {
        let result = kernel.step(input);
        assert!(
            result.is_err(),
            "Battle accepted legacy boundary {boundary}"
        );
        let error = result
            .err()
            .map(|value| value.to_string())
            .unwrap_or_default();
        assert!(
            error.contains("legacy compatibility boundary"),
            "Battle rejected {boundary} for an unexpected reason: {error}"
        );
        assert_eq!(
            kernel.snapshot(),
            before_snapshot,
            "{boundary} mutated state"
        );
        assert_eq!(
            kernel.live_resources(),
            before_resources,
            "{boundary} mutated live resources"
        );
    }
    Ok(())
}

#[test]
fn battle_kernel_owns_the_quiescent_fifo_and_runtime_reducer_boundary() {
    assert!(BATTLE_KERNEL_SOURCE.contains("fn drain(&mut self)"));
    assert!(BATTLE_KERNEL_SOURCE.contains("fn reduce_event(&mut self"));
    assert!(BATTLE_KERNEL_SOURCE.contains("game: Arc<GameRuntime>"));
    assert!(BATTLE_KERNEL_SOURCE.contains("Arc::make_mut(&mut self.game)"));
    assert!(BATTLE_KERNEL_SOURCE.contains("game_changed_in_transaction: bool"));
    assert!(BATTLE_KERNEL_SOURCE.contains("self.game_changed_in_transaction = true"));
    assert!(BATTLE_KERNEL_SOURCE.contains("self.staged.game_changed_in_transaction"));
    for staged_boundary in [
        "sync_battle_ui_selection_in_kernel_transaction",
        "reduce_ui_in_kernel_transaction",
        "retain_replica_command_in_kernel_transaction",
        "retain_replica_replacement_in_kernel_transaction",
        "reduce_game_in_kernel_transaction",
        "install_material_in_kernel_transaction",
        "take_pending_no_legal_replacement_in_kernel_transaction",
    ] {
        assert!(
            BATTLE_KERNEL_SOURCE.contains(staged_boundary),
            "BattleMode must use the explicit staged game boundary {staged_boundary}"
        );
        assert!(
            RUNTIME_SOURCE.contains(&format!("pub fn {staged_boundary}")),
            "GameRuntime must own staged boundary {staged_boundary}"
        );
    }
    assert!(!BATTLE_KERNEL_SOURCE.contains("self.staged.game.reduce_ui"));
    assert!(!BATTLE_KERNEL_SOURCE.contains("self.staged.game.reduce_game"));
    assert!(BATTLE_KERNEL_SOURCE.contains("self.queue.push_all_source_order"));
    assert!(BATTLE_KERNEL_SOURCE.contains("validate_quiescent"));
    assert!(RUNTIME_SOURCE.contains("pub fn reduce_ui"));
    assert!(RUNTIME_SOURCE.contains("pub fn reduce_game"));
    assert!(!PARITY_SOURCE.contains("serde_json::Value"));
}

#[test]
fn public_kernel_selects_battle_before_the_legacy_fixture_dispatch() {
    let constructor = KERNEL_SOURCE
        .find("pub fn new_battle(")
        .expect("production Battle constructor must stay public");
    let step = KERNEL_SOURCE
        .find("pub fn step(&mut self, input: KernelInput)")
        .expect("production GameKernel step must stay public");
    assert!(constructor < step);
    let battle_selection = KERNEL_SOURCE
        .find("if self.battle.is_some()")
        .expect("public GameKernel step must select the production Battle mode");
    let battle_dispatch = KERNEL_SOURCE
        .find(".step(&mut self.scheduler, terminal, input)")
        .expect("public GameKernel step must dispatch through BattleMode::step");
    let legacy_fixture_dispatch = KERNEL_SOURCE
        .find("match input {\n            KernelInput::RawInput { seat, event }")
        .expect("public GameKernel step must retain the legacy fixture dispatch");
    assert!(step < battle_selection);
    assert!(
        battle_selection < battle_dispatch,
        "GameKernel must dispatch the selected Battle mode through its public step"
    );
    assert!(
        battle_dispatch < legacy_fixture_dispatch,
        "Battle dispatch must precede the legacy fixture dispatch"
    );
    assert!(KERNEL_SOURCE.contains("pub fn battle_ui_projection"));
}

#[test]
fn m3_api_bypass_audit_is_registered_by_the_coverage_contract() {
    for required in [
        "ARCHITECTURAL_BATTLE_SEAM_CLOSURE",
        "NO_CONTROL_MENU_PLAN_IN_BATTLE_MODE",
        "NO_AUTHORITY_RESOLUTION_PLAN_IN_BATTLE_MODE",
        "NO_EXTERNAL_MATERIAL_APPLIED_OR_CONTROL_PROJECTED",
        "NO_CANONICAL_WORK_EFFECTS",
        "rust/crates/er-sim/tests/m3_api_bypass.rs",
    ] {
        assert!(
            M3_COVERAGE_MAP.contains(required),
            "M3 coverage map lost architecture-negative marker {required}"
        );
    }
}
