//! M6B routine mapping schemas for active and passive ability units.
//!
//! Wave 1 freezes exactly two audited schemas whose complete TypeScript
//! behavior is captured by one closed V2 query modifier with constant
//! operands:
//!
//! - [`BLOCK_CRIT_RULE`] / `BlockCritAbAttr`: the class body unconditionally
//!   sets the critical-hit boolean holder to `true`; frozen here as a
//!   `CriticalQuery` `Deny` at [`QueryModifierStageV2::FinalOverride`].
//! - [`BONUS_CRIT_RULE`] / `BonusCritAbAttr`: the class body unconditionally
//!   adds one to the crit-stage holder; frozen here as an `EarlyAdd` of the
//!   constant `1` on `CriticalQuery` (stage accumulation happens before crit
//!   determination and before any crit-multiplier stage).
//!
//! Every other implementation class stays explicitly unresolved (`Ok(None)`):
//! classes carrying callback/symbol/source-expression provenance have no
//! closed operand interpretation, classes whose `canApply` depends on move,
//! weather, HP-gate, or battler-tag state lack the required condition/value
//! vocabulary, and payload-less trigger operations (`WeatherSet`,
//! `StatusCure`, ...) cannot distinguish their observed multi-effect bodies
//! exactly. `RESOLVED_INTRINSIC` content-load definition units are intrinsic
//! definitions, not battle routines, and are not owned by this family.
//!
//! Source identity is preserved verbatim: active units keep
//! `ActiveAbility`/`AbilityAttribute`, passive units keep
//! `PassiveAbility`/`PassiveAttribute`; no schema rewrites or merges them.
//! Every emitted program carries a binding condition root
//! [`ConditionPredicateV2::AbilitySuppressed`] `{ suppressed: false }`, so a
//! suppressed owner never executes mapped behavior. Passive-slot eligibility
//! is runtime state (slots 0..2 are assigned per battler, not by the catalog);
//! deterministic active-before-passive-slot ordering is enforced by the
//! executor slice in `er-battle::m6::ability_executor`.

use er_content::m6_catalog::{
    CatalogBehaviorUnit, CatalogEffectKind, CatalogOperand, CatalogResolution, CatalogTargetKind,
    ImplementationClassEvidence,
};
use er_mechanics::condition_v2::{
    ConditionArenaV2, ConditionNodeId, ConditionNodeV2, ConditionPredicateV2, ValueArenaV2,
    ValueNodeId, ValueNodeV2,
};
use er_mechanics::selector_operation_v2::{QueryModifierStageV2, QueryModifierV2};
use er_mechanics::v2::MechanicHookV2;
use er_types::{BehaviorSourceId, BehaviorUnitKind};

use super::routine::{MappingFamily, MappingRuleId, RoutineCompileError, RoutineProgramSpec};

/// Frozen rule for `BlockCritAbAttr`: deny critical hits unconditionally.
pub const BLOCK_CRIT_RULE: MappingRuleId = MappingRuleId {
    family: MappingFamily::Abilities,
    ordinal: 1,
    version: 1,
};

/// Frozen rule for `BonusCritAbAttr`: add one crit stage unconditionally.
pub const BONUS_CRIT_RULE: MappingRuleId = MappingRuleId {
    family: MappingFamily::Abilities,
    ordinal: 2,
    version: 1,
};

/// Deterministic coverage metadata: every implementation class this module can
/// map, sorted. Integration closure tests assert this list against the fixture
/// class inventory.
pub const MAPPED_ABILITY_CLASSES: &[&str] = &["BlockCritAbAttr", "BonusCritAbAttr"];

/// Number of frozen ability mapping schemas.
pub const fn mapped_ability_class_count() -> usize {
    MAPPED_ABILITY_CLASSES.len()
}

/// Deterministic helper counting behavior units this family maps, for
/// integration coverage tests. Iteration order cannot affect the result.
pub fn mapped_unit_count<'a>(units: impl IntoIterator<Item = &'a CatalogBehaviorUnit>) -> usize {
    units
        .into_iter()
        .filter(|unit| matches!(map_abilities_unit(unit), Ok(Some(_))))
        .count()
}

/// Maps one catalog behavior unit onto an ability routine program spec.
///
/// Returns `Ok(Some(spec))` only for the frozen audited schemas after exact
/// unit-kind, source-identity, implementation-class, effect/hook, condition,
/// target, and operand-shape checks. Any unrecognized shape returns
/// `Ok(None)`; callers keep the unit unresolved. This function never
/// allocates final program IDs.
pub fn map_abilities_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !ability_owned_identity(unit)
        || unit.semantic.resolution == CatalogResolution::ResolvedIntrinsic
    {
        return Ok(None);
    }
    let Some(implementation) = unit.semantic.implementation.as_ref() else {
        return Ok(None);
    };
    if implementation.is_abstract {
        return Ok(None);
    }
    match implementation.name.as_str() {
        "BlockCritAbAttr" => map_block_crit(unit),
        "BonusCritAbAttr" => map_bonus_crit(unit),
        _ => Ok(None),
    }
}

