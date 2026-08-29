//! Shared atomic battle-transition surface owned by M3 integration.

use er_canonical::{CanonicalError, content_digest};
use er_rng::audit::RngDraw;
use er_rng::battle::BattleRngState;
use er_state::battle::BattleState;
use er_state::digest::MechanicalStateDigest;
use er_state::pokemon::PokemonState;
use er_state::snapshot::GameState;
use er_types::SafeU53;
use er_types::battle_command::{CommandCollectionState, CommandSet, ReplacementSelection};
use er_types::battle_ids::{
    FaintOccurrenceId, FieldSlot, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex,
};
use er_types::battle_model::{
    BattleOutcome, BattleStat, FaintOccurrence, ReplacementProgress, ResolvedAction, StatStages,
    StatusState,
};
use er_types::battle_ui::{
    BattlePresentationEvent, PRESENTATION_PLAN_DIGEST_PREFIX, PresentationPlanDigest,
    PresentationPlanDigestError,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::error::BattleInvariantError;

/// Domain included in every M3 presentation-plan digest preimage.
pub const PRESENTATION_PLAN_DIGEST_DOMAIN: &str = "pokerogue-redux/m3/presentation-plan/v1";

/// Failure to canonicalize or construct a typed presentation-plan digest.
#[derive(Debug, Error)]
pub enum PresentationPlanDigestComputationError {
    #[error("presentation plan canonicalization failed: {0}")]
    Canonical(#[from] CanonicalError),
    #[error("presentation plan digest representation is invalid: {0}")]
    Representation(#[from] PresentationPlanDigestError),
}

#[derive(Serialize)]
struct PresentationPlanDigestPreimage<'a> {
    domain: &'static str,
    presentation: &'a [BattlePresentationEvent],
}

/// Compute the frozen domain-separated digest of an ordered typed plan.
pub fn compute_presentation_plan_digest(
    presentation: &[BattlePresentationEvent],
) -> Result<PresentationPlanDigest, PresentationPlanDigestComputationError> {
    let raw = content_digest(&PresentationPlanDigestPreimage {
        domain: PRESENTATION_PLAN_DIGEST_DOMAIN,
        presentation,
    })?;
    Ok(PresentationPlanDigest::new(format!(
        "{PRESENTATION_PLAN_DIGEST_PREFIX}{raw}"
    ))?)
}

/// Ordered mechanical evidence for one atomic battle transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BattleMutation {
    PpChanged {
        pokemon: PokemonId,
        move_slot: MoveSlotIndex,
        before: u16,
        after: u16,
    },
    HpChanged {
        pokemon: PokemonId,
        before: u32,
        after: u32,
    },
    StatusChanged {
        pokemon: PokemonId,
        before: StatusState,
        after: StatusState,
    },
    StatStageChanged {
        pokemon: PokemonId,
        stat: BattleStat,
        before: i8,
        after: i8,
    },
    FieldChanged {
        slot: FieldSlot,
        before: Option<PokemonId>,
        after: Option<PokemonId>,
    },
    CommandCollectionChanged {
        before: CommandCollectionState,
        after: CommandCollectionState,
    },
    FaintQueued {
        occurrence: FaintOccurrence,
    },
    FaintProgressChanged {
        occurrence: FaintOccurrenceId,
        before: ReplacementProgress,
        after: ReplacementProgress,
    },
    FaintResolved {
        occurrence: FaintOccurrenceId,
    },
    BattleRngChanged {
        before: BattleRngState,
        after: BattleRngState,
    },
    TurnAdvanced {
        before: TurnIndex,
        after: TurnIndex,
    },
    OutcomeChanged {
        before: BattleOutcome,
        after: BattleOutcome,
    },
}

/// Replay ordered mutation evidence from the complete before-state and require
/// the exact complete candidate after-state. The first bad mutation reports
/// its zero-based index; a residual state difference after replay reports the
/// frontier immediately after the final mutation (`mutations.len()`).
pub fn validate_battle_mutation_evidence(
    before: &GameState,
    after: &GameState,
    mutations: &[BattleMutation],
) -> Result<(), BattleInvariantError> {
    let mut replay = before.clone();
    for (index, mutation) in mutations.iter().enumerate() {
        if !causal_mutation_order_is_valid(&replay, mutations, index)
            || !apply_evidence_mutation(&mut replay, mutation)
        {
            return Err(BattleInvariantError::mutation_evidence_mismatch(index));
        }
    }
    if replay != *after {
        return Err(BattleInvariantError::mutation_evidence_mismatch(
            mutations.len(),
        ));
    }
    Ok(())
}

fn causal_mutation_order_is_valid(
    state: &GameState,
    mutations: &[BattleMutation],
    index: usize,
) -> bool {
    let Some(battle) = state.battle.as_ref() else {
        return false;
    };
    let Some(mutation) = mutations.get(index) else {
        return false;
    };

    match mutation {
        BattleMutation::FaintProgressChanged {
            occurrence,
            before,
            after,
        } => {
            let Some(head) = unresolved_faint_head(battle) else {
                return false;
            };
            if head.id != *occurrence
                || head.replacement != *before
                || *before != ReplacementProgress::Pending
                || field_occupant(battle, head.slot) != Some(Some(head.pokemon))
            {
                return false;
            }
            let expected_after = match *after {
                ReplacementProgress::Selected {
                    party_slot,
                    pokemon,
                } if selected_replacement_is_bound(battle, head, party_slot, pokemon, true) => {
                    Some(pokemon)
                }
                ReplacementProgress::NoLegalReplacement => None,
                _ => return false,
            };
            matches!(
                (mutations.get(index + 1), mutations.get(index + 2)),
                (
                    Some(BattleMutation::FieldChanged {
                        slot,
                        before: Some(before_pokemon),
                        after,
                    }),
                    Some(BattleMutation::FaintResolved {
                        occurrence: resolved,
                    }),
                ) if *slot == head.slot
                    && *before_pokemon == head.pokemon
                    && *after == expected_after
                    && *resolved == head.id
            )
        }
        BattleMutation::FieldChanged {
            slot,
            before,
            after,
        } => {
            let matching_unresolved = battle.faint_queue.iter().find(|stored| {
                stored.replacement != ReplacementProgress::Applied && stored.slot == *slot
            });
            let Some(stored) = matching_unresolved else {
                return true;
            };
            let Some(head) = unresolved_faint_head(battle) else {
                return false;
            };
            let Some(expected_after) = replacement_field_occupant(battle, head) else {
                return false;
            };
            stored.id == head.id
                && *before == Some(head.pokemon)
                && *after == expected_after
                && matches!(
                    mutations.get(index + 1),
                    Some(BattleMutation::FaintResolved { occurrence })
                        if *occurrence == head.id
                )
        }
        BattleMutation::FaintResolved { occurrence } => {
            let Some(head) = unresolved_faint_head(battle) else {
                return false;
            };
            let Some(expected_after) = replacement_field_occupant(battle, head) else {
                return false;
            };
            head.id == *occurrence
                && field_occupant(battle, head.slot) == Some(expected_after)
                && matches!(
                    index.checked_sub(1).and_then(|previous| mutations.get(previous)),
                    Some(BattleMutation::FieldChanged {
                        slot,
                        before: Some(before_pokemon),
                        after,
                    }) if *slot == head.slot
                        && *before_pokemon == head.pokemon
                        && *after == expected_after
                )
        }
        BattleMutation::BattleRngChanged { before, after } => {
            if before.battle_seed != after.battle_seed {
                return false;
            }
            let before_turn = before.turn.get().get();
            let after_turn = after.turn.get().get();
            if after_turn == before_turn {
                return true;
            }
            before_turn.checked_add(1) == Some(after_turn)
                && after.saved_substream.is_none()
                && matches!(
                    mutations.get(index + 1),
                    Some(BattleMutation::TurnAdvanced {
                        before: turn_before,
                        after: turn_after,
                    }) if *turn_before == before.turn && *turn_after == after.turn
                )
        }
        BattleMutation::TurnAdvanced { before, after } => {
            before.get().get().checked_add(1) == Some(after.get().get())
                && battle.battle_rng.turn == *after
                && matches!(
                    index.checked_sub(1).and_then(|previous| mutations.get(previous)),
                    Some(BattleMutation::BattleRngChanged {
                        before: rng_before,
                        after: rng_after,
                    }) if rng_before.turn == *before && rng_after == &battle.battle_rng
                )
        }
        _ => true,
    }
}

fn unresolved_faint_head(battle: &BattleState) -> Option<&FaintOccurrence> {
    battle
        .faint_queue
        .iter()
        .find(|stored| stored.replacement != ReplacementProgress::Applied)
}

fn field_occupant(battle: &BattleState, slot: FieldSlot) -> Option<Option<PokemonId>> {
    battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == slot)
        .map(|entry| entry.occupant)
}

