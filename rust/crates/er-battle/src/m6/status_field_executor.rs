//! M6B staged executor for status-field battle state.
//!
//! Stages the typed field-state transitions produced by compiled
//! StatusField routines — weather set/expiry, terrain set/expiry, and
//! arena/side conditions (hazards and screens) — onto [`BattleStateV2`] using
//! the same clone-stage-validate pattern as the M5 mechanics executor
//! (`crate::mechanics_mutation`). Every staging call records exact lifecycle
//! evidence (before/after snapshots plus a monotone ordinal), preserving
//! creation/expiry/counter/source ordering within one atomic transition.
//!
//! Scope boundary, reported never omitted: battler-targeted major statuses,
//! volatile tags, and positional tags need the per-battler M6 execution
//! context (mechanic-instance store, scheduled-event scheduler) that the
//! integration wave owns. They are enumerated by [`unhandled_operations`]
//! against any compiled program instead of being silently skipped, and no
//! unrecognized operation ever stages a neutral change.

use er_mechanics::MechanicsProgramV2;
use er_state::battle_v2::{BattleStateV2, BattleStateV2Error};
use er_types::battle_ids::ArenaConditionId;
use er_types::battle_model::{ArenaConditionScope, TerrainKind, WeatherKind};
use serde::Serialize;
use thiserror::Error;

/// Schema version of the executor's staged-change evidence.
pub const STATUS_FIELD_EXECUTOR_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusFieldDomain {
    Weather,
    Terrain,
    ArenaCondition,
}

/// Closed set of staged lifecycle changes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusFieldChange {
    Weather {
        before: FieldCycleSnapshot,
        after: FieldCycleSnapshot,
    },
    Terrain {
        before: FieldCycleSnapshot,
        after: FieldCycleSnapshot,
    },
    /// Hazards/screens: layer-stacking side condition upsert.
    SideCondition {
        before: Option<ArenaConditionSnapshot>,
        after: ArenaConditionSnapshot,
    },
    /// Arena tag removal (expiry or dispel).
    ArenaTagRemoved {
        removed: ArenaConditionSnapshot,
    },
}

/// One weather/terrain cycle snapshot. The oracle code is carried exactly as
/// extracted; `None` is the cleared state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FieldCycleSnapshot {
    pub kind_code: Option<u16>,
    pub remaining_turns: u16,
}

/// One arena/side condition snapshot in canonical stored form.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArenaConditionSnapshot {
    pub condition_id: String,
    pub scope: ArenaConditionScope,
    pub turn_count: u16,
    pub layers: u8,
}

