//! Pure selected M3 ability trigger evaluations.
//!
//! This module intentionally does not own switching or move effects.  A
//! switch/move integration supplies the already-installed occupancy or the
//! already-composed B04 type result, and receives semantic ability evidence
//! that it may adapt into its own state mutations and presentation plan.

use crate::ability::{AbilityError, AbilitySuppressionReason, ResolvedAbility, resolve_ability};
use crate::stat_stage::{StatStageMutation, stage_mutation};
use crate::type_effectiveness::TypeEffectiveness;
use er_content::pack::ContentPack;
use er_state::battle::BattleState;
use er_state::field::FieldStateError;
use er_state::format::{FormatTopologyError, validate_m3_supported, validate_slot};
use er_state::pokemon::PokemonState;
use er_types::battle_ids::{AbilityId, BattleSide, FieldSlot, PokemonId};
use er_types::battle_model::{AbilityEffectDefinition, BattleStat, MoveCategory};
use thiserror::Error;

/// Inputs for the caller-supplied defensive ability gate.
///
/// `type_effectiveness` must be the complete, already-composed native B04
/// result.  The selected Wonder Guard rule does not inspect raw chart entries
/// or recompute a partial dual-type product here.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DefensiveAbilityInput {
    /// The defender's selected active ability ID.
    pub ability_id: AbilityId,
    /// Whether the defender's active ability is locally suppressed.
    pub ability_suppressed: bool,
    /// Whether the battle-wide ability suppression is active.
    pub global_suppressed: bool,
    /// The already-resolved move category.
    pub move_category: MoveCategory,
    /// The complete B04 native type-effectiveness result.
    pub type_effectiveness: TypeEffectiveness,
}

impl DefensiveAbilityInput {
    /// Build an unsuppressed defensive input.  Suppression can be set through
    /// the public fields when the caller has explicit state evidence.
    pub const fn new(
        ability_id: AbilityId,
        move_category: MoveCategory,
        type_effectiveness: TypeEffectiveness,
    ) -> Self {
        Self {
            ability_id,
            ability_suppressed: false,
            global_suppressed: false,
            move_category,
            type_effectiveness,
        }
    }
}

/// Why a defensive ability allowed a move to continue.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DefensiveAbilityPassReason {
    /// The explicit content-defined NONE ability has no defensive effect.
    None,
    /// The ability is not a defensive ability in this context.
    NotApplicable,
    /// Ability processing was disabled by a selected suppression source.
    Suppressed(AbilitySuppressionReason),
    /// Status-category moves bypass Wonder Guard.
    StatusMove,
    /// The complete native effectiveness is super-effective (2x or 4x).
    SuperEffective,
}

/// Semantic result of the caller-supplied defensive ability gate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DefensiveAbilityOutcome {
    /// The move continues past the selected ability gate.
    Passed {
        /// The content ID evaluated at this gate.
        ability_id: AbilityId,
        /// The exact reason the gate did not block.
        reason: DefensiveAbilityPassReason,
    },
    /// Wonder Guard blocked a damaging move whose complete type result was
    /// not super-effective.
    Blocked {
        /// The content ID that produced the block.
        ability_id: AbilityId,
        /// The complete native result inspected by Wonder Guard.
        type_effectiveness: TypeEffectiveness,
    },
}

impl DefensiveAbilityOutcome {
    /// Return the evaluated ability ID.
    pub const fn ability_id(self) -> AbilityId {
        match self {
            Self::Passed { ability_id, .. } | Self::Blocked { ability_id, .. } => ability_id,
        }
    }

    /// Whether the selected ability gate blocked the move.
    pub const fn is_blocked(self) -> bool {
        matches!(self, Self::Blocked { .. })
    }

    /// Whether the selected ability gate allowed the move to continue.
    pub const fn is_passed(self) -> bool {
        matches!(self, Self::Passed { .. })
    }

