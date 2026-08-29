//! M6B status-field routine mapping.
//!
//! Maps exact closed fixture schemas for major statuses, volatile/battler
//! tags, weather, terrain, arena/side tags (hazards and screens), and
//! positional tags onto typed [`RoutineProgramSpec`] programs built through
//! the shared M6B contract (`crate::m6::routine`).
//!
//! Admission is fail-closed: [`map_status_field_unit`] returns `Ok(Some)`
//! only after the exact behavior-unit kind, implementation class, effect
//! family, hook evidence, resolution class, and constructor operand shape all
//! match a frozen schema below. Anything else yields `Ok(None)`; the family
//! never manufactures neutral operations and never allocates final program
//! IDs. Every unit the family owns but cannot compile is reported by
//! [`status_field_coverage`], so no tag or field state is silently omitted.
//!
//! Frozen fixture facts this module encodes (semantic-catalog-v1 /
//! raw-source-catalog-v2 at oracle sha 3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7):
//! member counts of 8 major statuses, 13 weather kinds, 6 terrains,
//! 42 arena tags, 123 battler tags, and 3 positional tags; the tag base
//! classes extracted under mechanic-class families ARENA_TAG /
//! BATTLER_TAG / POSITIONAL_TAG.

use er_content::m6_catalog::{
    CatalogBehaviorUnit, CatalogEffectKind, CatalogOperand, CatalogResolution,
};
use er_mechanics::MechanicHookV2;
use er_mechanics::selector_operation_v2::MechanicOperationV2;
use er_types::BehaviorUnitKind;
use serde::Serialize;

use crate::m6::routine::{
    MappingFamily, MappingRuleId, RoutineCompileError, RoutineProgramSpec, implementation_name,
    safe_integer_operand,
};

/// Version of every rule emitted by this module.
pub const STATUS_FIELD_RULE_VERSION: u16 = 1;

// Stable mapping-rule ordinals. These constants are frozen contract surface:
// integration tests and prepared-content digests depend on them never moving.
pub const RULE_STATUS_APPLY: u32 = 0;
pub const RULE_STATUS_CURE: u32 = 1;
pub const RULE_STATUS_COUNTER_SET: u32 = 2;
pub const RULE_VOLATILE_CREATE: u32 = 3;
pub const RULE_VOLATILE_REMOVE: u32 = 4;
pub const RULE_WEATHER_SET: u32 = 5;
pub const RULE_WEATHER_EXPIRE: u32 = 6;
pub const RULE_TERRAIN_SET: u32 = 7;
pub const RULE_SIDE_CONDITION_SET: u32 = 8;
pub const RULE_ARENA_TAG_APPLY: u32 = 9;
pub const RULE_BATTLER_TAG_APPLY: u32 = 10;
pub const RULE_POSITIONAL_TAG_APPLY: u32 = 11;

const fn rule(ordinal: u32) -> MappingRuleId {
    MappingRuleId {
        family: MappingFamily::StatusField,
        ordinal,
        version: STATUS_FIELD_RULE_VERSION,
    }
}

/// Closed member-count ceilings extracted from the frozen raw-source catalog.
pub const MAJOR_STATUS_MEMBER_COUNT: i64 = 8;
pub const WEATHER_MEMBER_COUNT: i64 = 13;
pub const TERRAIN_MEMBER_COUNT: i64 = 6;
pub const ARENA_TAG_MEMBER_COUNT: i64 = 42;
pub const BATTLER_TAG_MEMBER_COUNT: i64 = 123;
pub const POSITIONAL_TAG_MEMBER_COUNT: i64 = 3;

/// Closed field domains this family owns.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldDomain {
    MajorStatus,
    VolatileTag,
    Weather,
    Terrain,
    ArenaTag,
    PositionalTag,
}

/// One recognized implementation class from the frozen mechanic-class
/// inventory. Classes marked as abstract bases never admit a unit directly.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecognizedFieldClass {
    pub name: &'static str,
    pub domain: FieldDomain,
    pub abstract_base: bool,
    pub source_path: &'static str,
}

