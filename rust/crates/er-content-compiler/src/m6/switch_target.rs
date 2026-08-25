//! M6B routine mapping for the [`MappingFamily::SwitchTarget`] family.
//!
//! Audited per-attribute schemas freeze hook, selector, and operation bodies
//! for the closed subset of target-rewriting, switching, pivot, redirection,
//! and legality behavior this family owns. Every schema admits a catalog
//! behavior unit only after exact unit-kind, implementation-class, effect
//! kind, hook-evidence, and constructor operand shape checks; any mismatch is
//! [`None`] (the unit stays an explicit unresolved outcome) — never a neutral
//! or fabricated operation.
//!
//! Commander-style forced chains, identity-transforming form changes, callback
//! target rewrites, counter redirection, random forced-switch bench selection
//! (unresolved RNG range gap), substitute transfer, live position swaps, and
//! ability swaps remain explicit bespoke gaps; see
//! [`EXPLICIT_SWITCH_TARGET_GAPS`].
//!
//! Selector programs preserve canonical target order: trigger schemas root on
//! single-subject selectors ([`SelectorNodeV2::Actor`]) and never assume fixed
//! battler indices. Mapping-rule ordinals are stable constants; program specs
//! carry no final program ID (allocation stays in the central pipeline).

use er_content::m6_catalog::{CatalogBehaviorUnit, CatalogEffectKind, CatalogOperand};
use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2};
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2, SelectorArenaV2, SelectorNodeIdV2,
    SelectorNodeV2,
};
use er_mechanics::v2::MechanicHookV2;
use er_mechanics::{HookBindingV2, ProgramRange};
use er_types::BehaviorUnitKind;

use crate::m6::routine::{
    MappingFamily, MappingRuleId, RoutineCompileError, RoutineProgramSpec, implementation_name,
};

/// Schema version of every routine emitted by this family.
const SCHEMA_VERSION: u16 = 1;

/// Stable ordinal: `ForceSwitchOutAttr(selfSwitch = true, SWITCH | BATON_PASS)`
/// staged as a pivot request for the acting battler.
pub const RULE_ORDINAL_FORCE_SWITCH_OUT_PIVOT: u32 = 0;

/// Stable ordinal: `BypassRedirectAttr(abilitiesOnly = false)` denying target
/// rewriting through the move-target legality query.
pub const RULE_ORDINAL_BYPASS_REDIRECT: u32 = 1;

/// Stable ordinal: `BlockRedirectAbAttr()` denying target rewriting through
/// the move-target legality query.
pub const RULE_ORDINAL_BLOCK_REDIRECT: u32 = 2;

/// Deterministic coverage metadata: exact implementation classes this family
/// owns audited schemas for, sorted lexicographically.
pub fn recognized_switch_target_classes() -> &'static [&'static str] {
    &["BlockRedirectAbAttr", "BypassRedirectAttr", "ForceSwitchOutAttr"]
}

/// Deterministic coverage metadata: number of audited schemas above.
pub fn recognized_switch_target_schema_count() -> usize {
    recognized_switch_target_classes().len()
}

/// Classes and class shapes deliberately left as explicit bespoke/unresolved
/// outcomes, each with the frozen reason. Sorted lexicographically by class.
pub const EXPLICIT_SWITCH_TARGET_GAPS: &[(&str, &str)] = &[
    (
        "AllySwitchAttr",
        "LIVE_POSITION_SWAP_HAS_NO_CLOSED_OPERATION",
    ),
    (
        "CounterRedirectAttr",
        "COUNTER_TARGET_REDIRECTION_REMAINS_BESPOKE_PER_M6_TARGETING_PLAN",
    ),
    (
        "ForceSwitchOutAttr:FORCE_SWITCH",
        "RANDOM_BENCH_SELECTION_NEEDS_AN_UNRESOLVED_RNG_RANGE_GAP",
    ),
    (
        "ForceSwitchOutAttr:SHED_TAIL",
        "SUBSTITUTE_TRANSFER_BELONGS_TO_THE_SUBSTITUTE_PROXY_BESPOKE_CLUSTER",
    ),
    (
        "ForceSwitchOutImmunityAbAttr",
        "SWITCH_INTERACTION_CANCELLATION_LACKS_A_CLOSED_TRIGGER_SCHEMA",
    ),
    (
        "PreSwitchOutFormChangeAbAttr",
        "IDENTITY_TRANSFORMING_FORM_CHANGE_REMAINS_BESPOKE",
    ),
    (
        "PreSwitchOutHealAbAttr",
        "PRE_SWITCH_OUT_HEAL_IS_CROSS_FAMILY_AND_UNSCHEMAED_HERE",
    ),
    (
        "RoarOfTimeForceSwitchOutAttr",
        "FORCED_CHAIN_SUBCLASS_WITH_DYNAMIC_CONDITION_REMAINS_BESPOKE",
    ),
    ("SwitchAbilitiesAttr", "ABILITY_SWAP_HAS_NO_CLOSED_OPERATION"),
    (
        "VariableTargetAttr",
        "CALLBACK_TARGET_REWRITE_REMAINS_BESPOKE_PER_M6_TARGETING_PLAN",
    ),
];

