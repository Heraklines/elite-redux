//! M6B routine mapping family for MOVE behavior units.
//!
//! Every rule below admits an exact implementation class under an exact
//! constructor operand shape taken from the frozen semantic catalog
//! (`rust/fixtures/m6/semantic-catalog-v1.json`). A unit that differs in any
//! evidence dimension — unit kind, resolution class, effect kind/attribute,
//! implementation family/name, hook evidence, target scope, condition, or
//! operand arity/kind — yields `Ok(None)`: the family does not own it and the
//! caller keeps the unit unresolved. A value that fits an owned shape but
//! violates a closed IR bound yields a typed [`RoutineCompileError`].
//!
//! Frozen per-class hook mapping (hook evidence is provenance; the closed
//! [`MechanicHookV2`] choice is frozen here per audited schema):
//!
//! | Class                | Evidence             | Closed hook    |
//! |----------------------|----------------------|----------------|
//! | HighCritAttr         | CRITICAL_QUERY       | CriticalQuery  |
//! | CritOnlyAttr         | CRITICAL_QUERY       | CriticalQuery  |
//! | FixedDamageAttr      | DAMAGE_QUERY         | DamageQuery    |
//! | LevelDamageAttr      | DAMAGE_QUERY         | DamageQuery    |
//! | UserHpDamageAttr     | DAMAGE_QUERY         | DamageQuery    |
//! | MultiHitAttr (fixed) | UNRESOLVED_HOOK      | HitCountQuery  |
//! | StatusEffectAttr     | STAT_QUERY_OR_CHANGE | AfterHit       |
//! | StatStageChangeAttr  | STAT_QUERY_OR_CHANGE | AfterHit       |
//! | RecoilAttr           | UNRESOLVED_HOOK      | AfterDamage    |
//! | HitHealAttr          | UNRESOLVED_HOOK      | AfterDamage    |
//!
//! Fixture assumptions recorded for integration:
//!
//! - `INTRINSIC_MOVE_RULE` units carry no operands and no closed per-unit
//!   operation; they remain central-pipeline identity admissions, never
//!   routine programs.
//! - `StatusEffectAttr` sites are staged as unconditional `StatusApply`; the
//!   battle adapter applies the prepared move-level chance gate before
//!   delivery. Probabilistic gating cannot enter the program because catalog
//!   RNG sites are non-bindable bespoke gaps.
//! - `StatStageChangeAttr` stat identities and status payloads are resolved
//!   by the battle adapter from the owning behavior unit; the V2 operation
//!   vocabulary carries only the stage delta.
//! - Recoil/drain ratios are admitted only when the authored JavaScript
//!   number equals an exact binary fraction with denominator `<= 1024`;
//!   everything else stays unresolved rather than approximated.

use er_content::m6_catalog::{
    CatalogBehaviorUnit, CatalogEffectKind, CatalogOperand, CatalogResolution, CatalogTargetKind,
};
use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2, ValueNodeId, ValueNodeV2};
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2, SelectorArenaV2, SelectorNodeIdV2,
    SelectorNodeV2,
};
use er_mechanics::{HookBindingV2, MechanicHookV2, ProgramRange};
use er_types::BehaviorUnitKind;

use crate::m6::routine::{MappingFamily, MappingRuleId, RoutineCompileError, RoutineProgramSpec};

/// Rule-schema version for every `Moves` mapping rule emitted this wave.
pub const MOVES_RULE_VERSION: u16 = 1;

/// Stable ordinals. Never renumber; add new schemas at fresh ordinals.
pub const HIGH_CRIT_RULE_ORDINAL: u32 = 1;
pub const CRIT_ONLY_RULE_ORDINAL: u32 = 2;
pub const STATUS_EFFECT_RULE_ORDINAL: u32 = 10;
pub const STAT_STAGE_CHANGE_RULE_ORDINAL: u32 = 11;
pub const MULTI_HIT_FIXED_RULE_ORDINAL: u32 = 20;
pub const FIXED_DAMAGE_RULE_ORDINAL: u32 = 21;
pub const LEVEL_DAMAGE_RULE_ORDINAL: u32 = 22;
pub const USER_HP_DAMAGE_RULE_ORDINAL: u32 = 23;
pub const RECOIL_RULE_ORDINAL: u32 = 24;
pub const DRAIN_ON_HIT_RULE_ORDINAL: u32 = 25;

/// Largest exact-ratio denominator admitted for JS-number operands.
const MAX_RATIO_DENOMINATOR_POWER_OF_TWO: u32 = 10;

/// The four M6B move tasks this family partitions coverage over.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MoveRoutineTask {
    IntrinsicMetadata,
    StatusStatStage,
    MultiHitRecoilDrainFixedDamage,
    TargetingSpreadPriorityAccuracy,
}

/// Deterministic coverage row for one recognized implementation class.
///
/// Site counts are exact against the frozen M6 semantic catalog so
/// integration tests can prove closure without re-deriving shapes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MoveRoutineClassCoverage {
    pub implementation_class: &'static str,
    pub task: MoveRoutineTask,
    /// `Some` once the class has at least one admitted operand schema.
    pub compiled_rule_ordinal: Option<u32>,
    /// Sites in the frozen catalog admitted by this wave's schemas.
    pub compiled_sites: u32,
    /// Recognized sites left unresolved, with [`Self::deferred_reason`].
    pub deferred_sites: u32,
    pub deferred_reason: Option<&'static str>,
}