/// The exact recognized class table, in frozen catalog order
/// (ARENA_TAG then BATTLER_TAG then POSITIONAL_TAG families).
/// `PositionalTagManager` is manager infrastructure, not a field class, and
/// is deliberately excluded; it is still reported through coverage metadata
/// as an unrecognized implementation when encountered.
pub const RECOGNIZED_FIELD_CLASSES: &[RecognizedFieldClass] = &[
    RecognizedFieldClass {
        name: "ArenaTag",
        domain: FieldDomain::ArenaTag,
        abstract_base: true,
        source_path: "src/data/arena-tag.ts",
    },
    RecognizedFieldClass {
        name: "SerializableArenaTag",
        domain: FieldDomain::ArenaTag,
        abstract_base: false,
        source_path: "src/data/arena-tag.ts",
    },
    RecognizedFieldClass {
        name: "RoomArenaTag",
        domain: FieldDomain::ArenaTag,
        abstract_base: true,
        source_path: "src/data/arena-tag.ts",
    },
    RecognizedFieldClass {
        name: "BattlerTag",
        domain: FieldDomain::VolatileTag,
        abstract_base: false,
        source_path: "src/data/battler-tags.ts",
    },
    RecognizedFieldClass {
        name: "SerializableBattlerTag",
        domain: FieldDomain::VolatileTag,
        abstract_base: false,
        source_path: "src/data/battler-tags.ts",
    },
    RecognizedFieldClass {
        name: "AbilityBattlerTag",
        domain: FieldDomain::VolatileTag,
        abstract_base: false,
        source_path: "src/data/battler-tags.ts",
    },
    RecognizedFieldClass {
        name: "MoveRestrictionBattlerTag",
        domain: FieldDomain::VolatileTag,
        abstract_base: true,
        source_path: "src/data/battler-tags.ts",
    },
    RecognizedFieldClass {
        name: "PositionalTag",
        domain: FieldDomain::PositionalTag,
        abstract_base: true,
        source_path: "src/data/positional-tags/positional-tag.ts",
    },
    RecognizedFieldClass {
        name: "DelayedAttackTag",
        domain: FieldDomain::PositionalTag,
        abstract_base: false,
        source_path: "src/data/positional-tags/positional-tag.ts",
    },
    RecognizedFieldClass {
        name: "ElectrodynamicsPositionTag",
        domain: FieldDomain::PositionalTag,
        abstract_base: false,
        source_path: "src/data/positional-tags/positional-tag.ts",
    },
    RecognizedFieldClass {
        name: "WishTag",
        domain: FieldDomain::PositionalTag,
        abstract_base: false,
        source_path: "src/data/positional-tags/positional-tag.ts",
    },
];

/// Number of recognized classes in [`RECOGNIZED_FIELD_CLASSES`].
pub const RECOGNIZED_FIELD_CLASS_COUNT: usize = RECOGNIZED_FIELD_CLASSES.len();

fn recognized_class(name: &str) -> Option<&'static RecognizedFieldClass> {
    RECOGNIZED_FIELD_CLASSES
        .iter()
        .find(|class| class.name == name)
}

fn owned_domain(unit_kind: &BehaviorUnitKind) -> Option<FieldDomain> {
    match unit_kind {
        BehaviorUnitKind::StatusBehavior => Some(FieldDomain::MajorStatus),
        BehaviorUnitKind::BattlerTagBehavior => Some(FieldDomain::VolatileTag),
        BehaviorUnitKind::WeatherBehavior => Some(FieldDomain::Weather),
        BehaviorUnitKind::TerrainBehavior => Some(FieldDomain::Terrain),
        BehaviorUnitKind::ArenaTagBehavior => Some(FieldDomain::ArenaTag),
        BehaviorUnitKind::PositionalTagBehavior => Some(FieldDomain::PositionalTag),
        _ => None,
    }
}

/// True only when the unit's hook evidence names exactly `hook`.
fn hook_matches(unit: &CatalogBehaviorUnit, hook: MechanicHookV2) -> bool {
    let expected = match hook {
        MechanicHookV2::BeforeStatus => "BEFORE_STATUS",
        MechanicHookV2::AfterStatus => "AFTER_STATUS",
        MechanicHookV2::AfterHit => "AFTER_HIT",
        MechanicHookV2::WeatherChanged => "WEATHER_CHANGED",
        MechanicHookV2::WeatherLapse => "WEATHER_LAPSE",
        MechanicHookV2::TerrainChanged => "TERRAIN_CHANGED",
        MechanicHookV2::AfterMove => "AFTER_MOVE",
        MechanicHookV2::TurnEnd => "TURN_END",
        _ => return false,
    };
    unit.semantic.hook.0.as_str() == expected
}