/// Deterministic coverage metadata: number of explicit gap entries above.
pub fn explicit_switch_target_gap_count() -> usize {
    EXPLICIT_SWITCH_TARGET_GAPS.len()
}

const fn rule(ordinal: u32) -> MappingRuleId {
    MappingRuleId {
        family: MappingFamily::SwitchTarget,
        ordinal,
        version: SCHEMA_VERSION,
    }
}

/// Maps one catalog behavior unit to this family's routine program spec.
///
/// [`Some`] only after the exact schema checks documented on the family; every
/// other shape returns [`None`] so callers keep the unit explicitly unresolved.
/// No unrecognized class, hook, or operand is ever converted into a compiled
/// operation here.
pub fn map_switch_target_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if let Some(spec) = map_force_switch_out_pivot(unit)? {
        return Ok(Some(spec));
    }
    if let Some(spec) = map_bypass_redirect(unit)? {
        return Ok(Some(spec));
    }
    map_block_redirect(unit)
}

/// Closed switch-type symbols admitted by the pivot schema.
enum SwitchTypeSymbol {
    Switch,
    BatonPass,
}

fn switch_type_symbol(op: &CatalogOperand) -> Option<SwitchTypeSymbol> {
    match op {
        CatalogOperand::SymbolProvenance { owner, member, .. } if owner == "SwitchType" => {
            match member.as_str() {
                "SWITCH" => Some(SwitchTypeSymbol::Switch),
                "BATON_PASS" => Some(SwitchTypeSymbol::BatonPass),
                _ => None,
            }
        }
        _ => None,
    }
}

fn implementation_matches(unit: &CatalogBehaviorUnit, name: &str, base: &str) -> bool {
    implementation_name(unit) == Some(name)
        && unit.semantic.implementation.as_ref().is_some_and(|implementation| {
            !implementation.is_abstract && implementation.base.as_deref() == Some(base)
        })
}

/// Closed trigger-hook evidence table for move-effect application.
fn trigger_hook_from_evidence(evidence: &str) -> Option<MechanicHookV2> {
    match evidence {
        "AFTER_HIT" => Some(MechanicHookV2::AfterHit),
        "AFTER_MOVE" => Some(MechanicHookV2::AfterMove),
        _ => None,
    }
}