    /// Return the native type result when this is a Wonder Guard block.
    pub const fn blocked_type_effectiveness(self) -> Option<TypeEffectiveness> {
        match self {
            Self::Blocked {
                type_effectiveness, ..
            } => Some(type_effectiveness),
            Self::Passed { .. } => None,
        }
    }
}

/// Evidence for one target stage addressed by Intimidate.
///
/// The nested B05 result preserves both changed and clamped attempts. It does not mutate a
/// `PokemonState`, allocate a `BattleMutation`, or allocate presentation IDs.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct IntimidateStageChange {
    /// The incoming source Pokémon.
    pub source: PokemonId,
    /// The incoming source field slot.
    pub source_slot: FieldSlot,
    /// The adjacent opponent whose Attack stage was addressed.
    pub target: PokemonId,
    /// The target's canonical field slot.
    pub target_slot: FieldSlot,
    /// The selected Intimidate ability ID.
    pub ability_id: AbilityId,
    /// The B05 Attack-stage mutation, including clamp and changed evidence.
    pub mutation: StatStageMutation,
}

/// Semantic result of evaluating a switch-in ability after occupancy exists.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SwitchInOutcome {
    /// The source explicitly carries the content-defined NONE ability.
    NoOp {
        source: PokemonId,
        source_slot: FieldSlot,
        ability_id: AbilityId,
    },
    /// A supported ability was present but disabled by suppression.
    Suppressed {
        source: PokemonId,
        source_slot: FieldSlot,
        ability_id: AbilityId,
        reason: AbilitySuppressionReason,
    },
    /// A supported non-switch-in ability was evaluated at a switch-in
    /// boundary and therefore did not trigger.
    NotApplicable {
        source: PokemonId,
        source_slot: FieldSlot,
        ability_id: AbilityId,
    },
    /// Intimidate changed at least one adjacent opponent's Attack stage.
    Triggered {
        source: PokemonId,
        source_slot: FieldSlot,
        ability_id: AbilityId,
        /// Adjacent, occupied, non-fainted opponent slots considered.
        target_slots: Vec<FieldSlot>,
        /// Only mutations whose canonical stage actually changed.
        mutations: Vec<IntimidateStageChange>,
        /// Clamped attempts for eligible targets already at the floor.
        attempts: Vec<IntimidateStageChange>,
    },
    /// Intimidate was evaluated, but every eligible target was already at the
    /// -6 Attack floor or no eligible adjacent opponent was occupied.
    NoMutation {
        source: PokemonId,
        source_slot: FieldSlot,
        ability_id: AbilityId,
        /// Adjacent, occupied, non-fainted opponent slots considered.
        target_slots: Vec<FieldSlot>,
        /// Exact clamped attempts for eligible targets already at the floor.
        attempts: Vec<IntimidateStageChange>,
    },
}

impl SwitchInOutcome {
    /// Return changed Intimidate mutations, or an empty slice for no-op,
    /// suppressed, not-applicable, and no-mutation outcomes.
    pub fn mutations(&self) -> &[IntimidateStageChange] {
        match self {
            Self::Triggered { mutations, .. } => mutations,
            Self::NoOp { .. }
            | Self::Suppressed { .. }
            | Self::NotApplicable { .. }
            | Self::NoMutation { .. } => &[],
        }
    }

    /// Return eligible Intimidate attempts that clamped at the current stage.
    pub fn attempts(&self) -> &[IntimidateStageChange] {
        match self {
            Self::Triggered { attempts, .. } | Self::NoMutation { attempts, .. } => attempts,
            Self::NoOp { .. } | Self::Suppressed { .. } | Self::NotApplicable { .. } => &[],
        }
    }

    /// Return the adjacent opponent slots considered by Intimidate.
    pub fn target_slots(&self) -> &[FieldSlot] {
        match self {
            Self::Triggered { target_slots, .. } | Self::NoMutation { target_slots, .. } => {
                target_slots
            }
            Self::NoOp { .. } | Self::Suppressed { .. } | Self::NotApplicable { .. } => &[],
        }
    }