/// Builds one single-trigger program spec after verifying the hook evidence
/// names exactly `hook`. Callers guard with [`hook_matches`] first, so a
/// mismatch here is an internal contract violation, not a rejection path.
fn trigger_spec(
    rule_id: MappingRuleId,
    unit: &CatalogBehaviorUnit,
    hook: MechanicHookV2,
    operation: MechanicOperationV2,
) -> Result<RoutineProgramSpec, RoutineCompileError> {
    debug_assert!(!operation.is_query());
    if !hook_matches(unit, hook) {
        return Err(RoutineCompileError::TriggerQueryMismatch);
    }
    RoutineProgramSpec::single_trigger(rule_id, unit.id.clone(), hook, operation)
}

/// Safe-integer operand extraction that reports shape mismatch as family
/// rejection (`None`), per the fail-closed mapping contract.
fn integer_operand(unit: &CatalogBehaviorUnit, index: usize) -> Option<i64> {
    safe_integer_operand(unit, index).ok()
}

/// Deterministic coverage metadata for the catalog slice handed to the
/// integration pipeline. Nothing the family owns may disappear from this
/// report: each owned-but-uncompiled unit carries its reason.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct StatusFieldCoverage {
    /// Units whose behavior-unit kind belongs to this family.
    pub owned_units: u32,
    /// Units admitted into a compiled [`RoutineProgramSpec`].
    pub claimed_units: u32,
    /// Owned units that stayed unresolved, in frozen catalog order.
    pub unclaimed: Vec<UnclaimedStatusFieldUnit>,
    /// Frozen fixture member counts per closed field vocabulary.
    pub member_counts: FieldMemberCounts,
}

/// Exact fixture member inventories, re-derived per compile input.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FieldMemberCounts {
    pub major_status: u32,
    pub volatile_tag: u32,
    pub weather: u32,
    pub terrain: u32,
    pub arena_tag: u32,
    pub positional_tag: u32,
}

/// One owned unit the family could not compile, with the deterministic
/// first-failure reason.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnclaimedStatusFieldUnit {
    /// Frozen behavior-unit identity, serialized as `<ordinal>:<hash>`.
    pub behavior_unit: String,
    pub reason: UnclaimedReason,
}

/// Closed reasons an owned unit stays unresolved. These strings are stable
/// audit surface.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UnclaimedReason {
    /// The unit is a definition-only bespoke gap: no implementation class,
    /// no constructor operands, hook `CONTENT_LOAD`.
    BespokeGapDefinitionUnit,
    /// Implementation class is an abstract base and cannot instantiate.
    AbstractImplementationBase,
    /// Implementation class is not in [`RECOGNIZED_FIELD_CLASSES`].
    ImplementationClassUnrecognized,
    /// Hook evidence does not name a hook in the family's closed schema set.
    HookEvidenceUnrecognized,
    /// Constructor operands do not match any frozen operand shape.
    OperandShapeUnrecognized,
}

impl UnclaimedStatusFieldUnit {
    fn new(unit: &CatalogBehaviorUnit, reason: UnclaimedReason) -> Self {
        Self {
            behavior_unit: format!(
                "{}:{}",
                unit.id.ordinal.get(),
                unit.id.provenance_hash.as_str()
            ),
            reason,
        }
    }
}

/// Derives deterministic coverage metadata for the given units. Identical
/// inputs always produce identical outputs; no environment participates.
pub fn status_field_coverage(units: &[CatalogBehaviorUnit]) -> StatusFieldCoverage {
    let mut coverage = StatusFieldCoverage {
        owned_units: 0,
        claimed_units: 0,
        unclaimed: Vec::new(),
        member_counts: FieldMemberCounts::default(),
    };
    for unit in units {
        let Some(domain) = owned_domain(&unit.id.unit_kind) else {
            continue;
        };
        coverage.owned_units += 1;
        match domain {
            FieldDomain::MajorStatus => coverage.member_counts.major_status += 1,
            FieldDomain::VolatileTag => coverage.member_counts.volatile_tag += 1,
            FieldDomain::Weather => coverage.member_counts.weather += 1,
            FieldDomain::Terrain => coverage.member_counts.terrain += 1,
            FieldDomain::ArenaTag => coverage.member_counts.arena_tag += 1,
            FieldDomain::PositionalTag => coverage.member_counts.positional_tag += 1,
        }
        let outcome = map_status_field_unit(unit);
        match outcome {
            Ok(Some(_)) => coverage.claimed_units += 1,
            Ok(None) => coverage.unclaimed.push(UnclaimedStatusFieldUnit::new(
                unit,
                classify_unclaimed_reason(unit),
            )),
            // Rejection is data (`None`); errors are internal contract
            // violations and are still reported rather than dropped.
            Err(_) => coverage.unclaimed.push(UnclaimedStatusFieldUnit::new(
                unit,
                UnclaimedReason::OperandShapeUnrecognized,
            )),
        }
    }
    coverage
}