fn replacement_field_occupant(
    battle: &BattleState,
    occurrence: &FaintOccurrence,
) -> Option<Option<PokemonId>> {
    match occurrence.replacement {
        ReplacementProgress::Selected {
            party_slot,
            pokemon,
        } if selected_replacement_is_bound(battle, occurrence, party_slot, pokemon, false) => {
            Some(Some(pokemon))
        }
        ReplacementProgress::NoLegalReplacement | ReplacementProgress::NotRequired => Some(None),
        ReplacementProgress::Pending | ReplacementProgress::Applied => None,
        ReplacementProgress::Selected { .. } => None,
    }
}

fn selected_replacement_is_bound(
    battle: &BattleState,
    occurrence: &FaintOccurrence,
    party_slot: PartyIndex,
    pokemon: PokemonId,
    require_off_field: bool,
) -> bool {
    let Some(candidate) = battle.player_party.get(usize::from(party_slot.get())) else {
        return false;
    };
    candidate.id == pokemon
        && candidate.owner_seat == occurrence.owner_seat
        && candidate.hp > 0
        && !candidate.fainted
        && (!require_off_field
            || battle
                .field
                .slots
                .iter()
                .all(|entry| entry.occupant != Some(pokemon)))
}

fn apply_evidence_mutation(state: &mut GameState, mutation: &BattleMutation) -> bool {
    let Some(battle) = state.battle.as_mut() else {
        return false;
    };

    match mutation {
        BattleMutation::PpChanged {
            pokemon,
            move_slot,
            before,
            after,
        } => {
            if before == after {
                return false;
            }
            let Some(pokemon) = pokemon_mut(battle, *pokemon) else {
                return false;
            };
            let Some(slot) = pokemon
                .moves
                .get_mut(usize::from(move_slot.get()))
                .and_then(Option::as_mut)
            else {
                return false;
            };
            if slot.pp_used != *before {
                return false;
            }
            slot.pp_used = *after;
            true
        }
        BattleMutation::HpChanged {
            pokemon,
            before,
            after,
        } => {
            if before == after {
                return false;
            }
            let Some(pokemon) = pokemon_mut(battle, *pokemon) else {
                return false;
            };
            if pokemon.hp != *before {
                return false;
            }
            pokemon.hp = *after;
            pokemon.fainted = *after == 0;
            true
        }
        BattleMutation::StatusChanged {
            pokemon,
            before,
            after,
        } => {
            if before == after {
                return false;
            }
            let Some(pokemon) = pokemon_mut(battle, *pokemon) else {
                return false;
            };
            if pokemon.status != *before {
                return false;
            }
            pokemon.status = *after;
            true
        }
        BattleMutation::StatStageChanged {
            pokemon,
            stat,
            before,
            after,
        } => {
            if before == after {
                return false;
            }
            let Some(pokemon) = pokemon_mut(battle, *pokemon) else {
                return false;
            };
            let stage = stage_mut(&mut pokemon.stat_stages, *stat);
            if *stage != *before {
                return false;
            }
            *stage = *after;
            true
        }
        BattleMutation::FieldChanged {
            slot,
            before,
            after,
        } => {
            if before == after {
                return false;
            }
            let Some(entry) = battle
                .field
                .slots
                .iter_mut()
                .find(|entry| entry.slot == *slot)
            else {
                return false;
            };
            if entry.occupant != *before {
                return false;
            }
            entry.occupant = *after;
            true
        }
        BattleMutation::CommandCollectionChanged { before, after } => {
            if before == after || battle.command_state != *before {
                return false;
            }
            battle.command_state = after.clone();
            true
        }
        BattleMutation::FaintQueued { occurrence } => {
            if battle.next_faint_occurrence != occurrence.id
                || battle
                    .faint_queue
                    .iter()
                    .any(|stored| stored.id == occurrence.id)
            {
                return false;
            }
            let Some(next) = occurrence
                .id
                .get()
                .get()
                .checked_add(1)
                .and_then(|value| SafeU53::new(value).ok())
                .map(FaintOccurrenceId::new)
            else {
                return false;
            };
            battle.faint_queue.push(*occurrence);
            battle.next_faint_occurrence = next;
            true
        }
        BattleMutation::FaintProgressChanged {
            occurrence,
            before,
            after,
        } => {
            if before == after {
                return false;
            }
            let Some(stored) = battle
                .faint_queue
                .iter_mut()
                .find(|stored| stored.replacement != ReplacementProgress::Applied)
            else {
                return false;
            };
            if stored.id != *occurrence || stored.replacement != *before {
                return false;
            }
            stored.replacement = *after;
            true
        }
        BattleMutation::FaintResolved { occurrence } => {
            let Some(stored) = battle
                .faint_queue
                .iter_mut()
                .find(|stored| stored.replacement != ReplacementProgress::Applied)
            else {
                return false;
            };
            if stored.id != *occurrence
                || !matches!(
                    stored.replacement,
                    ReplacementProgress::NotRequired
                        | ReplacementProgress::Selected { .. }
                        | ReplacementProgress::NoLegalReplacement
                )
            {
                return false;
            }
            stored.replacement = ReplacementProgress::Applied;
            true
        }
        BattleMutation::BattleRngChanged { before, after } => {
            if before == after || battle.battle_rng != *before {
                return false;
            }
            battle.battle_rng = after.clone();
            true
        }
        BattleMutation::TurnAdvanced { before, after } => {
            if before.get().get().checked_add(1) != Some(after.get().get())
                || battle.turn != *before
                || battle.battle_rng.turn != *after
            {
                return false;
            }
            battle.turn = *after;
            true
        }
        BattleMutation::OutcomeChanged { before, after } => {
            if before == after || battle.outcome != *before {
                return false;
            }
            battle.outcome = *after;
            true
        }
    }
}