/// Active/passive source identity with its exact unit kind; anything else is
/// not owned by the ability family.
fn ability_owned_identity(unit: &CatalogBehaviorUnit) -> bool {
    matches!(
        (&unit.id.source, unit.id.unit_kind),
        (
            BehaviorSourceId::ActiveAbility { .. },
            BehaviorUnitKind::AbilityAttribute
        ) | (
            BehaviorSourceId::PassiveAbility { .. },
            BehaviorUnitKind::PassiveAttribute
        )
    )
}

/// Exact shared evidence gate: implementation family/class/base/methods, hook
/// evidence, effect kind/attribute, unconditional `ALWAYS` condition, source-
/// defined target, and an empty constructor operand list.
fn exact_unit_shape(
    unit: &CatalogBehaviorUnit,
    class: &str,
    base: &str,
    methods: &[&str],
    hook_evidence: &str,
) -> bool {
    let semantic = &unit.semantic;
    let Some(implementation) = semantic.implementation.as_ref() else {
        return false;
    };
    let ImplementationClassEvidence {
        is_abstract,
        base: actual_base,
        family,
        methods: actual_methods,
        name,
        source: _,
    } = implementation;
    if *is_abstract
        || name != class
        || actual_base.as_deref() != Some(base)
        || family != "ABILITY_ATTRIBUTE"
        || actual_methods.len() != methods.len()
        || actual_methods
            .iter()
            .zip(methods)
            .any(|(actual, expected)| actual != expected)
    {
        return false;
    }
    if semantic.hook.0 != hook_evidence
        || !matches!(
            semantic.effect.kind,
            CatalogEffectKind::UnresolvedEffect | CatalogEffectKind::ModifyStatOrStage
        )
        || semantic.effect.attribute.as_deref() != Some(class)
        || !matches!(semantic.condition, Some(CatalogOperand::Always {}))
        || semantic.target.kind != CatalogTargetKind::SourceDefined
        || !semantic.operands.is_empty()
    {
        return false;
    }
    true
}

/// `BlockCritAbAttr`: body is a single unconditional `blockCrit.value = true`.
/// Frozen as `CriticalQuery` `Deny` at `FinalOverride`.
fn map_block_crit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !exact_unit_shape(
        unit,
        "BlockCritAbAttr",
        "AbAttr",
        &["apply"],
        "CRITICAL_QUERY",
    ) {
        return Ok(None);
    }
    suppressible_critical_query(
        BLOCK_CRIT_RULE,
        unit,
        QueryModifierStageV2::FinalOverride,
        QueryModifierV2::Deny,
        ValueArenaV2::default(),
    )
}

/// `BonusCritAbAttr`: body is a single unconditional `critStage.value += 1`.
/// Frozen as an `EarlyAdd` of constant `1` on `CriticalQuery`.
fn map_bonus_crit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !exact_unit_shape(
        unit,
        "BonusCritAbAttr",
        "AbAttr",
        &["apply"],
        "CRITICAL_QUERY",
    ) {
        return Ok(None);
    }
    suppressible_critical_query(
        BONUS_CRIT_RULE,
        unit,
        QueryModifierStageV2::EarlyAdd,
        QueryModifierV2::Add {
            value: ValueNodeId(0),
        },
        ValueArenaV2(vec![ValueNodeV2::Constant { value: 1 }]),
    )
}

/// Builds the query spec and installs the mandatory suppression gate: the
/// binding executes only while its owner's ability is not suppressed.
fn suppressible_critical_query(
    rule: MappingRuleId,
    unit: &CatalogBehaviorUnit,
    stage: QueryModifierStageV2,
    modifier: QueryModifierV2,
    values: ValueArenaV2,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    let mut spec = RoutineProgramSpec::single_query(
        rule,
        unit.id.clone(),
        MechanicHookV2::CriticalQuery,
        stage,
        modifier,
        values,
    )?;
    spec.conditions = ConditionArenaV2(vec![ConditionNodeV2::Predicate {
        predicate: ConditionPredicateV2::AbilitySuppressed { suppressed: false },
    }]);
    spec.bindings[0].condition_root = Some(ConditionNodeId(0));
    Ok(Some(spec))
}