fn classify_unclaimed_reason(unit: &CatalogBehaviorUnit) -> UnclaimedReason {
    if unit.semantic.resolution != CatalogResolution::ResolvedOperands {
        return UnclaimedReason::BespokeGapDefinitionUnit;
    }
    let Some(name) = implementation_name(unit) else {
        return UnclaimedReason::ImplementationClassUnrecognized;
    };
    match recognized_class(name) {
        None => UnclaimedReason::ImplementationClassUnrecognized,
        Some(class) if class.abstract_base => UnclaimedReason::AbstractImplementationBase,
        Some(_) if !hook_schema_matches_any(unit) => UnclaimedReason::HookEvidenceUnrecognized,
        Some(_) => UnclaimedReason::OperandShapeUnrecognized,
    }
}

fn hook_schema_matches_any(unit: &CatalogBehaviorUnit) -> bool {
    [
        MechanicHookV2::BeforeStatus,
        MechanicHookV2::AfterStatus,
        MechanicHookV2::AfterHit,
        MechanicHookV2::WeatherChanged,
        MechanicHookV2::WeatherLapse,
        MechanicHookV2::TerrainChanged,
        MechanicHookV2::AfterMove,
        MechanicHookV2::TurnEnd,
    ]
    .iter()
    .any(|hook| hook_matches(unit, *hook))
}

/// Admits one behavior unit into the StatusField family.
///
/// Returns `Ok(None)` whenever the family does not own the unit or any
/// closed-schema check fails; ownership alone never compiles anything.
pub fn map_status_field_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    let Some(domain) = owned_domain(&unit.id.unit_kind) else {
        return Ok(None);
    };
    // Definition-only bespoke gaps (every WEATHER/TERRAIN/STATUS/TAG member
    // inventory unit at this base) stay bespoke: they carry no implementation
    // class and no constructor operands.
    if unit.semantic.resolution != CatalogResolution::ResolvedOperands {
        return Ok(None);
    }
    // Exact implementation-class admission: present, recognized, concrete,
    // and in the same field domain as the owning behavior-unit kind.
    let admitted = implementation_name(unit)
        .and_then(recognized_class)
        .is_some_and(|class| !class.abstract_base && class.domain == domain);
    if !admitted {
        return Ok(None);
    }

    let effect = unit.semantic.effect.kind;
    let spec = match (domain, effect) {
        (FieldDomain::Weather, CatalogEffectKind::ModifyWeather) => map_weather_unit(unit)?,
        (FieldDomain::Terrain, CatalogEffectKind::ModifyTerrain) => map_terrain_unit(unit)?,
        (FieldDomain::MajorStatus, CatalogEffectKind::ApplyOrBlockStatus) => {
            map_major_status_unit(unit)?
        }
        (FieldDomain::VolatileTag, CatalogEffectKind::ModifyTag) => map_volatile_unit(unit)?,
        (FieldDomain::ArenaTag, CatalogEffectKind::ModifyTag) => map_arena_side_unit(unit)?,
        (FieldDomain::PositionalTag, CatalogEffectKind::ModifyTag) => {
            map_positional_tag_unit(unit)?
        }
        _ => return Ok(None),
    };
    Ok(spec)
}

fn map_weather_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if hook_matches(unit, MechanicHookV2::WeatherChanged) {
        let Some(code) = integer_operand(unit, 0) else {
            return Ok(None);
        };
        if !(0..WEATHER_MEMBER_COUNT).contains(&code) {
            return Ok(None);
        }
        return trigger_spec(
            rule(RULE_WEATHER_SET),
            unit,
            MechanicHookV2::WeatherChanged,
            MechanicOperationV2::WeatherSet,
        )
        .map(Some);
    }
    if hook_matches(unit, MechanicHookV2::WeatherLapse) {
        // Expiry removes the weather's field instance once its turn counter
        // reaches zero; the counter itself lives in instance state.
        return trigger_spec(
            rule(RULE_WEATHER_EXPIRE),
            unit,
            MechanicHookV2::WeatherLapse,
            MechanicOperationV2::InstanceRemove,
        )
        .map(Some);
    }
    Ok(None)
}