fn pokemon_mut(battle: &mut BattleState, id: PokemonId) -> Option<&mut PokemonState> {
    let party = if battle
        .player_party
        .iter()
        .any(|candidate| candidate.id == id)
    {
        &mut battle.player_party
    } else {
        &mut battle.enemy_party
    };
    party.iter_mut().find(|candidate| candidate.id == id)
}

fn stage_mut(stages: &mut StatStages, stat: BattleStat) -> &mut i8 {
    match stat {
        BattleStat::Attack => &mut stages.attack,
        BattleStat::Defense => &mut stages.defense,
        BattleStat::SpecialAttack => &mut stages.special_attack,
        BattleStat::SpecialDefense => &mut stages.special_defense,
        BattleStat::Speed => &mut stages.speed,
        BattleStat::Accuracy => &mut stages.accuracy,
        BattleStat::Evasion => &mut stages.evasion,
    }
}

/// Exact logical decision that follows a successful battle transition.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum BattleNextDecision {
    CommandFrontier,
    Replacement { occurrence: FaintOccurrenceId },
    Complete(BattleOutcome),
}

/// Complete pure result of resolving one admitted turn.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BattleTransition {
    pub before_state: GameState,
    pub after_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub accepted_commands: CommandSet,
    pub action_order: Vec<ResolvedAction>,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub rng_audit: Vec<RngDraw>,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
}

/// Complete pure result of applying one stored faint replacement decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BattleReplacementTransition {
    pub before_state: GameState,
    pub after_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub occurrence: FaintOccurrence,
    pub selection: ReplacementSelection,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
}
