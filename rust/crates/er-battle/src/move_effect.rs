//! Closed per-target move effects for the selected M3 battle slice.
//!
//! The move pipeline owns actor/PP/paralysis admission and state lookup.  This
//! module owns the target order after those checks: damaging moves resolve
//! native typing, the caller-supplied defensive-ability seam, accuracy,
//! criticals, and damage; status/stage effects use the B05 APIs.  No
//! presentation identity, faint occurrence, outcome, or BattleState RNG
//! synchronization is allocated here.

use er_content::moves::{MoveDefinition, MoveDefinitionError};
use er_content::pack::{ContentPack, ContentPackError};
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_state::pokemon::PokemonState;
use er_types::SafeU53;
use er_types::battle_ids::{AbilityId, FieldSlot, MoveId, PokemonId};
use er_types::battle_model::{
    BattleStat, EffectChance, MoveCategory, MoveEffectDefinition, MoveFlag, PokemonType,
};
use thiserror::Error;

use crate::accuracy::{AccuracyContext, AccuracyDecision, AccuracyError, AccuracyGate};
use crate::critical::{CriticalContext, CriticalDecision, CriticalError};
use crate::damage::{DamageError, DamageInput, DamageResult};
use crate::stat_stage::{
    StagePolicy, StatStageError, StatStageMutation, apply_stage_delta, effective_battle_stat,
};
use crate::status::{
    StatusApplicationInput, StatusApplicationOutcome, StatusBypass, StatusError,
    apply_status_with_chance, burn_damage_multiplier,
};
use crate::type_effectiveness::{
    EffectivenessMultiplier, TypeEffectiveness, TypeEffectivenessError, resolve_type_effectiveness,
};

/// Typed input supplied to the defensive-ability seam.
///
/// The seam intentionally contains only resolved values and the target's
/// immutable-in-this-step view.  An adapter may inspect the target loadout and
/// suppression flag, but this module does not know any ability implementation.
#[derive(Clone, Copy, Debug)]
pub struct DefensiveAbilityGateInput<'a> {
    pub move_category: MoveCategory,
    pub move_type: PokemonType,
    pub target_slot: FieldSlot,
    pub target: &'a PokemonState,
    pub effectiveness: TypeEffectiveness,
    pub abilities_ignored: bool,
}

/// Typed reason for a defensive gate to block a damaging move.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DefensiveAbilityBlockReason {
    /// The selected attack-immunity ability blocks a non-super-effective hit.
    NonSuperEffectiveAttack,
    /// A selected ability supplied a move-type immunity.
    MoveTypeImmunity,
}

/// Closed pass/blocked result returned by the caller-supplied ability seam.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DefensiveAbilityGateResult {
    Pass,
    Blocked {
        ability: Option<AbilityId>,
        reason: DefensiveAbilityBlockReason,
    },
}

/// Typed failure returned by a defensive-ability adapter.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum DefensiveAbilityGateError {
    #[error("defensive ability gate reached unsupported behavior: {reason:?}")]
    Unsupported {
        reason: DefensiveAbilityGateUnsupportedReason,
    },
    #[error("defensive ability gate received an invalid selected-slice context")]
    InvalidContext,
}

/// Closed reasons an adapter may report instead of silently passing a hook.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum DefensiveAbilityGateUnsupportedReason {
    #[error("dynamic ability suppression")]
    DynamicSuppression,
    #[error("unsupported ability effect")]
    UnsupportedAbilityEffect,
    #[error("unsupported move mode")]
    UnsupportedMoveMode,
}

/// Default seam for callers that have no defensive ability hook in scope.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoDefensiveAbilityGate;

impl DefensiveAbilityGate for NoDefensiveAbilityGate {
    fn evaluate(
        &self,
        _input: DefensiveAbilityGateInput<'_>,
    ) -> Result<DefensiveAbilityGateResult, DefensiveAbilityGateError> {
        Ok(DefensiveAbilityGateResult::Pass)
    }
}