fn map_terrain_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !hook_matches(unit, MechanicHookV2::TerrainChanged) {
        return Ok(None);
    }
    let Some(code) = integer_operand(unit, 0) else {
        return Ok(None);
    };
    if !(0..TERRAIN_MEMBER_COUNT).contains(&code) {
        return Ok(None);
    }
    trigger_spec(
        rule(RULE_TERRAIN_SET),
        unit,
        MechanicHookV2::TerrainChanged,
        MechanicOperationV2::TerrainSet,
    )
    .map(Some)
}

fn map_major_status_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if hook_matches(unit, MechanicHookV2::BeforeStatus) {
        let Some(code) = integer_operand(unit, 0) else {
            return Ok(None);
        };
        if !(0..MAJOR_STATUS_MEMBER_COUNT).contains(&code) {
            return Ok(None);
        }
        return trigger_spec(
            rule(RULE_STATUS_APPLY),
            unit,
            MechanicHookV2::BeforeStatus,
            MechanicOperationV2::StatusApply,
        )
        .map(Some);
    }
    if hook_matches(unit, MechanicHookV2::AfterStatus) {
        // Cure shapes carry no value operand; counter shapes carry exactly
        // one safe integer turn-count value in `1..=u16::MAX`.
        if unit.semantic.operands.is_empty() {
            return trigger_spec(
                rule(RULE_STATUS_CURE),
                unit,
                MechanicHookV2::AfterStatus,
                MechanicOperationV2::StatusCure,
            )
            .map(Some);
        }
        if unit.semantic.operands.len() == 1 {
            let Some(turns) = integer_operand(unit, 0) else {
                return Ok(None);
            };
            if !(1..=i64::from(u16::MAX)).contains(&turns) {
                return Ok(None);
            }
            #[allow(clippy::cast_possible_truncation)]
            let value = turns as u16;
            return trigger_spec(
                rule(RULE_STATUS_COUNTER_SET),
                unit,
                MechanicHookV2::AfterStatus,
                MechanicOperationV2::StatusCounterSet { value },
            )
            .map(Some);
        }
        return Ok(None);
    }
    Ok(None)
}

fn map_volatile_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if hook_matches(unit, MechanicHookV2::AfterHit) {
        let Some(tag) = integer_operand(unit, 0) else {
            return Ok(None);
        };
        if !(0..BATTLER_TAG_MEMBER_COUNT).contains(&tag) {
            return Ok(None);
        }
        return trigger_spec(
            rule(RULE_VOLATILE_CREATE),
            unit,
            MechanicHookV2::AfterHit,
            MechanicOperationV2::VolatileCreate,
        )
        .map(Some);
    }
    if hook_matches(unit, MechanicHookV2::TurnEnd) {
        return trigger_spec(
            rule(RULE_VOLATILE_REMOVE),
            unit,
            MechanicHookV2::TurnEnd,
            MechanicOperationV2::VolatileRemove,
        )
        .map(Some);
    }
    Ok(None)
}

fn map_arena_side_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !hook_matches(unit, MechanicHookV2::AfterMove) {
        return Ok(None);
    }
    // Side conditions (hazards/screens) are string-keyed arena conditions;
    // arena tags carry their numeric tag id. The constructor operand shape
    // decides the domain exactly.
    match unit.semantic.operands.first() {
        Some(CatalogOperand::SafeInteger { value }) => {
            let tag = *value;
            if !(0..ARENA_TAG_MEMBER_COUNT).contains(&tag) {
                return Ok(None);
            }
            trigger_spec(
                rule(RULE_ARENA_TAG_APPLY),
                unit,
                MechanicHookV2::AfterMove,
                MechanicOperationV2::ArenaTagApply,
            )
            .map(Some)
        }
        Some(CatalogOperand::String { value }) => {
            if value.is_empty() {
                return Ok(None);
            }
            trigger_spec(
                rule(RULE_SIDE_CONDITION_SET),
                unit,
                MechanicHookV2::AfterMove,
                MechanicOperationV2::SideConditionSet,
            )
            .map(Some)
        }
        _ => Ok(None),
    }
}

fn map_positional_tag_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !hook_matches(unit, MechanicHookV2::AfterMove) {
        return Ok(None);
    }
    let Some(tag) = integer_operand(unit, 0) else {
        return Ok(None);
    };
    if !(0..POSITIONAL_TAG_MEMBER_COUNT).contains(&tag) {
        return Ok(None);
    }
    trigger_spec(
        rule(RULE_POSITIONAL_TAG_APPLY),
        unit,
        MechanicHookV2::AfterMove,
        MechanicOperationV2::PositionalTagApply,
    )
    .map(Some)
}