/// Ordered evidence record: one staged change with its transition-local
/// creation ordinal. Ordinals are assigned by the caller in frozen source
/// order and are monotone across one atomic transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StatusFieldEvidence {
    pub schema_version: u32,
    pub ordinal: u32,
    pub domain: StatusFieldDomain,
    pub change: StatusFieldChange,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum StatusFieldExecutorError {
    #[error("field effect duration must be positive")]
    ZeroTurnDuration,
    #[error("side-condition layer overflow")]
    LayerOverflow,
    #[error("arena condition identity must be non-empty")]
    EmptyArenaConditionId,
    #[error("arena condition {condition} is absent in scope {scope:?}")]
    ConditionMissing {
        condition: String,
        scope: ArenaConditionScope,
    },
    #[error("staged battle state is invalid: {0}")]
    InvalidState(#[from] BattleStateV2Error),
}

fn cycle_snapshot(kind: &WeatherKind, remaining_turns: u16) -> FieldCycleSnapshot {
    FieldCycleSnapshot {
        kind_code: match kind {
            WeatherKind::None => None,
            WeatherKind::UnsupportedOracleCode(code) => Some(*code),
        },
        remaining_turns,
    }
}

fn terrain_snapshot(kind: &TerrainKind, remaining_turns: u16) -> FieldCycleSnapshot {
    let code = match kind {
        TerrainKind::None => None,
        TerrainKind::UnsupportedOracleCode(code) => Some(*code),
    };
    FieldCycleSnapshot {
        kind_code: code,
        remaining_turns,
    }
}


/// Stages a weather replacement with its full turn budget. The previous
/// weather's remaining counter is preserved in the evidence, so expiry
/// ordering across overlapping replacements stays reconstructible.
pub fn stage_weather_set(
    state: &mut BattleStateV2,
    weather_code: u16,
    turns: u16,
    ordinal: u32,
) -> Result<StatusFieldEvidence, StatusFieldExecutorError> {
    if turns == 0 {
        return Err(StatusFieldExecutorError::ZeroTurnDuration);
    }
    let before = cycle_snapshot(&state.weather.kind, state.weather.remaining_turns);
    let after = FieldCycleSnapshot {
        kind_code: Some(weather_code),
        remaining_turns: turns,
    };
    state.weather = er_types::battle_model::WeatherState {
        kind: WeatherKind::UnsupportedOracleCode(weather_code),
        remaining_turns: turns,
    };
    Ok(StatusFieldEvidence {
        schema_version: STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
        ordinal,
        domain: StatusFieldDomain::Weather,
        change: StatusFieldChange::Weather { before, after },
    })
}

/// Stages weather expiry back to the cleared state.
pub fn stage_weather_expire(
    state: &mut BattleStateV2,
    ordinal: u32,
) -> Result<StatusFieldEvidence, StatusFieldExecutorError> {
    let before = cycle_snapshot(&state.weather.kind, state.weather.remaining_turns);
    let after = FieldCycleSnapshot {
        kind_code: None,
        remaining_turns: 0,
    };
    state.weather = er_types::battle_model::WeatherState {
        kind: WeatherKind::None,
        remaining_turns: 0,
    };
    Ok(StatusFieldEvidence {
        schema_version: STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
        ordinal,
        domain: StatusFieldDomain::Weather,
        change: StatusFieldChange::Weather { before, after },
    })
}

/// Stages a terrain replacement with its full turn budget.
pub fn stage_terrain_set(
    state: &mut BattleStateV2,
    terrain_code: u16,
    turns: u16,
    ordinal: u32,
) -> Result<StatusFieldEvidence, StatusFieldExecutorError> {
    if turns == 0 {
        return Err(StatusFieldExecutorError::ZeroTurnDuration);
    }
    let before = terrain_snapshot(&state.terrain.kind, state.terrain.remaining_turns);
    let after = FieldCycleSnapshot {
        kind_code: Some(terrain_code),
        remaining_turns: turns,
    };
    state.terrain = er_types::battle_model::TerrainState {
        kind: TerrainKind::UnsupportedOracleCode(terrain_code),
        remaining_turns: turns,
    };
    Ok(StatusFieldEvidence {
        schema_version: STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
        ordinal,
        domain: StatusFieldDomain::Terrain,
        change: StatusFieldChange::Terrain { before, after },
    })
}

/// Stages terrain expiry back to the cleared state.
pub fn stage_terrain_expire(
    state: &mut BattleStateV2,
    ordinal: u32,
) -> Result<StatusFieldEvidence, StatusFieldExecutorError> {
    let before = terrain_snapshot(&state.terrain.kind, state.terrain.remaining_turns);
    let after = FieldCycleSnapshot {
        kind_code: None,
        remaining_turns: 0,
    };
    state.terrain = er_types::battle_model::TerrainState {
        kind: TerrainKind::None,
        remaining_turns: 0,
    };
    Ok(StatusFieldEvidence {
        schema_version: STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
        ordinal,
        domain: StatusFieldDomain::Terrain,
        change: StatusFieldChange::Terrain { before, after },
    })
}

/// Stages a hazard/screen application. Existing entries in the same scope
/// stack layers (`layers += delta`) and refresh their counter; new entries
/// append, preserving insertion order as source order.
pub fn stage_side_condition_set(
    state: &mut BattleStateV2,
    condition_id: &str,
    scope: ArenaConditionScope,
    layers_delta: u8,
    turns: u16,
    ordinal: u32,
) -> Result<StatusFieldEvidence, StatusFieldExecutorError> {
    if turns == 0 {
        return Err(StatusFieldExecutorError::ZeroTurnDuration);
    }
    let id = ArenaConditionId::new(condition_id)
        .map_err(|_| StatusFieldExecutorError::EmptyArenaConditionId)?;
    if let Some(entry) = state
        .arena_conditions
        .iter_mut()
        .find(|entry| entry.condition.as_str() == condition_id && entry.scope == scope)
    {
        let before = ArenaConditionSnapshot {
            condition_id: entry.condition.as_str().to_owned(),
            scope: scope.clone(),
            turn_count: entry.turn_count,
            layers: entry.layers,
        };
        entry.turn_count = turns;
        entry.layers = entry
            .layers
            .checked_add(layers_delta)
            .ok_or(StatusFieldExecutorError::LayerOverflow)?;
        let after = ArenaConditionSnapshot {
            condition_id: entry.condition.as_str().to_owned(),
            scope: scope.clone(),
            turn_count: entry.turn_count,
            layers: entry.layers,
        };
        return Ok(StatusFieldEvidence {
            schema_version: STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
            ordinal,
            domain: StatusFieldDomain::ArenaCondition,
            change: StatusFieldChange::SideCondition {
                before: Some(before),
                after,
            },
        });
    }
    let after = ArenaConditionSnapshot {
        condition_id: id.as_str().to_owned(),
        scope: scope.clone(),
        turn_count: turns,
        layers: layers_delta,
    };
    state.arena_conditions.push(er_types::battle_model::ArenaConditionState {
        condition: id,
        scope: scope.clone(),
        turn_count: turns,
        layers: layers_delta,
    });
    Ok(StatusFieldEvidence {
        schema_version: STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
        ordinal,
        domain: StatusFieldDomain::ArenaCondition,
        change: StatusFieldChange::SideCondition {
            before: None,
            after,
        },
    })
}

/// Removes one arena tag in the given scope, reporting absence as an error
/// rather than silently continuing.
pub fn stage_arena_tag_remove(
    state: &mut BattleStateV2,
    condition_id: &str,
    scope: ArenaConditionScope,
    ordinal: u32,
) -> Result<StatusFieldEvidence, StatusFieldExecutorError> {
    let position = state
        .arena_conditions
        .iter()
        .position(|entry| entry.condition.as_str() == condition_id && entry.scope == scope)
        .ok_or_else(|| StatusFieldExecutorError::ConditionMissing {
            condition: condition_id.to_owned(),
            scope: scope.clone(),
        })?;
    let removed_entry = state.arena_conditions.remove(position);
    Ok(StatusFieldEvidence {
        schema_version: STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
        ordinal,
        domain: StatusFieldDomain::ArenaCondition,
        change: StatusFieldChange::ArenaTagRemoved {
            removed: ArenaConditionSnapshot {
                condition_id: removed_entry.condition.into_inner(),
                scope: scope.clone(),
                turn_count: removed_entry.turn_count,
                layers: removed_entry.layers,
            },
        },
    })
}

/// Validates the staged battle state after a batch of changes.
pub fn validate_staged(state: &BattleStateV2) -> Result<(), StatusFieldExecutorError> {
    state.validate()?;
    Ok(())
}

/// One compiled operation this executor does not stage.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnhandledStatusFieldOperation {
    pub binding_index: usize,
    pub operation_index: usize,
    pub kind: &'static str,
}