/// Exact site counts against `rust/fixtures/m6/semantic-catalog-v1.json`.
pub const MOVE_CLASS_COVERAGE: &[MoveRoutineClassCoverage] = &[
    MoveRoutineClassCoverage {
        implementation_class: "HighCritAttr",
        task: MoveRoutineTask::IntrinsicMetadata,
        compiled_rule_ordinal: Some(HIGH_CRIT_RULE_ORDINAL),
        compiled_sites: 25,
        deferred_sites: 0,
        deferred_reason: None,
    },
    MoveRoutineClassCoverage {
        implementation_class: "CritOnlyAttr",
        task: MoveRoutineTask::IntrinsicMetadata,
        compiled_rule_ordinal: Some(CRIT_ONLY_RULE_ORDINAL),
        compiled_sites: 6,
        deferred_sites: 0,
        deferred_reason: None,
    },
    MoveRoutineClassCoverage {
        implementation_class: "MovePowerMultiplierAttr",
        task: MoveRoutineTask::IntrinsicMetadata,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 34,
        deferred_reason: Some("CALLBACK_OPERAND"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "StatusEffectAttr",
        task: MoveRoutineTask::StatusStatStage,
        compiled_rule_ordinal: Some(STATUS_EFFECT_RULE_ORDINAL),
        compiled_sites: 84,
        deferred_sites: 0,
        deferred_reason: None,
    },
    MoveRoutineClassCoverage {
        implementation_class: "StatStageChangeAttr",
        task: MoveRoutineTask::StatusStatStage,
        compiled_rule_ordinal: Some(STAT_STAGE_CHANGE_RULE_ORDINAL),
        compiled_sites: 160,
        deferred_sites: 21,
        deferred_reason: Some("ATTRIBUTE_OPTIONS_OR_STAGE_SHAPE_UNSUPPORTED"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "ConfuseAttr",
        task: MoveRoutineTask::StatusStatStage,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 18,
        deferred_reason: Some("SECONDARY_CHANCE_GATE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "FlinchAttr",
        task: MoveRoutineTask::StatusStatStage,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 33,
        deferred_reason: Some("SECONDARY_CHANCE_GATE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "HealAttr",
        task: MoveRoutineTask::StatusStatStage,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 11,
        deferred_reason: Some("NO_RATIO_HEAL_OPERATION"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "MultiHitAttr",
        task: MoveRoutineTask::MultiHitRecoilDrainFixedDamage,
        compiled_rule_ordinal: Some(MULTI_HIT_FIXED_RULE_ORDINAL),
        compiled_sites: 17,
        deferred_sites: 16,
        deferred_reason: Some("RNG_HIT_COUNT_GAP_OR_SPECIAL_FORMULA"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "FixedDamageAttr",
        task: MoveRoutineTask::MultiHitRecoilDrainFixedDamage,
        compiled_rule_ordinal: Some(FIXED_DAMAGE_RULE_ORDINAL),
        compiled_sites: 2,
        deferred_sites: 0,
        deferred_reason: None,
    },
    MoveRoutineClassCoverage {
        implementation_class: "LevelDamageAttr",
        task: MoveRoutineTask::MultiHitRecoilDrainFixedDamage,
        compiled_rule_ordinal: Some(LEVEL_DAMAGE_RULE_ORDINAL),
        compiled_sites: 2,
        deferred_sites: 0,
        deferred_reason: None,
    },
    MoveRoutineClassCoverage {
        implementation_class: "UserHpDamageAttr",
        task: MoveRoutineTask::MultiHitRecoilDrainFixedDamage,
        compiled_rule_ordinal: Some(USER_HP_DAMAGE_RULE_ORDINAL),
        compiled_sites: 1,
        deferred_sites: 0,
        deferred_reason: None,
    },
    MoveRoutineClassCoverage {
        implementation_class: "RecoilAttr",
        task: MoveRoutineTask::MultiHitRecoilDrainFixedDamage,
        compiled_rule_ordinal: Some(RECOIL_RULE_ORDINAL),
        compiled_sites: 6,
        deferred_sites: 8,
        deferred_reason: Some("NON_EXACT_RATIO_OR_HP_BASED"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "HitHealAttr",
        task: MoveRoutineTask::MultiHitRecoilDrainFixedDamage,
        compiled_rule_ordinal: Some(DRAIN_ON_HIT_RULE_ORDINAL),
        compiled_sites: 12,
        deferred_sites: 2,
        deferred_reason: Some("HEAL_STAT_OR_RATIO_VARIANT"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "AlwaysHitMinimizeAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 9,
        deferred_reason: Some("CONDITION_PREDICATE_UNREPRESENTABLE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "OneHitKOAccuracyAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 3,
        deferred_reason: Some("VALUE_FORMULA_UNREPRESENTABLE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "SheerColdAccuracyAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 1,
        deferred_reason: Some("VALUE_FORMULA_UNREPRESENTABLE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "BlizzardAccuracyAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 1,
        deferred_reason: Some("CONDITION_PREDICATE_UNREPRESENTABLE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "ThunderAccuracyAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 2,
        deferred_reason: Some("CONDITION_PREDICATE_UNREPRESENTABLE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "StormAccuracyAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 3,
        deferred_reason: Some("CONDITION_PREDICATE_UNREPRESENTABLE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "ToxicAccuracyAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 1,
        deferred_reason: Some("CONDITION_PREDICATE_UNREPRESENTABLE"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "IncrementMovePriorityAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 2,
        deferred_reason: Some("CALLBACK_OPERAND"),
    },
    MoveRoutineClassCoverage {
        implementation_class: "VariableTargetAttr",
        task: MoveRoutineTask::TargetingSpreadPriorityAccuracy,
        compiled_rule_ordinal: None,
        compiled_sites: 0,
        deferred_sites: 2,
        deferred_reason: Some("CALLBACK_OPERAND"),
    },
];

/// Deterministic recognized-class list for integration coverage tests.
pub fn move_class_coverage() -> &'static [MoveRoutineClassCoverage] {
    MOVE_CLASS_COVERAGE
}

/// Deterministic recognized-class count for integration coverage tests.
pub fn move_recognized_class_count() -> usize {
    MOVE_CLASS_COVERAGE.len()
}

/// Total sites the `Moves` family compiles this wave.
pub fn move_compiled_site_total() -> u32 {
    MOVE_CLASS_COVERAGE
        .iter()
        .map(|coverage| coverage.compiled_sites)
        .sum()
}

/// Total recognized sites the family leaves unresolved this wave.
pub fn move_deferred_site_total() -> u32 {
    MOVE_CLASS_COVERAGE
        .iter()
        .map(|coverage| coverage.deferred_sites)
        .sum()
}

/// Maps one MOVE-source behavior unit into a validated routine spec.
///
/// `Ok(None)` means the family does not own the unit (unrecognized class,
/// unsupported operand shape, callback-bearing options, or an intrinsic
/// identity admission owned by the central pipeline).
pub fn map_moves_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    // Intrinsic identity admissions carry no operands and no operation;
    // they stay central-pipeline admissions, never routine programs.
    if unit.id.unit_kind != BehaviorUnitKind::MoveAttribute {
        return Ok(None);
    }
    let mapped = match owned_class(unit) {
        Some("HighCritAttr") => high_crit(unit).map(Some),
        Some("CritOnlyAttr") => crit_only(unit).map(Some),
        Some("StatusEffectAttr") => status_effect(unit).map(Some),
        Some("StatStageChangeAttr") => stat_stage_change(unit),
        Some("MultiHitAttr") => multi_hit_fixed(unit),
        Some("FixedDamageAttr") => fixed_damage(unit),
        Some("LevelDamageAttr") => level_damage(unit).map(Some),
        Some("UserHpDamageAttr") => user_hp_damage(unit).map(Some),
        Some("RecoilAttr") => recoil(unit),
        Some("HitHealAttr") => hit_heal(unit),
        _ => Ok(None),
    };
    match mapped {
        Err(RoutineCompileError::MissingOperand { .. }) => Ok(None),
        Err(RoutineCompileError::OperandKind {
            index: 0,
            expected: "operand value representable in the closed mechanics IR",
        }) => Ok(None),
        result => result,
    }
}

/// Returns the class name when every static evidence dimension matches the
/// frozen extraction shape for MOVE_ATTRIBUTE attachments.
fn owned_class(unit: &CatalogBehaviorUnit) -> Option<&str> {
    let implementation = unit.semantic.implementation.as_ref()?;
    if !matches!(
        unit.semantic.resolution,
        CatalogResolution::BespokeGap | CatalogResolution::ResolvedOperands
    ) || !matches!(unit.semantic.target.kind, CatalogTargetKind::SourceDefined)
        || !matches!(
            unit.semantic.condition,
            None | Some(CatalogOperand::Always {})
        )
    {
        return None;
    }
    let name = implementation.name.as_str();
    if implementation.family != "MOVE_ATTRIBUTE"
        || unit.semantic.effect.attribute.as_deref() != Some(name)
    {
        return None;
    }
    let (hook_evidence, alternate_hook, effect_kind, alternate_effect) = match name {
        "HighCritAttr" | "CritOnlyAttr" => (
            "CRITICAL_QUERY",
            None,
            CatalogEffectKind::ModifyStatOrStage,
            Some(CatalogEffectKind::UnresolvedEffect),
        ),
        "StatusEffectAttr" => (
            "STAT_QUERY_OR_CHANGE",
            None,
            CatalogEffectKind::ApplyOrBlockStatus,
            None,
        ),
        "StatStageChangeAttr" => (
            "STAT_QUERY_OR_CHANGE",
            None,
            CatalogEffectKind::ModifyStatOrStage,
            None,
        ),
        "MultiHitAttr" => (
            "HIT_COUNT_QUERY",
            Some("UNRESOLVED_HOOK"),
            CatalogEffectKind::ModifyOrApplyDamage,
            Some(CatalogEffectKind::UnresolvedEffect),
        ),
        "FixedDamageAttr" | "LevelDamageAttr" | "UserHpDamageAttr" => (
            "DAMAGE_QUERY",
            None,
            CatalogEffectKind::ModifyOrApplyDamage,
            None,
        ),
        "RecoilAttr" => (
            "AFTER_DAMAGE",
            Some("UNRESOLVED_HOOK"),
            CatalogEffectKind::ModifyOrApplyDamage,
            Some(CatalogEffectKind::UnresolvedEffect),
        ),
        "HitHealAttr" => (
            "AFTER_DAMAGE",
            Some("UNRESOLVED_HOOK"),
            CatalogEffectKind::Heal,
            None,
        ),
        _ => return None,
    };
    if (unit.semantic.hook.0 != hook_evidence
        && alternate_hook != Some(unit.semantic.hook.0.as_str()))
        || (unit.semantic.effect.kind != effect_kind
            && alternate_effect != Some(unit.semantic.effect.kind))
    {
        return None;
    }
    Some(name)
}

fn exact_operands(unit: &CatalogBehaviorUnit, expected: usize) -> bool {
    unit.semantic.operands.len() == expected
}

fn constant_values(value: i64) -> ValueArenaV2 {
    ValueArenaV2(vec![ValueNodeV2::Constant { value }])
}

fn query_spec(
    rule_ordinal: u32,
    unit: &CatalogBehaviorUnit,
    hook: MechanicHookV2,
    stage: QueryModifierStageV2,
    modifier: QueryModifierV2,
    values: ValueArenaV2,
) -> Result<RoutineProgramSpec, RoutineCompileError> {
    RoutineProgramSpec::single_query(
        rule(rule_ordinal),
        unit.id.clone(),
        hook,
        stage,
        modifier,
        values,
    )
}

/// Target scope a trigger binding's selector root resolves to.
enum TriggerSelector {
    User,
    Target,
}

fn trigger_spec(
    rule_ordinal: u32,
    unit: &CatalogBehaviorUnit,
    hook: MechanicHookV2,
    selector: TriggerSelector,
    operations: Vec<MechanicOperationV2>,
) -> Result<RoutineProgramSpec, RoutineCompileError> {
    if operations.is_empty() || operations.iter().any(MechanicOperationV2::is_query) {
        return Err(RoutineCompileError::TriggerQueryMismatch);
    }
    let length =
        u16::try_from(operations.len()).map_err(|_| RoutineCompileError::ResourceOverflow {
            resource: "operations",
            value: operations.len(),
        })?;
    let selectors = match selector {
        TriggerSelector::User => SelectorArenaV2(vec![SelectorNodeV2::Actor]),
        TriggerSelector::Target => SelectorArenaV2(vec![SelectorNodeV2::Target]),
    };
    Ok(RoutineProgramSpec {
        rule: rule(rule_ordinal),
        behavior_unit: unit.id.clone(),
        bindings: vec![HookBindingV2 {
            hook,
            authored_priority: 0,
            binding_ordinal: 0,
            behavior_unit: unit.id.clone(),
            condition_root: None,
            selector_root: Some(SelectorNodeIdV2::ZERO),
            operations: ProgramRange { start: 0, length },
        }],
        conditions: ConditionArenaV2::default(),
        selectors,
        values: ValueArenaV2::default(),
        operations,
        scheduled_events: Vec::new(),
        rng_sites: Vec::new(),
        spawned_instances: 0,
        presentation_cues: 0,
        selected_targets: 0,
    })
}

fn rule(ordinal: u32) -> MappingRuleId {
    MappingRuleId {
        family: MappingFamily::Moves,
        ordinal,
        version: MOVES_RULE_VERSION,
    }
}

// --- Task 1: ordinary intrinsic damage/type/category/power/crit metadata ---

/// HighCritAttr(): crit-stage accumulator `+1`.
fn high_crit(unit: &CatalogBehaviorUnit) -> Result<RoutineProgramSpec, RoutineCompileError> {
    if !exact_operands(unit, 0) {
        return Err(unowned_shape());
    }
    query_spec(
        HIGH_CRIT_RULE_ORDINAL,
        unit,
        MechanicHookV2::CriticalQuery,
        QueryModifierStageV2::EarlyAdd,
        QueryModifierV2::Add {
            value: ValueNodeId(0),
        },
        constant_values(1),
    )
}

/// CritOnlyAttr(): guaranteed critical hit.
fn crit_only(unit: &CatalogBehaviorUnit) -> Result<RoutineProgramSpec, RoutineCompileError> {
    if !exact_operands(unit, 0) {
        return Err(unowned_shape());
    }
    query_spec(
        CRIT_ONLY_RULE_ORDINAL,
        unit,
        MechanicHookV2::CriticalQuery,
        QueryModifierStageV2::FinalOverride,
        QueryModifierV2::Set {
            value: ValueNodeId(0),
        },
        constant_values(1),
    )
}

// --- Task 2: status/stat-stage attributes ---

const STATUS_EFFECT_MEMBERS: [&str; 6] =
    ["BURN", "PARALYSIS", "POISON", "SLEEP", "FREEZE", "TOXIC"];

const STAT_MEMBERS: [&str; 7] = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"];

/// StatusEffectAttr(effect): major-status application after the hit.
fn status_effect(unit: &CatalogBehaviorUnit) -> Result<RoutineProgramSpec, RoutineCompileError> {
    if !exact_operands(unit, 1)
        || !STATUS_EFFECT_MEMBERS.contains(&symbol_member(unit, 0, "StatusEffect").unwrap_or(""))
    {
        return Err(unowned_shape());
    }
    trigger_spec(
        STATUS_EFFECT_RULE_ORDINAL,
        unit,
        MechanicHookV2::AfterHit,
        TriggerSelector::Target,
        vec![MechanicOperationV2::StatusApply],
    )
}

/// StatStageChangeAttr(stats, stages[, selfTarget]): staged stat changes.
///
/// Options objects (`condition`, `firstTargetOnly`, `lastHitOnly`,
/// `effectChanceOverride`, `trigger`) have no closed IR predicate or chance
/// vocabulary and stay unresolved.
fn stat_stage_change(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    let operand_count = unit.semantic.operands.len();
    if !(2..=3).contains(&operand_count) {
        return Ok(None);
    }
    if operand_count == 3 && !matches!(unit.semantic.operands[2], CatalogOperand::Boolean { .. }) {
        return Ok(None);
    }
    let stats = match &unit.semantic.operands[0] {
        CatalogOperand::Array { values } if !values.is_empty() => values,
        _ => return Ok(None),
    };
    for value in stats {
        let CatalogOperand::SymbolProvenance { owner, member, .. } = value else {
            return Ok(None);
        };
        if owner != "Stat" || !STAT_MEMBERS.contains(&member.as_str()) {
            return Ok(None);
        }
    }
    let delta = match &unit.semantic.operands[1] {
        CatalogOperand::SafeInteger { value } => *value,
        _ => return Ok(None),
    };
    let stat_stage = i8::try_from(delta)
        .ok()
        .filter(|delta| (-6..=6).contains(delta))
        .ok_or(RoutineCompileError::OperandKind {
            index: 1,
            expected: "SAFE_INTEGER within [-6, 6]",
        })?;
    let self_target = match &unit.semantic.operands.get(2) {
        Some(CatalogOperand::Boolean { value }) => *value,
        _ => false,
    };
    let operations = (0..stats.len())
        .map(|_| MechanicOperationV2::StatStageChange { stat_stage })
        .collect();
    trigger_spec(
        STAT_STAGE_CHANGE_RULE_ORDINAL,
        unit,
        MechanicHookV2::AfterHit,
        if self_target {
            TriggerSelector::User
        } else {
            TriggerSelector::Target
        },
        operations,
    )
    .map(Some)
}

// --- Task 3: multi-hit/recoil/drain/fixed damage ---

/// MultiHitAttr(TWO|THREE|TEN): fixed intrinsic hit counts at base override.
///
/// The default `TWO_TO_FIVE` type draws RNG and stays an unresolved bespoke
/// gap; `BEAT_UP` computes hits from the party and stays unresolved too.
fn multi_hit_fixed(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !exact_operands(unit, 1) {
        return Ok(None);
    }
    let hits: i64 = match symbol_member(unit, 0, "MultiHitType").unwrap_or("") {
        "TWO" => 2,
        "THREE" => 3,
        "TEN" => 10,
        _ => return Ok(None),
    };
    query_spec(
        MULTI_HIT_FIXED_RULE_ORDINAL,
        unit,
        MechanicHookV2::HitCountQuery,
        QueryModifierStageV2::BaseOverride,
        QueryModifierV2::Set {
            value: ValueNodeId(0),
        },
        constant_values(hits),
    )
    .map(Some)
}

/// FixedDamageAttr(damage): absolute damage override.
fn fixed_damage(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !exact_operands(unit, 1) {
        return Ok(None);
    }
    let damage = match &unit.semantic.operands[0] {
        CatalogOperand::SafeInteger { value } if *value >= 0 => *value,
        _ => return Ok(None),
    };
    damage_override(FIXED_DAMAGE_RULE_ORDINAL, unit, constant_values(damage)).map(Some)
}

/// LevelDamageAttr(): damage override equal to the user's level.
fn level_damage(unit: &CatalogBehaviorUnit) -> Result<RoutineProgramSpec, RoutineCompileError> {
    if !exact_operands(unit, 0) {
        return Err(unowned_shape());
    }
    damage_override(
        LEVEL_DAMAGE_RULE_ORDINAL,
        unit,
        ValueArenaV2(vec![ValueNodeV2::Level]),
    )
}

/// UserHpDamageAttr(): damage override equal to the user's current HP.
fn user_hp_damage(unit: &CatalogBehaviorUnit) -> Result<RoutineProgramSpec, RoutineCompileError> {
    if !exact_operands(unit, 0) {
        return Err(unowned_shape());
    }
    damage_override(
        USER_HP_DAMAGE_RULE_ORDINAL,
        unit,
        ValueArenaV2(vec![ValueNodeV2::HpCurrent]),
    )
}

fn damage_override(
    rule_ordinal: u32,
    unit: &CatalogBehaviorUnit,
    values: ValueArenaV2,
) -> Result<RoutineProgramSpec, RoutineCompileError> {
    query_spec(
        rule_ordinal,
        unit,
        MechanicHookV2::DamageQuery,
        QueryModifierStageV2::FinalOverride,
        QueryModifierV2::Set {
            value: ValueNodeId(0),
        },
        values,
    )
}

/// RecoilAttr([useHp, ratio[, unblockable]]): recoil fraction of damage dealt.
///
/// Only HP-fraction-free, blockable recoil with an exact binary ratio is
/// admitted; `useHp` recoil bases the fraction on maximum HP and has no
/// closed operation this wave.
fn recoil(unit: &CatalogBehaviorUnit) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    let (use_hp, ratio, unblockable) = match unit.semantic.operands.as_slice() {
        [] => (false, 0.25, false),
        [first, second] => match (first, js_number_bits(second)) {
            (CatalogOperand::Boolean { value }, Some(ratio)) => (*value, ratio, false),
            _ => return Ok(None),
        },
        [first, second, third] => match (first, js_number_bits(second), third) {
            (
                CatalogOperand::Boolean { value: use_hp },
                Some(ratio),
                CatalogOperand::Boolean { value: unblockable },
            ) => (*use_hp, ratio, *unblockable),
            _ => return Ok(None),
        },
        _ => return Ok(None),
    };
    if use_hp || unblockable {
        return Ok(None);
    }
    let (numerator, denominator) = exact_ratio(ratio).ok_or_else(unowned_shape)?;
    trigger_spec(
        RECOIL_RULE_ORDINAL,
        unit,
        MechanicHookV2::AfterDamage,
        TriggerSelector::User,
        vec![MechanicOperationV2::RecoilFraction {
            numerator,
            denominator,
        }],
    )
    .map(Some)
}

/// HitHealAttr([ratio]): drain healing as a fraction of damage dealt.
///
/// The heal-stat variant heals off an effective stat instead of dealt
/// damage and stays unresolved.
fn hit_heal(unit: &CatalogBehaviorUnit) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    let ratio = match unit.semantic.operands.as_slice() {
        [] => 0.5,
        [only] => match only {
            CatalogOperand::JsNumberBits { .. } => {
                js_number_bits(only).ok_or_else(unowned_shape)?
            }
            CatalogOperand::SafeInteger { value } if *value > 0 => *value as f64,
            _ => return Ok(None),
        },
        _ => return Ok(None),
    };
    let (numerator, denominator) = exact_ratio(ratio).ok_or_else(unowned_shape)?;
    trigger_spec(
        DRAIN_ON_HIT_RULE_ORDINAL,
        unit,
        MechanicHookV2::AfterDamage,
        TriggerSelector::User,
        vec![MechanicOperationV2::DrainFraction {
            numerator,
            denominator,
        }],
    )
    .map(Some)
}

// --- operand decoding helpers ---

/// Typed error for an owned class whose concrete operands contradict the
/// closed IR vocabulary (never used for unrecognized units, which are `None`).
fn unowned_shape() -> RoutineCompileError {
    RoutineCompileError::OperandKind {
        index: 0,
        expected: "operand value representable in the closed mechanics IR",
    }
}

fn symbol_member<'a>(
    unit: &'a CatalogBehaviorUnit,
    index: usize,
    owner: &'a str,
) -> Option<&'a str> {
    match unit.semantic.operands.get(index)? {
        CatalogOperand::SymbolProvenance {
            owner: symbol_owner,
            member,
            ..
        } if symbol_owner == owner => Some(member.as_str()),
        _ => None,
    }
}

/// Decodes a `JS_NUMBER_BITS` operand into a finite number.
fn js_number_bits(operand: &CatalogOperand) -> Option<f64> {
    let CatalogOperand::JsNumberBits { bits } = operand else {
        return None;
    };
    if bits.len() != 16 {
        return None;
    }
    let raw = u64::from_str_radix(bits, 16).ok()?;
    let value = f64::from_bits(raw);
    value.is_finite().then_some(value)
}

/// Admits a positive number only as an exact binary fraction with denominator
/// `<= 1024`, reduced to lowest terms. Approximations never pass.
fn exact_ratio(value: f64) -> Option<(u32, u32)> {
    if !(value > 0.0 && value <= 1.0) {
        return None;
    }
    for power in 0..=MAX_RATIO_DENOMINATOR_POWER_OF_TWO {
        let denominator = 1u64 << power;
        let scaled = value * denominator as f64;
        if scaled < 1.0 || scaled.fract() != 0.0 {
            continue;
        }
        let numerator = scaled as u64;
        let divisor = gcd(numerator, denominator);
        return Some(((numerator / divisor) as u32, (denominator / divisor) as u32));
    }
    None
}

fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        (left, right) = (right, left % right);
    }
    left
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_content::m6_catalog::{
        CatalogEffect, CatalogProvenance, CatalogSemantic, CatalogTarget, HookEvidence,
        ImplementationClassEvidence, SourceLocation,
    };
    use er_types::m6::{BehaviorUnitOrdinal, ProvenanceHash};
    use er_types::mechanics::MechanicsProgramId;
    use er_types::{BehaviorSourceId, BehaviorUnitId, SafeU53};

    fn attribute_unit(
        class: &str,
        hook: &str,
        effect_kind: CatalogEffectKind,
        operands: Vec<CatalogOperand>,
    ) -> CatalogBehaviorUnit {
        CatalogBehaviorUnit {
            id: BehaviorUnitId {
                source: BehaviorSourceId::Move {
                    numeric_id: SafeU53::ZERO,
                },
                unit_kind: BehaviorUnitKind::MoveAttribute,
                ordinal: BehaviorUnitOrdinal::default(),
                provenance_hash: ProvenanceHash::parse(
                    "850e45b88e66fd215c32701204a2c5785ed938a508f2285e1a813254fa86279f",
                )
                .expect("fixture provenance hash is valid"),
            },
            provenance: CatalogProvenance {
                path: "src/data/moves/move.ts".into(),
                line: 0,
                column: 0,
                attribute: Some(class.into()),
                method: Some("attr".into()),
            },
            semantic: CatalogSemantic {
                condition: Some(CatalogOperand::Always {}),
                effect: CatalogEffect {
                    kind: effect_kind,
                    attribute: Some(class.into()),
                    call: None,
                },
                hook: HookEvidence(hook.into()),
                implementation: Some(ImplementationClassEvidence {
                    is_abstract: false,
                    base: Some("MoveAttr".into()),
                    family: "MOVE_ATTRIBUTE".into(),
                    methods: vec!["apply".into()],
                    name: class.into(),
                    source: SourceLocation {
                        path: "src/data/moves/move.ts".into(),
                        line: 0,
                        column: 0,
                    },
                }),
                operands,
                resolution: CatalogResolution::BespokeGap,
                target: CatalogTarget {
                    kind: CatalogTargetKind::SourceDefined,
                },
            },
        }
    }

    #[test]
    fn high_crit_compiles_critical_rate_add() {
        let unit = attribute_unit(
            "HighCritAttr",
            "CRITICAL_QUERY",
            CatalogEffectKind::UnresolvedEffect,
            vec![],
        );
        let spec = map_moves_unit(&unit)
            .expect("move fixture maps without error")
            .expect("move fixture has a compiled specification");
        assert_eq!(spec.rule.ordinal, HIGH_CRIT_RULE_ORDINAL);
        assert!(spec.bindings[0].hook.is_query());
        assert_eq!(
            spec.operations,
            vec![MechanicOperationV2::Query {
                query: MechanicHookV2::CriticalQuery
                    .query()
                    .expect("critical hook is a query"),
                stage: QueryModifierStageV2::EarlyAdd,
                modifier: QueryModifierV2::Add {
                    value: ValueNodeId(0)
                },
            }]
        );
        spec.build(MechanicsProgramId::try_from_u64(1).expect("fixture program id is valid"))
            .expect("move specification builds a valid program");
    }

    #[test]
    fn foreign_class_is_unowned() {
        let unit = attribute_unit(
            "SomeOtherAttr",
            "CRITICAL_QUERY",
            CatalogEffectKind::UnresolvedEffect,
            vec![],
        );
        assert!(
            map_moves_unit(&unit)
                .expect("unowned move fixture maps without error")
                .is_none()
        );
    }

    #[test]
    fn wrong_hook_evidence_is_unowned() {
        let unit = attribute_unit(
            "HighCritAttr",
            "ACCURACY_QUERY",
            CatalogEffectKind::UnresolvedEffect,
            vec![],
        );
        assert!(
            map_moves_unit(&unit)
                .expect("unowned move fixture maps without error")
                .is_none()
        );
    }

    #[test]
    fn stat_stage_change_targets_user_when_self_targeted() {
        let unit = attribute_unit(
            "StatStageChangeAttr",
            "STAT_QUERY_OR_CHANGE",
            CatalogEffectKind::ModifyStatOrStage,
            vec![
                CatalogOperand::Array {
                    values: vec![stat_symbol("ATK"), stat_symbol("DEF")],
                },
                CatalogOperand::SafeInteger { value: 2 },
                CatalogOperand::Boolean { value: true },
            ],
        );
        let spec = map_moves_unit(&unit)
            .expect("move fixture maps without error")
            .expect("move fixture has a compiled specification");
        assert_eq!(spec.operations.len(), 2);
        assert_eq!(spec.selectors, SelectorArenaV2(vec![SelectorNodeV2::Actor]));
        spec.build(MechanicsProgramId::try_from_u64(2).expect("fixture program id is valid"))
            .expect("move specification builds a valid program");
    }

    #[test]
    fn out_of_range_stage_delta_is_typed_error() {
        let unit = attribute_unit(
            "StatStageChangeAttr",
            "STAT_QUERY_OR_CHANGE",
            CatalogEffectKind::ModifyStatOrStage,
            vec![
                CatalogOperand::Array {
                    values: vec![stat_symbol("SPD")],
                },
                CatalogOperand::SafeInteger { value: 7 },
            ],
        );
        assert!(matches!(
            map_moves_unit(&unit),
            Err(RoutineCompileError::OperandKind { index: 1, .. })
        ));
    }

    #[test]
    fn multi_hit_random_type_stays_unresolved() {
        let unit = attribute_unit(
            "MultiHitAttr",
            "UNRESOLVED_HOOK",
            CatalogEffectKind::UnresolvedEffect,
            vec![],
        );
        assert!(
            map_moves_unit(&unit)
                .expect("unowned move fixture maps without error")
                .is_none()
        );
    }

    #[test]
    fn multi_hit_fixed_type_overrides_hit_count_base() {
        let unit = attribute_unit(
            "MultiHitAttr",
            "UNRESOLVED_HOOK",
            CatalogEffectKind::UnresolvedEffect,
            vec![symbol("MultiHitType", "TWO")],
        );
        let spec = map_moves_unit(&unit)
            .expect("move fixture maps without error")
            .expect("move fixture has a compiled specification");
        assert_eq!(spec.rule.ordinal, MULTI_HIT_FIXED_RULE_ORDINAL);
        spec.build(MechanicsProgramId::try_from_u64(3).expect("fixture program id is valid"))
            .expect("move specification builds a valid program");
    }

    #[test]
    fn recoil_default_fraction_is_one_quarter() {
        let unit = attribute_unit(
            "RecoilAttr",
            "UNRESOLVED_HOOK",
            CatalogEffectKind::UnresolvedEffect,
            vec![],
        );
        let spec = map_moves_unit(&unit)
            .expect("move fixture maps without error")
            .expect("move fixture has a compiled specification");
        assert_eq!(
            spec.operations,
            vec![MechanicOperationV2::RecoilFraction {
                numerator: 1,
                denominator: 4
            }]
        );
        spec.build(MechanicsProgramId::try_from_u64(4).expect("fixture program id is valid"))
            .expect("move specification builds a valid program");
    }

    #[test]
    fn approximate_ratio_stays_unresolved() {
        let unit = attribute_unit(
            "RecoilAttr",
            "UNRESOLVED_HOOK",
            CatalogEffectKind::UnresolvedEffect,
            vec![
                CatalogOperand::Boolean { value: false },
                CatalogOperand::JsNumberBits {
                    bits: "3fd51eb851eb851f".into(), // 0.33, not an exact binary fraction
                },
            ],
        );
        assert!(
            map_moves_unit(&unit)
                .expect("unowned move fixture maps without error")
                .is_none()
        );
    }

    #[test]
    fn hp_based_recoil_stays_unresolved() {
        let unit = attribute_unit(
            "RecoilAttr",
            "UNRESOLVED_HOOK",
            CatalogEffectKind::UnresolvedEffect,
            vec![
                CatalogOperand::Boolean { value: true },
                CatalogOperand::JsNumberBits {
                    bits: "3fe0000000000000".into(), // 0.5
                },
            ],
        );
        assert!(
            map_moves_unit(&unit)
                .expect("unowned move fixture maps without error")
                .is_none()
        );
    }

    #[test]
    fn drain_default_fraction_is_one_half() {
        let unit = attribute_unit(
            "HitHealAttr",
            "UNRESOLVED_HOOK",
            CatalogEffectKind::Heal,
            vec![],
        );
        let spec = map_moves_unit(&unit)
            .expect("move fixture maps without error")
            .expect("move fixture has a compiled specification");
        assert_eq!(
            spec.operations,
            vec![MechanicOperationV2::DrainFraction {
                numerator: 1,
                denominator: 2
            }]
        );
        spec.build(MechanicsProgramId::try_from_u64(5).expect("fixture program id is valid"))
            .expect("move specification builds a valid program");
    }

    #[test]
    fn heal_stat_variant_stays_unresolved() {
        let unit = attribute_unit(
            "HitHealAttr",
            "UNRESOLVED_HOOK",
            CatalogEffectKind::Heal,
            vec![CatalogOperand::Null {}, symbol("Stat", "ATK")],
        );
        assert!(
            map_moves_unit(&unit)
                .expect("unowned move fixture maps without error")
                .is_none()
        );
    }

    #[test]
    fn fixed_damage_and_status_compile_closed_operations() {
        let fixed = attribute_unit(
            "FixedDamageAttr",
            "DAMAGE_QUERY",
            CatalogEffectKind::ModifyOrApplyDamage,
            vec![CatalogOperand::SafeInteger { value: 40 }],
        );
        let spec = map_moves_unit(&fixed)
            .expect("move fixture maps without error")
            .expect("move fixture has a compiled specification");
        spec.build(MechanicsProgramId::try_from_u64(6).expect("fixture program id is valid"))
            .expect("move specification builds a valid program");

        let status = attribute_unit(
            "StatusEffectAttr",
            "STAT_QUERY_OR_CHANGE",
            CatalogEffectKind::ApplyOrBlockStatus,
            vec![symbol("StatusEffect", "BURN")],
        );
        let spec = map_moves_unit(&status)
            .expect("move fixture maps without error")
            .expect("move fixture has a compiled specification");
        assert_eq!(spec.operations, vec![MechanicOperationV2::StatusApply]);
        spec.build(MechanicsProgramId::try_from_u64(7).expect("fixture program id is valid"))
            .expect("move specification builds a valid program");
    }

    #[test]
    fn coverage_totals_close_against_frozen_fixture() {
        assert_eq!(move_recognized_class_count(), MOVE_CLASS_COVERAGE.len());
        assert_eq!(move_compiled_site_total(), 315);
        assert_eq!(move_deferred_site_total(), 167);
    }

    fn symbol(owner: &str, member: &str) -> CatalogOperand {
        CatalogOperand::SymbolProvenance {
            owner: owner.into(),
            member: member.into(),
            provenance_hash: ProvenanceHash::parse(
                "7c5c17ce935bb6dbb3c763cb451d5d7f57fd88d9480867e419279fe1c93d9da2",
            )
            .expect("fixture provenance hash is valid"),
            source: SourceLocation {
                path: "src/data/moves/move.ts".into(),
                line: 0,
                column: 0,
            },
        }
    }

    fn stat_symbol(member: &str) -> CatalogOperand {
        symbol("Stat", member)
    }
}