    /// Whether at least one target stage changed.
    pub fn has_mutation(&self) -> bool {
        !self.mutations().is_empty()
    }
}

/// Errors at the pure ability/state integration boundary.
#[derive(Debug, Error)]
pub enum AbilityPipelineError {
    /// The ability ID or definition was not admitted by immutable content.
    #[error(transparent)]
    Ability(#[from] AbilityError),
    /// The supplied battle format was not canonical.
    #[error(transparent)]
    Format(#[from] FormatTopologyError),
    /// The field could not resolve a canonical slot.
    #[error(transparent)]
    Field(#[from] FieldStateError),
    /// The switch-in source slot must already have its incoming occupant.
    #[error("switch-in source slot {slot:?} has no installed occupant")]
    MissingSourceOccupant { slot: FieldSlot },
    /// A field occupant must be represented in its side's party.
    #[error("field occupant {pokemon:?} at {slot:?} is missing from the {side:?} party")]
    MissingPartyPokemon {
        slot: FieldSlot,
        pokemon: PokemonId,
        side: BattleSide,
    },
    /// A defensive gate target must already be installed in the field.
    #[error("defensive target slot {slot:?} has no installed occupant")]
    MissingDefensiveTarget { slot: FieldSlot },
    /// Ability suppression is represented for compatibility but is outside
    /// the selected M3 mechanical-state slice.
    #[error("ability suppression is outside the selected M3 slice: {reason:?}")]
    UnsupportedSuppression { reason: AbilitySuppressionReason },
    /// Native type immunity is terminal and must not reach an ability gate for
    /// a damaging move.
    #[error(
        "damaging move against ability {ability_id:?} reached the ability gate after native type immunity"
    )]
    NativeTypeImmunityTerminal {
        /// The ability whose gate the caller attempted to enter.
        ability_id: AbilityId,
        /// The already-composed native immunity result.
        type_effectiveness: TypeEffectiveness,
    },
}

/// Evaluate the active ability on an already-installed switch-in source.
///
/// Occupancy is read before any trigger work.  Intimidate follows the format's
/// canonical adjacency edges, filters to opposite-side active occupants, and
/// uses B05 `stage_mutation` for the Attack -1 clamp.  The function does not
/// mutate the supplied battle state.
pub fn evaluate_switch_in(
    battle: &BattleState,
    incoming_slot: FieldSlot,
    content: &ContentPack,
) -> Result<SwitchInOutcome, AbilityPipelineError> {
    validate_m3_supported(&battle.format)?;
    validate_slot(&battle.format, incoming_slot)?;
    battle.field.validate_for_format(&battle.format)?;

    let source_id = battle
        .field
        .occupant(&battle.format, incoming_slot)?
        .ok_or(AbilityPipelineError::MissingSourceOccupant {
            slot: incoming_slot,
        })?;
    let source = party_pokemon(battle, incoming_slot.side, source_id).ok_or(
        AbilityPipelineError::MissingPartyPokemon {
            slot: incoming_slot,
            pokemon: source_id,
            side: incoming_slot.side,
        },
    )?;

    let resolved = resolve_ability(content, source.abilities.active)?;
    validate_m3_suppression(
        battle.global_ability_suppression.ignore_abilities,
        source.abilities.active_suppressed,
    )?;
    if resolved.is_none() {
        return Ok(SwitchInOutcome::NoOp {
            source: source_id,
            source_slot: incoming_slot,
            ability_id: resolved.ability_id,
        });
    }

    if !resolved.is_intimidate() {
        return Ok(SwitchInOutcome::NotApplicable {
            source: source_id,
            source_slot: incoming_slot,
            ability_id: resolved.ability_id,
        });
    }

    let mut target_slots = Vec::new();
    let mut mutations = Vec::new();
    let mut attempts = Vec::new();
    for edge in &battle.format.adjacency {
        let target_slot = if edge.first == incoming_slot {
            edge.second
        } else if edge.second == incoming_slot {
            edge.first
        } else {
            continue;
        };

        // The canonical format may contain same-side edges.  Intimidate only
        // affects adjacent opponents, never the source's ally.
        if target_slot.side == incoming_slot.side {
            continue;
        }

        let Some(target_id) = battle.field.occupant(&battle.format, target_slot)? else {
            continue;
        };
        let target = party_pokemon(battle, target_slot.side, target_id).ok_or(
            AbilityPipelineError::MissingPartyPokemon {
                slot: target_slot,
                pokemon: target_id,
                side: target_slot.side,
            },
        )?;
        if target.fainted {
            continue;
        }

        target_slots.push(target_slot);
        let mutation = stage_mutation(BattleStat::Attack, target.stat_stages.attack, -1);
        let change = IntimidateStageChange {
            source: source_id,
            source_slot: incoming_slot,
            target: target_id,
            target_slot,
            ability_id: resolved.ability_id,
            mutation,
        };
        if mutation.changed {
            mutations.push(change);
        } else {
            attempts.push(change);
        }
    }

    if mutations.is_empty() {
        Ok(SwitchInOutcome::NoMutation {
            source: source_id,
            source_slot: incoming_slot,
            ability_id: resolved.ability_id,
            target_slots,
            attempts,
        })
    } else {
        Ok(SwitchInOutcome::Triggered {
            source: source_id,
            source_slot: incoming_slot,
            ability_id: resolved.ability_id,
            target_slots,
            mutations,
            attempts,
        })
    }
}

/// Compatibility name for integrations that call switch-in effects through a
/// verb describing the ability rather than the phase boundary.
pub fn evaluate_switch_in_ability(
    battle: &BattleState,
    incoming_slot: FieldSlot,
    content: &ContentPack,
) -> Result<SwitchInOutcome, AbilityPipelineError> {
    evaluate_switch_in(battle, incoming_slot, content)
}

/// Evaluate a caller-supplied defensive ability gate.
///
/// Wonder Guard blocks only Physical/Special moves whose complete B04 result
/// is not super-effective.  Status moves pass without consulting the native
/// type result.  Both active and global suppression are no-draw pass paths.
pub fn evaluate_defensive_ability(
    input: DefensiveAbilityInput,
    content: &ContentPack,
) -> Result<DefensiveAbilityOutcome, AbilityPipelineError> {
    let resolved = resolve_ability(content, input.ability_id)?;
    evaluate_defensive_resolved_input(input, resolved)
}

fn evaluate_defensive_resolved_input(
    input: DefensiveAbilityInput,
    resolved: ResolvedAbility,
) -> Result<DefensiveAbilityOutcome, AbilityPipelineError> {
    if input.move_category != MoveCategory::Status && input.type_effectiveness.is_immune() {
        return Err(AbilityPipelineError::NativeTypeImmunityTerminal {
            ability_id: input.ability_id,
            type_effectiveness: input.type_effectiveness,
        });
    }

    Ok(evaluate_defensive_resolved(input, resolved))
}

/// Compatibility name for the move pipeline's caller-supplied defensive gate.
pub fn evaluate_defensive_gate(
    input: DefensiveAbilityInput,
    content: &ContentPack,
) -> Result<DefensiveAbilityOutcome, AbilityPipelineError> {
    evaluate_defensive_ability(input, content)
}

/// Evaluate the active ability of the occupant at a defensive target slot.
///
/// This convenience boundary keeps target lookup and suppression extraction in
/// the ability lane while still leaving move/type resolution to the caller.
pub fn evaluate_defensive_ability_for_target(
    battle: &BattleState,
    target_slot: FieldSlot,
    move_category: MoveCategory,
    type_effectiveness: TypeEffectiveness,
    content: &ContentPack,
) -> Result<DefensiveAbilityOutcome, AbilityPipelineError> {
    validate_m3_supported(&battle.format)?;
    validate_slot(&battle.format, target_slot)?;
    battle.field.validate_for_format(&battle.format)?;
    let target_id = battle
        .field
        .occupant(&battle.format, target_slot)?
        .ok_or(AbilityPipelineError::MissingDefensiveTarget { slot: target_slot })?;
    let target = party_pokemon(battle, target_slot.side, target_id).ok_or(
        AbilityPipelineError::MissingPartyPokemon {
            slot: target_slot,
            pokemon: target_id,
            side: target_slot.side,
        },
    )?;

    let input = DefensiveAbilityInput {
        ability_id: target.abilities.active,
        ability_suppressed: target.abilities.active_suppressed,
        global_suppressed: battle.global_ability_suppression.ignore_abilities,
        move_category,
        type_effectiveness,
    };
    let resolved = resolve_ability(content, input.ability_id)?;
    validate_m3_suppression(input.global_suppressed, input.ability_suppressed)?;
    evaluate_defensive_resolved_input(input, resolved)
}

fn validate_m3_suppression(
    global_suppressed: bool,
    ability_suppressed: bool,
) -> Result<(), AbilityPipelineError> {
    if global_suppressed {
        Err(AbilityPipelineError::UnsupportedSuppression {
            reason: AbilitySuppressionReason::Global,
        })
    } else if ability_suppressed {
        Err(AbilityPipelineError::UnsupportedSuppression {
            reason: AbilitySuppressionReason::Active,
        })
    } else {
        Ok(())
    }
}

fn evaluate_defensive_resolved(
    input: DefensiveAbilityInput,
    resolved: ResolvedAbility,
) -> DefensiveAbilityOutcome {
    if !resolved.is_none() && input.global_suppressed {
        return DefensiveAbilityOutcome::Passed {
            ability_id: resolved.ability_id,
            reason: DefensiveAbilityPassReason::Suppressed(AbilitySuppressionReason::Global),
        };
    }
    if !resolved.is_none() && input.ability_suppressed {
        return DefensiveAbilityOutcome::Passed {
            ability_id: resolved.ability_id,
            reason: DefensiveAbilityPassReason::Suppressed(AbilitySuppressionReason::Active),
        };
    }

    match resolved.effect {
        AbilityEffectDefinition::None => DefensiveAbilityOutcome::Passed {
            ability_id: resolved.ability_id,
            reason: DefensiveAbilityPassReason::None,
        },
        AbilityEffectDefinition::PostSummonAdjacentOpponentAttackMinusOne => {
            DefensiveAbilityOutcome::Passed {
                ability_id: resolved.ability_id,
                reason: DefensiveAbilityPassReason::NotApplicable,
            }
        }
        AbilityEffectDefinition::MentalEffectImmunity => DefensiveAbilityOutcome::Passed {
            ability_id: resolved.ability_id,
            reason: DefensiveAbilityPassReason::NotApplicable,
        },
        AbilityEffectDefinition::NonSuperEffectiveAttackImmunity => {
            if input.move_category == MoveCategory::Status {
                return DefensiveAbilityOutcome::Passed {
                    ability_id: resolved.ability_id,
                    reason: DefensiveAbilityPassReason::StatusMove,
                };
            }
            if input.type_effectiveness.is_super_effective() {
                DefensiveAbilityOutcome::Passed {
                    ability_id: resolved.ability_id,
                    reason: DefensiveAbilityPassReason::SuperEffective,
                }
            } else {
                DefensiveAbilityOutcome::Blocked {
                    ability_id: resolved.ability_id,
                    type_effectiveness: input.type_effectiveness,
                }
            }
        }
    }
}

fn party_pokemon(battle: &BattleState, side: BattleSide, id: PokemonId) -> Option<&PokemonState> {
    match side {
        BattleSide::Player => battle.player_party.iter().find(|pokemon| pokemon.id == id),
        BattleSide::Enemy => battle.enemy_party.iter().find(|pokemon| pokemon.id == id),
    }
}