/// Enumerates every operation of a compiled program outside this executor's
/// staged subset, in frozen binding/operation order. This includes all
/// battler-targeted statuses, volatile/battler tags, and positional tags,
/// which await the integration-owned per-battler execution context.
pub fn unhandled_operations(program: &MechanicsProgramV2) -> Vec<UnhandledStatusFieldOperation> {
    let mut unhandled = Vec::new();
    for (binding_index, binding) in program.bindings.iter().enumerate() {
        let start = usize::from(binding.operations.start);
        let end = binding
            .operations
            .end()
            .unwrap_or(usize::from(binding.operations.start))
            .min(program.operations.len());
        for (offset, operation) in program.operations[start..end].iter().enumerate() {
            if staged_by_this_executor(operation) {
                continue;
            }
            unhandled.push(UnhandledStatusFieldOperation {
                binding_index,
                operation_index: start + offset,
                kind: operation_kind_name(operation),
            });
        }
    }
    unhandled
}

/// The staged subset: weather/terrain lifecycle and arena/side conditions.
fn staged_by_this_executor(
    operation: &er_mechanics::selector_operation_v2::MechanicOperationV2,
) -> bool {
    use er_mechanics::selector_operation_v2::MechanicOperationV2 as Op;
    matches!(
        operation,
        Op::WeatherSet | Op::TerrainSet | Op::SideConditionSet | Op::ArenaTagApply,
    )
}