/// Pivot schema: `new ForceSwitchOutAttr(true, SwitchType.SWITCH)` and
/// `new ForceSwitchOutAttr(true, SwitchType.BATON_PASS)` stage exactly one
/// [`MechanicOperationV2::PivotRequest`] for the actor on the observed
/// post-hit/post-move trigger hook. The forced-target (`selfSwitch = false`)
/// and `SHED_TAIL` shapes stay explicit gaps: the oracle draws a random bench
/// replacement through an unresolved-range RNG site, and Shed Tail transfers a
/// Substitute across the switch.
fn map_force_switch_out_pivot(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if unit.id.unit_kind != BehaviorUnitKind::MoveAttribute
        || !implementation_matches(unit, "ForceSwitchOutAttr", "MoveEffectAttr")
        || unit.semantic.effect.kind != CatalogEffectKind::SwitchOrTrap
    {
        return Ok(None);
    }

    // Exact constructor shape: (selfSwitch: BOOLEAN = true, switchType:
    // SYMBOL_PROVENANCE owned by SwitchType). Any other arity, kind, value, or
    // symbol owner leaves the unit unresolved.
    let [CatalogOperand::Boolean { value: self_switch }, second] = &unit.semantic.operands[..]
    else {
        return Ok(None);
    };
    if !*self_switch {
        return Ok(None);
    }
    match switch_type_symbol(second) {
        Some(SwitchTypeSymbol::Switch | SwitchTypeSymbol::BatonPass) => {}
        _ => return Ok(None),
    }

    let Some(hook) = trigger_hook_from_evidence(unit.semantic.hook.0.as_str()) else {
        return Ok(None);
    };

    // Canonical order guarantee: the program owns exactly one subject selector
    // (the actor), one binding, and one staged operation.
    let selectors = SelectorArenaV2(vec![SelectorNodeV2::Actor]);
    Ok(Some(RoutineProgramSpec {
        rule: rule(RULE_ORDINAL_FORCE_SWITCH_OUT_PIVOT),
        behavior_unit: unit.id.clone(),
        bindings: vec![HookBindingV2 {
            hook,
            authored_priority: 0,
            binding_ordinal: 0,
            behavior_unit: unit.id.clone(),
            condition_root: None,
            selector_root: Some(SelectorNodeIdV2::ZERO),
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        }],
        conditions: ConditionArenaV2::default(),
        selectors,
        values: ValueArenaV2::default(),
        operations: vec![MechanicOperationV2::PivotRequest],
        scheduled_events: Vec::new(),
        rng_sites: Vec::new(),
        spawned_instances: 0,
        presentation_cues: 0,
        selected_targets: 1,
    }))
}

/// Shared body of the two redirect-blocking legality schemas: one
/// [`MechanicHookV2::MoveTargetQuery`] binding whose final-stage
/// [`QueryModifierV2::Deny`] vetoes target rewriting for the owning move.
fn map_redirect_denial_query(
    unit: &CatalogBehaviorUnit,
    admitted_kinds: &[BehaviorUnitKind],
    name: &str,
    base: &str,
    effect_kind: CatalogEffectKind,
    ordinal: u32,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !admitted_kinds.contains(&unit.id.unit_kind)
        || !implementation_matches(unit, name, base)
        || unit.semantic.effect.kind != effect_kind
        || unit.semantic.hook.0 != "MOVE_TARGET_QUERY"
    {
        return Ok(None);
    }
    Ok(Some(RoutineProgramSpec::single_query(
        rule(ordinal),
        unit.id.clone(),
        MechanicHookV2::MoveTargetQuery,
        QueryModifierStageV2::FinalOverride,
        QueryModifierV2::Deny,
        ValueArenaV2::default(),
    )?))
}

/// Basic-redirection schema: `new BypassRedirectAttr(false)` (and the
/// zero-operand default) makes the move ignore all redirection effects. The
/// `abilitiesOnly = true` shape needs a redirect-source-class condition the IR
/// does not close yet and stays unresolved.
fn map_bypass_redirect(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if unit.id.unit_kind != BehaviorUnitKind::MoveAttribute
        || !implementation_matches(unit, "BypassRedirectAttr", "MoveAttr")
        || unit.semantic.effect.kind != CatalogEffectKind::ModifyTarget
    {
        return Ok(None);
    }
    match unit.semantic.operands.as_slice() {
        [] => {}
        [CatalogOperand::Boolean { value }] if !*value => {}
        _ => return Ok(None),
    }
    map_redirect_denial_query(
        unit,
        &[BehaviorUnitKind::MoveAttribute],
        "BypassRedirectAttr",
        "MoveAttr",
        CatalogEffectKind::ModifyTarget,
        RULE_ORDINAL_BYPASS_REDIRECT,
    )
}

/// Basic-redirection schema: `BlockRedirectAbAttr` (ability or passive slot,
/// no constructor operands) blocks redirection of the holder's moves through
/// the same closed move-target query denial.
fn map_block_redirect(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !matches!(
        unit.id.unit_kind,
        BehaviorUnitKind::AbilityAttribute | BehaviorUnitKind::PassiveAttribute
    ) || !unit.semantic.operands.is_empty()
    {
        return Ok(None);
    }
    map_redirect_denial_query(
        unit,
        &[
            BehaviorUnitKind::AbilityAttribute,
            BehaviorUnitKind::PassiveAttribute,
        ],
        "BlockRedirectAbAttr",
        "AbAttr",
        CatalogEffectKind::ModifyTarget,
        RULE_ORDINAL_BLOCK_REDIRECT,
    )
}