/// Narrow caller-supplied seam for selected defensive ability behavior.
pub trait DefensiveAbilityGate {
    fn evaluate(
        &self,
        input: DefensiveAbilityGateInput<'_>,
    ) -> Result<DefensiveAbilityGateResult, DefensiveAbilityGateError>;
}

/// A semantic request for the later faint/replacement lane.
///
/// This deliberately has no `FaintOccurrenceId`; occurrence allocation and
/// queue insertion belong to the resolver/integration owner.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FaintRequest {
    pub pokemon: PokemonId,
    pub slot: FieldSlot,
    pub source: PokemonId,
    pub move_id: MoveId,
}

/// One real HP mutation produced by a damaging target effect.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HpMutation {
    pub pokemon: PokemonId,
    pub before: u32,
    pub after: u32,
    pub applied_damage: u32,
}

/// The terminal disposition of one target after the causal gates.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TargetEffectDisposition {
    SkippedTargetInactive,
    NativeTypeImmune,
    DefensiveAbilityBlocked {
        ability: Option<AbilityId>,
        reason: DefensiveAbilityBlockReason,
    },
    Missed,
    Executed,
}

/// Semantic result for one target, with only resolved observations and real
/// state mutations.  The target vector remains in caller-supplied order.
#[derive(Clone, Debug, PartialEq)]
pub struct MoveTargetResult {
    pub slot: FieldSlot,
    pub pokemon: Option<PokemonId>,
    pub disposition: TargetEffectDisposition,
    pub effectiveness: Option<TypeEffectiveness>,
    pub defensive_gate: Option<DefensiveAbilityGateResult>,
    pub accuracy: Option<AccuracyDecision>,
    pub critical: Option<CriticalDecision>,
    pub damage: Option<DamageResult>,
    pub hp_mutation: Option<HpMutation>,
    pub status_effects: Vec<StatusApplicationOutcome>,
    pub stat_stage_effects: Vec<StatStageMutation>,
    pub flinched: bool,
    pub faint_request: Option<FaintRequest>,
}

impl MoveTargetResult {
    /// Build the no-draw result for a target that is no longer active.
    pub const fn skipped_target_inactive(slot: FieldSlot, pokemon: Option<PokemonId>) -> Self {
        Self {
            slot,
            pokemon,
            disposition: TargetEffectDisposition::SkippedTargetInactive,
            effectiveness: None,
            defensive_gate: None,
            accuracy: None,
            critical: None,
            damage: None,
            hp_mutation: None,
            status_effects: Vec::new(),
            stat_stage_effects: Vec::new(),
            flinched: false,
            faint_request: None,
        }
    }
}