/// Closed SCREAMING_SNAKE name for every operation variant; used only for
/// unhandled-operation reporting, never dispatch.
fn operation_kind_name(
    operation: &er_mechanics::selector_operation_v2::MechanicOperationV2,
) -> &'static str {
    use er_mechanics::selector_operation_v2::MechanicOperationV2 as Op;
    match operation {
        Op::Query { .. } => "QUERY",
        Op::HpDamage { .. } => "HP_DAMAGE",
        Op::HpHeal { .. } => "HP_HEAL",
        Op::HpSet { .. } => "HP_SET",
        Op::SubstituteDamage { .. } => "SUBSTITUTE_DAMAGE",
        Op::RecoilFraction { .. } => "RECOIL_FRACTION",
        Op::DrainFraction { .. } => "DRAIN_FRACTION",
        Op::PpConsume { .. } => "PP_CONSUME",
        Op::PpRestore { .. } => "PP_RESTORE",
        Op::PpSet { .. } => "PP_SET",
        Op::MoveUsabilitySet { .. } => "MOVE_USABILITY_SET",
        Op::StatusApply => "STATUS_APPLY",
        Op::StatusCure => "STATUS_CURE",
        Op::StatusCounterSet { .. } => "STATUS_COUNTER_SET",
        Op::VolatileCreate => "VOLATILE_CREATE",
        Op::VolatileRemove => "VOLATILE_REMOVE",
        Op::StatStageChange { .. } => "STAT_STAGE_CHANGE",
        Op::StatStageReset => "STAT_STAGE_RESET",
        Op::StatStageCopy => "STAT_STAGE_COPY",
        Op::StatStageInvert => "STAT_STAGE_INVERT",
        Op::AbilitySuppress { .. } => "ABILITY_SUPPRESS",
        Op::HeldItemCreate => "HELD_ITEM_CREATE",
        Op::HeldItemStack { .. } => "HELD_ITEM_STACK",
        Op::HeldItemConsume => "HELD_ITEM_CONSUME",
        Op::HeldItemPreserve => "HELD_ITEM_PRESERVE",
        Op::HeldItemTransfer => "HELD_ITEM_TRANSFER",
        Op::HeldItemRemove => "HELD_ITEM_REMOVE",
        Op::WeatherSet => "WEATHER_SET",
        Op::TerrainSet => "TERRAIN_SET",
        Op::SideConditionSet => "SIDE_CONDITION_SET",
        Op::ArenaTagApply => "ARENA_TAG_APPLY",
        Op::BattlerTagApply => "BATTLER_TAG_APPLY",
        Op::PositionalTagApply => "POSITIONAL_TAG_APPLY",
        Op::ChargeLockSet { .. } => "CHARGE_LOCK_SET",
        Op::RechargeLockSet { .. } => "RECHARGE_LOCK_SET",
        Op::GuardChainPush => "GUARD_CHAIN_PUSH",
        Op::GuardChainClear => "GUARD_CHAIN_CLEAR",
        Op::SwitchRequest => "SWITCH_REQUEST",
        Op::ForcedSwitchRequest => "FORCED_SWITCH_REQUEST",
        Op::PivotRequest => "PIVOT_REQUEST",
        Op::TrapApply => "TRAP_APPLY",
        Op::RedirectTarget => "REDIRECT_TARGET",
        Op::TransformOverlayApply => "TRANSFORM_OVERLAY_APPLY",
        Op::TransformOverlayClear => "TRANSFORM_OVERLAY_CLEAR",
        Op::MoveCopyRecord => "MOVE_COPY_RECORD",
        Op::MoveCallRequest => "MOVE_CALL_REQUEST",
        Op::SpecialDamageCounterAdd { .. } => "SPECIAL_DAMAGE_COUNTER_ADD",
        Op::InstanceCreate => "INSTANCE_CREATE",
        Op::InstanceUpdate => "INSTANCE_UPDATE",
        Op::InstanceRemove => "INSTANCE_REMOVE",
        Op::InstanceTransfer => "INSTANCE_TRANSFER",
        Op::ScheduledEventCreate { .. } => "SCHEDULED_EVENT_CREATE",
        Op::ScheduledEventCancel { .. } => "SCHEDULED_EVENT_CANCEL",
        Op::ScheduledEventDeliver { .. } => "SCHEDULED_EVENT_DELIVER",
        Op::PresentationCue { .. } => "PRESENTATION_CUE",
    }
}
