use std::error::Error;

use er_mechanics::condition_v2::{ConditionArenaErrorV2, ConditionArenaV2, ValueArenaV2};
use er_mechanics::m6::ProgramBudgetV2;
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, SelectorArenaV2, SelectorNodeIdV2, SelectorNodeV2,
};
use er_mechanics::{
    HookBindingV2, MechanicHookV2, MechanicsProgramV2, MechanicsProgramV2Error, ProgramRange,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind, BehaviorUnitOrdinal,
    M6_MECHANICS_PROGRAM_VERSION, ProvenanceHash, RngSiteId, RngSiteOrdinal, SafeU53,
};

fn unit() -> BehaviorUnitId {
    BehaviorUnitId {
        source: BehaviorSourceId::Move {
            numeric_id: SafeU53::new(1).expect("valid fixture move ID"),
        },
        unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
        ordinal: BehaviorUnitOrdinal::ZERO,
        provenance_hash: ProvenanceHash::parse("0".repeat(64)).expect("valid fixture provenance"),
    }
}

fn program(hook: MechanicHookV2, operation: MechanicOperationV2) -> MechanicsProgramV2 {
    let unit = unit();
    MechanicsProgramV2 {
        schema_version: M6_MECHANICS_PROGRAM_VERSION,
        id: MechanicsProgramId::try_from_u64(1).expect("valid fixture program ID"),
        source: unit.source.clone(),
        behavior_units: vec![unit.clone()],
        bindings: vec![HookBindingV2 {
            hook,
            authored_priority: 0,
            binding_ordinal: 0,
            behavior_unit: unit,
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        }],
        conditions: ConditionArenaV2::default(),
        selectors: SelectorArenaV2::default(),
        values: ValueArenaV2::default(),
        operations: vec![operation],
        scheduled_events: Vec::new(),
        rng_sites: Vec::new(),
        budget: ProgramBudgetV2 {
            hook_bindings: 1,
            condition_nodes: 0,
            selector_nodes: 0,
            value_nodes: 0,
            operations: 1,
            scheduled_events: 0,
            rng_draws: 0,
            spawned_instances: 0,
            presentation_cues: 0,
            selected_targets: 0,
        },
    }
}

#[test]
fn callback_field_cannot_enter_mechanics_program() -> Result<(), Box<dyn Error>> {
    let mut wire = serde_json::to_value(program(
        MechanicHookV2::BeforeMove,
        MechanicOperationV2::StatusApply,
    ))?;
    wire.as_object_mut()
        .ok_or("program wire is not an object")?
        .insert("callback".to_owned(), serde_json::json!("executeTs"));
    assert!(serde_json::from_value::<MechanicsProgramV2>(wire).is_err());
    Ok(())
}

#[test]
fn query_hook_cannot_stage_mutation() {
    let error = program(
        MechanicHookV2::MovePowerQuery,
        MechanicOperationV2::StatusApply,
    )
    .validate()
    .expect_err("query mutation must fail");
    assert!(matches!(
        error,
        MechanicsProgramV2Error::MutationOnQuery { .. }
    ));
}

#[test]
fn random_selector_requires_declared_rng_site() {
    let mut program = program(MechanicHookV2::BeforeMove, MechanicOperationV2::StatusApply);
    let site = RngSiteId {
        ordinal: RngSiteOrdinal::ZERO,
        provenance_hash: ProvenanceHash::parse("1".repeat(64))
            .expect("valid fixture RNG provenance"),
    };
    program.selectors = SelectorArenaV2(vec![
        SelectorNodeV2::Actor,
        SelectorNodeV2::RandomOne {
            input: SelectorNodeIdV2::ZERO,
            rng_site: site,
        },
    ]);
    program.bindings[0].selector_root = Some(SelectorNodeIdV2(1));
    program.budget.selector_nodes = 2;
    assert!(matches!(
        program.validate(),
        Err(MechanicsProgramV2Error::UnknownSelectorRngSite)
    ));
}

#[test]
fn condition_root_out_of_bounds_fails_without_panicking() {
    let arena = ConditionArenaV2::default();
    assert_eq!(
        arena.validate(&[0]),
        Err(ConditionArenaErrorV2::RootOutOfBounds)
    );
}