/// Explicit failure mapping at the move-effect boundary.
#[derive(Debug, Error)]
pub enum MoveEffectError {
    #[error("immutable content pack is invalid: {0}")]
    Content(#[source] ContentPackError),
    #[error("move {move_id:?} has an invalid selected definition: {source}")]
    InvalidMoveDefinition {
        move_id: MoveId,
        #[source]
        source: MoveDefinitionError,
    },
    #[error("move {move_id:?} has unsupported effect {effect:?}")]
    UnsupportedEffect {
        move_id: MoveId,
        effect: MoveEffectDefinition,
    },
    #[error("move {move_id:?} has no resolved power for damaging resolution")]
    MissingDamagePower { move_id: MoveId },
    #[error("move {move_id:?} has a non-damaging category/power combination")]
    InvalidDamageCategory { move_id: MoveId },
    #[error("move {move_id:?} has an unsupported effect chance {chance:?}")]
    UnsupportedEffectChance {
        move_id: MoveId,
        chance: EffectChance,
    },
    #[error("type-effectiveness resolution failed: {0}")]
    TypeEffectiveness(#[source] TypeEffectivenessError),
    #[error("defensive ability resolution failed: {0}")]
    DefensiveAbility(#[source] DefensiveAbilityGateError),
    #[error("accuracy resolution failed: {0}")]
    Accuracy(#[source] AccuracyError),
    #[error("critical resolution failed: {0}")]
    Critical(#[source] CriticalError),
    #[error("damage resolution failed: {0}")]
    Damage(#[source] DamageError),
    #[error("status resolution failed: {0}")]
    Status(#[source] StatusError),
    #[error("stat-stage resolution failed: {0}")]
    StatStage(#[source] StatStageError),
    #[error("secondary-effect RNG resolution failed: {0}")]
    SecondaryEffectRng(#[source] RngError),
    #[error("target count must be positive")]
    EmptyTargetSet,
    #[error("target HP damage {damage} does not fit the canonical u32 state")]
    HpDamageOverflow { damage: u64 },
}

/// Resolve the selected move effects for one already-active target.
///
/// The caller must perform field occupancy/target-inactive handling before
/// calling this function.  It still rejects a fainted target defensively and
/// returns a no-draw inactive result.  Damaging effects use the exact order
/// native typing -> defensive gate -> accuracy -> critical -> damage.  Status
/// moves intentionally bypass both the ordinary type chart and the defensive
/// ability seam, then apply their B05 admission after accuracy.
#[allow(clippy::too_many_arguments)]
pub fn resolve_target_effect<G: DefensiveAbilityGate>(
    runtime: &mut RngRuntime,
    actor: &PokemonState,
    target_slot: FieldSlot,
    target: &mut PokemonState,
    move_definition: &MoveDefinition,
    content: &ContentPack,
    target_count: usize,
    abilities_ignored: bool,
    defensive_gate: &G,
) -> Result<MoveTargetResult, MoveEffectError> {
    content.validate().map_err(MoveEffectError::Content)?;
    resolve_target_effect_validated(
        runtime,
        actor,
        target_slot,
        target,
        move_definition,
        content,
        target_count,
        abilities_ignored,
        defensive_gate,
    )
}

/// Resolve one active target after the enclosing move/turn boundary has
/// already validated the immutable content pack.
#[allow(clippy::too_many_arguments)]
pub(crate) fn resolve_target_effect_validated<G: DefensiveAbilityGate>(
    runtime: &mut RngRuntime,
    actor: &PokemonState,
    target_slot: FieldSlot,
    target: &mut PokemonState,
    move_definition: &MoveDefinition,
    content: &ContentPack,
    target_count: usize,
    abilities_ignored: bool,
    defensive_gate: &G,
) -> Result<MoveTargetResult, MoveEffectError> {
    if target_count == 0 {
        return Err(MoveEffectError::EmptyTargetSet);
    }
    move_definition
        .validate()
        .map_err(|source| MoveEffectError::InvalidMoveDefinition {
            move_id: move_definition.id,
            source,
        })?;

    if target.fainted || target.hp == 0 {
        return Ok(MoveTargetResult::skipped_target_inactive(
            target_slot,
            Some(target.id),
        ));
    }

    let damaging = matches!(
        move_definition.category,
        MoveCategory::Physical | MoveCategory::Special
    );
    if damaging {
        resolve_damaging_target(
            runtime,
            actor,
            target_slot,
            target,
            move_definition,
            content,
            target_count,
            abilities_ignored,
            defensive_gate,
        )
    } else {
        resolve_status_target(runtime, actor, target_slot, target, move_definition)
    }
}

#[allow(clippy::too_many_arguments)]
fn resolve_damaging_target<G: DefensiveAbilityGate>(
    runtime: &mut RngRuntime,
    actor: &PokemonState,
    target_slot: FieldSlot,
    target: &mut PokemonState,
    move_definition: &MoveDefinition,
    content: &ContentPack,
    target_count: usize,
    abilities_ignored: bool,
    defensive_gate: &G,
) -> Result<MoveTargetResult, MoveEffectError> {
    let effectiveness = resolve_type_effectiveness(
        &content.type_chart,
        move_definition.move_type,
        &target.types,
    )
    .map_err(MoveEffectError::TypeEffectiveness)?;

    // A native type immunity is terminal before the defensive seam and every
    // later random gate.  This keeps native immunity distinct from an ability
    // block while preserving the required no-accuracy/no-damage path.
    if effectiveness.is_immune() {
        return Ok(MoveTargetResult {
            slot: target_slot,
            pokemon: Some(target.id),
            disposition: TargetEffectDisposition::NativeTypeImmune,
            effectiveness: Some(effectiveness),
            defensive_gate: None,
            accuracy: None,
            critical: None,
            damage: None,
            hp_mutation: None,
            status_effects: Vec::new(),
            stat_stage_effects: Vec::new(),
            flinched: false,
            faint_request: None,
        });
    }

    let gate_result = defensive_gate
        .evaluate(DefensiveAbilityGateInput {
            move_category: move_definition.category,
            move_type: move_definition.move_type,
            target_slot,
            target,
            effectiveness,
            abilities_ignored,
        })
        .map_err(MoveEffectError::DefensiveAbility)?;
    if let DefensiveAbilityGateResult::Blocked { ability, reason } = gate_result {
        return Ok(MoveTargetResult {
            slot: target_slot,
            pokemon: Some(target.id),
            disposition: TargetEffectDisposition::DefensiveAbilityBlocked { ability, reason },
            effectiveness: Some(effectiveness),
            defensive_gate: Some(gate_result),
            accuracy: None,
            critical: None,
            damage: None,
            hp_mutation: None,
            status_effects: Vec::new(),
            stat_stage_effects: Vec::new(),
            flinched: false,
            faint_request: None,
        });
    }

    let accuracy = resolve_accuracy_for_target(runtime, actor, target, move_definition)?;
    if !accuracy.is_hit() {
        return Ok(MoveTargetResult {
            slot: target_slot,
            pokemon: Some(target.id),
            disposition: TargetEffectDisposition::Missed,
            effectiveness: Some(effectiveness),
            defensive_gate: Some(gate_result),
            accuracy: Some(accuracy),
            critical: None,
            damage: None,
            hp_mutation: None,
            status_effects: Vec::new(),
            stat_stage_effects: Vec::new(),
            flinched: false,
            faint_request: None,
        });
    }

    let critical = CriticalContext::ordinary()
        .resolve(runtime)
        .map_err(MoveEffectError::Critical)?;
    let damage = calculate_damaging_result(
        runtime,
        actor,
        target,
        move_definition,
        effectiveness,
        target_count,
        &critical,
    )?;

    let hp_mutation = apply_hp_damage(actor, target, move_definition.id, damage)?;
    let faint_request = hp_mutation.as_ref().and_then(|mutation| {
        (mutation.after == 0).then_some(FaintRequest {
            pokemon: target.id,
            slot: target_slot,
            source: actor.id,
            move_id: move_definition.id,
        })
    });
    let mut result = MoveTargetResult {
        slot: target_slot,
        pokemon: Some(target.id),
        disposition: TargetEffectDisposition::Executed,
        effectiveness: Some(effectiveness),
        defensive_gate: Some(gate_result),
        accuracy: Some(accuracy),
        critical: Some(critical),
        damage: Some(damage),
        hp_mutation,
        status_effects: Vec::new(),
        stat_stage_effects: Vec::new(),
        flinched: false,
        faint_request,
    };

    // Damage is always complete before any secondary status/stage effect.  A
    // fainted target remains in its field slot until the later faint lane and
    // cannot receive another real target mutation in this closed pipeline.
    if target.hp != 0 {
        apply_non_damage_effects(runtime, actor, target, move_definition, &mut result)?;
    }
    Ok(result)
}

fn resolve_status_target(
    runtime: &mut RngRuntime,
    actor: &PokemonState,
    target_slot: FieldSlot,
    target: &mut PokemonState,
    move_definition: &MoveDefinition,
) -> Result<MoveTargetResult, MoveEffectError> {
    let accuracy = resolve_accuracy_for_target(runtime, actor, target, move_definition)?;
    if !accuracy.is_hit() {
        return Ok(MoveTargetResult {
            slot: target_slot,
            pokemon: Some(target.id),
            disposition: TargetEffectDisposition::Missed,
            effectiveness: None,
            defensive_gate: None,
            accuracy: Some(accuracy),
            critical: None,
            damage: None,
            hp_mutation: None,
            status_effects: Vec::new(),
            stat_stage_effects: Vec::new(),
            flinched: false,
            faint_request: None,
        });
    }

    let mut result = MoveTargetResult {
        slot: target_slot,
        pokemon: Some(target.id),
        disposition: TargetEffectDisposition::Executed,
        effectiveness: None,
        defensive_gate: None,
        accuracy: Some(accuracy),
        critical: None,
        damage: None,
        hp_mutation: None,
        status_effects: Vec::new(),
        stat_stage_effects: Vec::new(),
        flinched: false,
        faint_request: None,
    };
    apply_non_damage_effects(runtime, actor, target, move_definition, &mut result)?;
    Ok(result)
}

fn resolve_accuracy_for_target(
    runtime: &mut RngRuntime,
    actor: &PokemonState,
    target: &PokemonState,
    move_definition: &MoveDefinition,
) -> Result<AccuracyDecision, MoveEffectError> {
    AccuracyContext::new(
        move_definition.accuracy.clone(),
        actor.stat_stages.accuracy,
        target.stat_stages.evasion,
        AccuracyGate::Eligible,
    )
    .resolve(runtime)
    .map_err(MoveEffectError::Accuracy)
}

fn calculate_damaging_result(
    runtime: &mut RngRuntime,
    actor: &PokemonState,
    target: &PokemonState,
    move_definition: &MoveDefinition,
    effectiveness: TypeEffectiveness,
    target_count: usize,
    critical: &CriticalDecision,
) -> Result<DamageResult, MoveEffectError> {
    let power = match &move_definition.power {
        er_types::battle_model::MovePower::Value(power) => f64::from(*power),
        er_types::battle_model::MovePower::None => {
            return Err(MoveEffectError::MissingDamagePower {
                move_id: move_definition.id,
            });
        }
    };

    let (offensive_stat, defensive_stat) = match move_definition.category {
        MoveCategory::Physical => (BattleStat::Attack, BattleStat::Defense),
        MoveCategory::Special => (BattleStat::SpecialAttack, BattleStat::SpecialDefense),
        MoveCategory::Status => {
            return Err(MoveEffectError::InvalidDamageCategory {
                move_id: move_definition.id,
            });
        }
    };
    let critical_offensive_policy = if critical.is_critical() {
        StagePolicy::IgnoreNegative
    } else {
        StagePolicy::Normal
    };
    let critical_defensive_policy = if critical.is_critical() {
        StagePolicy::IgnorePositive
    } else {
        StagePolicy::Normal
    };
    let offensive = effective_battle_stat(
        &actor.stats,
        &actor.stat_stages,
        offensive_stat,
        actor.status.kind,
        critical_offensive_policy,
    )
    .map_err(MoveEffectError::StatStage)?;
    let defensive = effective_battle_stat(
        &target.stats,
        &target.stat_stages,
        defensive_stat,
        target.status.kind,
        critical_defensive_policy,
    )
    .map_err(MoveEffectError::StatStage)?;
    let burn_multiplier = burn_damage_multiplier(
        actor.status.kind,
        move_definition.category,
        StatusBypass::None,
    )
    .map_err(MoveEffectError::Status)?;
    let effectiveness_multiplier = multiplier_as_f64(effectiveness.multiplier);
    let target_multiplier = if move_definition.target
        == er_types::battle_model::MoveTarget::AllNearEnemies
        && target_count > 1
    {
        0.75
    } else {
        1.0
    };
    let stab_multiplier = if actor.types.primary == move_definition.move_type
        || actor.types.secondary == Some(move_definition.move_type)
    {
        1.5
    } else {
        1.0
    };

    // `DamageInput` owns the source-ordered Number arithmetic and variance
    // draw.  Burn is passed as a selected boolean because B03 owns its exact
    // post-effectiveness multiplier position.
    let input = DamageInput::new(
        u32::from(actor.level),
        move_definition.category,
        power,
        f64::from(offensive.value),
        f64::from(defensive.value),
    )
    .with_target_multiplier(target_multiplier)
    .with_critical_multiplier(critical.multiplier())
    .with_stab_multiplier(stab_multiplier)
    .with_effectiveness_multiplier(effectiveness_multiplier)
    .with_burned(burn_multiplier < 1.0);
    input.calculate(runtime).map_err(MoveEffectError::Damage)
}

fn apply_hp_damage(
    _actor: &PokemonState,
    target: &mut PokemonState,
    _move_id: MoveId,
    damage: DamageResult,
) -> Result<Option<HpMutation>, MoveEffectError> {
    if damage.no_effect || damage.damage == SafeU53::ZERO || target.hp == 0 {
        return Ok(None);
    }
    let before = target.hp;
    let requested = damage.damage.get();
    let applied = requested.min(u64::from(before));
    let applied = u32::try_from(applied)
        .map_err(|_| MoveEffectError::HpDamageOverflow { damage: applied })?;
    let after = before - applied;
    if after == before {
        return Ok(None);
    }
    target.hp = after;
    target.fainted = after == 0;
    Ok(Some(HpMutation {
        pokemon: target.id,
        before,
        after,
        applied_damage: applied,
    }))
}

fn apply_non_damage_effects(
    runtime: &mut RngRuntime,
    _actor: &PokemonState,
    target: &mut PokemonState,
    move_definition: &MoveDefinition,
    result: &mut MoveTargetResult,
) -> Result<(), MoveEffectError> {
    for effect in &move_definition.effects {
        match effect {
            MoveEffectDefinition::Damage => {}
            MoveEffectDefinition::ApplyStatus(status) => {
                let chance =
                    effect_chance(move_definition.effect_chance.clone(), move_definition.id)?;
                let outcome = apply_status_with_chance(
                    runtime,
                    StatusApplicationInput {
                        requested: *status,
                        current: target.status,
                        target_types: target.types,
                        powder: move_definition.flags.contains(&MoveFlag::Powder),
                        bypass: StatusBypass::None,
                    },
                    chance,
                )
                .map_err(MoveEffectError::Status)?;
                if let StatusApplicationOutcome::Applied { mutation } = outcome
                    && mutation.before != mutation.after
                {
                    target.status = mutation.after;
                }
                result.status_effects.push(outcome);
            }
            MoveEffectDefinition::ChangeStatStage { stat, delta } => {
                let chance = secondary_stage_chance(
                    runtime,
                    move_definition.effect_chance.clone(),
                    move_definition.id,
                )?;
                if chance {
                    let mutation = apply_stage_delta(&mut target.stat_stages, *stat, *delta);
                    result.stat_stage_effects.push(mutation);
                }
            }
            MoveEffectDefinition::Flinch => {
                result.flinched = secondary_stage_chance(
                    runtime,
                    move_definition.effect_chance.clone(),
                    move_definition.id,
                )?;
            }
        }
    }
    Ok(())
}

fn effect_chance(chance: EffectChance, move_id: MoveId) -> Result<Option<u8>, MoveEffectError> {
    match chance {
        EffectChance::None => Ok(None),
        EffectChance::Percent(value) if value <= 100 => Ok(Some(value)),
        EffectChance::Percent(value) => Err(MoveEffectError::UnsupportedEffectChance {
            move_id,
            chance: EffectChance::Percent(value),
        }),
    }
}

fn secondary_stage_chance(
    runtime: &mut RngRuntime,
    chance: EffectChance,
    move_id: MoveId,
) -> Result<bool, MoveEffectError> {
    let chance = effect_chance(chance, move_id)?;
    match chance {
        None => Ok(true),
        Some(100) => Ok(true),
        Some(chance) => {
            let draw = runtime
                .pokemon_rand_battle_seed_int(
                    SafeU53::new(100).map_err(|_| {
                        MoveEffectError::SecondaryEffectRng(RngError::RangeOverflow)
                    })?,
                    SafeU53::ZERO,
                    RngReason::SecondaryEffect,
                    RngCallsiteId::secondary_stage(),
                )
                .map_err(MoveEffectError::SecondaryEffectRng)?;
            Ok(draw.get() < u64::from(chance))
        }
    }
}

fn multiplier_as_f64(multiplier: EffectivenessMultiplier) -> f64 {
    let (numerator, denominator) = multiplier.ratio();
    f64::from(numerator) / f64::from(denominator)
}
