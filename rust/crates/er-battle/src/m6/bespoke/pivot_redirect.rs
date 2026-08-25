//! Pure pivot/trap/redirection/Commander transitions for the
//! SWITCH_TRAP_REDIRECT bespoke family.
//!
//! This module is the planning layer between typed family facts and the
//! atomic battle transition. It validates topology and stable identities,
//! clones the canonical [`PivotRedirectStateV2`], computes the updated state,
//! and returns it together with ordered [`StagedPivotRedirectOperation`]s;
//! it never mutates its inputs and never assumes fixed battler indices —
//! every participant is a stable field slot plus expected occupant.
//!
//! Immunity decisions (Rage Powder versus Grass types, powder immunity,
//! forced-switch immunities, Ghost-type escape) are supplied as closed typed
//! facts by the caller; this layer owns precedence, legality, occupancy, and
//! cleanup semantics. Redirection changes the target set, never the actor or
//! command identity.

use std::collections::{BTreeMap, BTreeSet};

use thiserror::Error;

use er_state::bespoke_v2::pivot_redirect::{
    OccupantIdentity, PivotIntentState, PivotKind, PivotRedirectStateError, PivotRedirectStateV2,
    RedirectDirectiveState, RedirectKind, TrapInstanceState,
};
use er_types::battle_ids::{FieldSlot, PokemonId};

/// Occupancy facts for one field slot in the validated topology snapshot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OccupantFacts {
    pub occupant: Option<PokemonId>,
    pub fainted: bool,
}

/// Explicit slot-topology snapshot consumed by every transition in this
/// module. There is no singles/doubles/triples enum here: capacity and
/// adjacency stay with the battle-format topology.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TopologyFacts {
    pub slots: BTreeMap<FieldSlot, OccupantFacts>,
}

impl TopologyFacts {
    /// Validates the one-occupant invariant: a Pokémon may anchor to at most
    /// one field slot.
    pub fn validate(&self) -> Result<(), PivotRedirectError> {
        let mut seen = BTreeSet::new();
        for facts in self.slots.values() {
            if let Some(pokemon) = facts.occupant {
                if !seen.insert(pokemon) {
                    return Err(PivotRedirectError::DuplicateFieldOccupant { pokemon });
                }
            }
        }
        Ok(())
    }

    pub fn occupant(&self, slot: FieldSlot) -> Option<PokemonId> {
        self.slots.get(&slot).and_then(|facts| facts.occupant)
    }

    fn is_fainted(&self, slot: FieldSlot) -> Option<bool> {
        self.slots.get(&slot).map(|facts| facts.fainted)
    }

    fn has_field_occupant(&self, pokemon: PokemonId) -> bool {
        self.slots
            .values()
            .any(|facts| facts.occupant == Some(pokemon))
    }

    /// Resolves a stable identity against live occupancy: the slot must
    /// still hold the expected Pokémon.
    pub fn resolve_identity(&self, identity: &OccupantIdentity) -> Result<(), PivotRedirectError> {
        match self.slots.get(&identity.slot) {
            None => Err(PivotRedirectError::UnknownSlot {
                slot: identity.slot,
            }),
            Some(facts) if facts.occupant == Some(identity.pokemon) => {
                if facts.fainted {
                    Err(PivotRedirectError::ParticipantFainted {
                        pokemon: identity.pokemon,
                    })
                } else {
                    Ok(())
                }
            }
            Some(facts) => Err(PivotRedirectError::StaleIdentity {
                expected: *identity,
                actual: facts.occupant,
            }),
        }
    }
}

/// Typed facts for one redirect candidate drawn this turn.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedirectCandidateFacts {
    pub directive: RedirectDirectiveState,
    /// Closed immunity verdict for this candidate against the incoming
    /// action's actor (for example Rage Powder never draws Grass-typed or
    /// powder-immune attackers).
    pub attacker_immune: bool,
    /// The incoming action bypasses redirection entirely.
    pub bypassed: bool,
}

/// Typed request for one redirection decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedirectRequestFacts {
    pub actor: OccupantIdentity,
    pub original_target: OccupantIdentity,
    /// The incoming move carries an explicit bypass attribute.
    pub bypass_redirect: bool,
    pub candidates: Vec<RedirectCandidateFacts>,
}

/// Why a candidate lost the redirection fold, in fold order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RedirectRejectionReason {
    AttackerImmune,
    Bypassed,
    SourceUnavailable,
    Superseded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RejectedRedirect {
    pub source: OccupantIdentity,
    pub kind: RedirectKind,
    pub reason: RedirectRejectionReason,
}

/// One completed redirection fold. `new_target` replaces the original
/// target for the incoming action only; the actor keeps its command.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedirectResolution {
    pub new_target: Option<OccupantIdentity>,
    pub winner: Option<RedirectDirectiveState>,
    pub rejected: Vec<RejectedRedirect>,
}

/// Resolves one redirection decision in deterministic order: candidates
/// survive immunity, bypass, and availability filters, then win by frozen
/// precedence tier descending and declaration ordinal ascending. No legal
/// candidate yields `new_target: None`; the original target stands.
pub fn resolve_redirect(
    topology: &TopologyFacts,
    request: &RedirectRequestFacts,
) -> Result<RedirectResolution, PivotRedirectError> {
    topology.validate()?;
    topology.resolve_identity(&request.actor)?;

    let mut rejected = Vec::new();
    let mut eligible: Vec<&RedirectCandidateFacts> = Vec::new();
    for candidate in &request.candidates {
        if request.bypass_redirect || candidate.bypassed {
            rejected.push(RejectedRedirect {
                source: candidate.directive.source,
                kind: candidate.directive.kind,
                reason: RedirectRejectionReason::Bypassed,
            });
            continue;
        }
        let available = topology
            .resolve_identity(&candidate.directive.source)
            .is_ok();
        if !available {
            rejected.push(RejectedRedirect {
                source: candidate.directive.source,
                kind: candidate.directive.kind,
                reason: RedirectRejectionReason::SourceUnavailable,
            });
            continue;
        }
        if candidate.attacker_immune {
            rejected.push(RejectedRedirect {
                source: candidate.directive.source,
                kind: candidate.directive.kind,
                reason: RedirectRejectionReason::AttackerImmune,
            });
            continue;
        }
        eligible.push(candidate);
    }

    eligible.sort_by_key(|candidate| candidate.directive.resolution_key());
    let Some(winner) = eligible.first() else {
        return Ok(RedirectResolution {
            new_target: None,
            winner: None,
            rejected,
        });
    };
    let winner_directive = winner.directive.clone();
    let new_target = winner_directive.source;
    for candidate in &eligible[1..] {
        rejected.push(RejectedRedirect {
            source: candidate.directive.source,
            kind: candidate.directive.kind,
            reason: RedirectRejectionReason::Superseded,
        });
    }
    Ok(RedirectResolution {
        new_target: Some(new_target),
        winner: Some(winner_directive),
        rejected,
    })
}

/// Typed escape-route facts supplied by the caller.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EscapeFacts {
    pub subject: OccupantIdentity,
    /// Ghost-type Pokémon ignore trapping.
    pub ghost_type: bool,
    /// A held escape artifact (Shed Shell family) permits leaving traps.
    pub escape_artifact: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EscapeReason {
    Untrapped,
    GhostType,
    EscapeArtifact,
}

/// Escape-legality verdict for one subject.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscapeDecision {
    Allowed { reasons: Vec<EscapeReason> },
    Denied { trap: TrapInstanceState },
}

/// A trap is live while its ownerless anchor persists or its trapper still
/// occupies the recorded slot with the recorded Pokémon and has not fainted.
fn trap_is_live(topology: &TopologyFacts, trap: &TrapInstanceState) -> bool {
    match trap.trapper {
        None => true,
        Some(trapper) => {
            topology.occupant(trapper.slot) == Some(trapper.pokemon)
                && topology.is_fainted(trapper.slot) == Some(false)
        }
    }
}

/// Evaluates trapping escape legality. Live traps deny voluntary escapes
/// unless a typed escape route (Ghost typing or escape artifact) applies.
pub fn evaluate_escape(
    topology: &TopologyFacts,
    state: &PivotRedirectStateV2,
    facts: &EscapeFacts,
) -> Result<EscapeDecision, PivotRedirectError> {
    topology.resolve_identity(&facts.subject)?;
    let mut live_traps = state
        .traps
        .iter()
        .filter(|trap| trap.subject.pokemon == facts.subject.pokemon)
        .filter(|trap| trap_is_live(topology, trap));
    let blocker = live_traps.next().cloned();
    if blocker.is_none() {
        return Ok(EscapeDecision::Allowed {
            reasons: vec![EscapeReason::Untrapped],
        });
    }
    if facts.ghost_type || facts.escape_artifact {
        let mut reasons = Vec::with_capacity(2);
        if facts.ghost_type {
            reasons.push(EscapeReason::GhostType);
        }
        if facts.escape_artifact {
            reasons.push(EscapeReason::EscapeArtifact);
        }
        return Ok(EscapeDecision::Allowed { reasons });
    }
    Ok(EscapeDecision::Denied {
        trap: blocker.expect("blocker checked above"),
    })
}

/// Typed facts for one voluntary or forced pivot request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PivotRequestFacts {
    pub subject: OccupantIdentity,
    pub kind: PivotKind,
    /// Bench Pokémon intended to enter the subject's slot.
    pub replacement: PokemonId,
    /// SwitchEligibility query outcome for the replacement.
    pub replacement_switch_legal: bool,
    /// The subject fainted from the pivot move's damage this turn; the
    /// pivot degrades to fainted-source cleanup.
    pub subject_fainted: bool,
    /// Closed forced-switch immunity verdict (Suction Cups family).
    pub forced_switch_immune: bool,
    pub ghost_type: bool,
    pub escape_artifact: bool,
}

/// Cross-state mutation staged for the owning atomic battle transition.
/// Family-owned state changes travel inside the returned
/// [`PivotRedirectStateV2`] instead.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StagedPivotRedirectOperation {
    /// The incoming action's target set changes; the actor does not.
    RedirectTarget {
        actor: OccupantIdentity,
        original_target: OccupantIdentity,
        new_target: OccupantIdentity,
        directive: RedirectDirectiveState,
    },
    /// Stable slot identity survives the swap: one slot, outgoing and
    /// incoming Pokémon identities.
    PivotOut {
        vacated: FieldSlot,
        outgoing: PokemonId,
        incoming: PokemonId,
    },
    VoluntaryPivotDenied {
        subject: OccupantIdentity,
    },
    ForcedPivotDenied {
        subject: OccupantIdentity,
    },
    /// Commander entry: the commanding Pokémon leaves its slot without
    /// fainting; the slot stays reserved.
    VacateSlot {
        slot: FieldSlot,
        departing: PokemonId,
    },
    /// Commander exit: the commanding Pokémon reclaims its reserved slot.
    EnterSlot {
        slot: FieldSlot,
        arriving: PokemonId,
    },
    CleanupFaintedSource {
        source: PokemonId,
    },
}

/// Complete output of one pivot decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PivotTransition {
    pub operations: Vec<StagedPivotRedirectOperation>,
    pub intent: Option<PivotIntentState>,
    pub state: PivotRedirectStateV2,
}

/// Plans one pivot request. Voluntary pivots pass trapping escape legality;
/// forced pivots ignore trapping but respect typed forced-switch immunity.
/// A fainted subject never pivots: the request degrades to fainted-source
/// cleanup. Pure: the input state is cloned, never mutated.
pub fn plan_pivot(
    topology: &TopologyFacts,
    state: &PivotRedirectStateV2,
    facts: &PivotRequestFacts,
) -> Result<PivotTransition, PivotRedirectError> {
    topology.validate()?;
    if facts.subject_fainted {
        let cleanup = cleanup_fainted_source(topology, state, &facts.subject)?;
        return Ok(PivotTransition {
            operations: cleanup.operations,
            intent: None,
            state: cleanup.state,
        });
    }
    topology.resolve_identity(&facts.subject)?;

    match facts.kind {
        PivotKind::Voluntary => {
            let decision = evaluate_escape(
                topology,
                state,
                &EscapeFacts {
                    subject: facts.subject,
                    ghost_type: facts.ghost_type,
                    escape_artifact: facts.escape_artifact,
                },
            )?;
            if let EscapeDecision::Denied { .. } = decision {
                return Ok(PivotTransition {
                    operations: vec![StagedPivotRedirectOperation::VoluntaryPivotDenied {
                        subject: facts.subject,
                    }],
                    intent: None,
                    state: state.clone(),
                });
            }
        }
        PivotKind::Forced => {
            if facts.forced_switch_immune {
                return Ok(PivotTransition {
                    operations: vec![StagedPivotRedirectOperation::ForcedPivotDenied {
                        subject: facts.subject,
                    }],
                    intent: None,
                    state: state.clone(),
                });
            }
        }
    }

    if !facts.replacement_switch_legal
        || facts.replacement == PokemonId::ZERO
        || facts.replacement == facts.subject.pokemon
        || topology.has_field_occupant(facts.replacement)
    {
        return Err(PivotRedirectError::IllegalReplacement {
            pokemon: facts.replacement,
        });
    }

    let (next_state, intent) = state
        .record_pivot_intent(facts.subject, facts.kind, facts.replacement)
        .map_err(PivotRedirectError::State)?;
    Ok(PivotTransition {
        operations: vec![StagedPivotRedirectOperation::PivotOut {
            vacated: facts.subject.slot,
            outgoing: facts.subject.pokemon,
            incoming: facts.replacement,
        }],
        intent: Some(intent),
        state: next_state,
    })
}

/// Typed facts for one Commander entry attempt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CommanderPairFacts {
    /// The commanding battler; it must already occupy a field slot.
    pub commander: OccupantIdentity,
    /// The host battler on the same side.
    pub host: OccupantIdentity,
}

/// Complete output of one Commander entry or exit decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommanderTransition {
    pub operations: Vec<StagedPivotRedirectOperation>,
    pub state: PivotRedirectStateV2,
}

/// Establishes the Commander occupancy pairing: the commander vacates its
/// slot without fainting, the slot stays reserved, and the host remains in
/// control of its own slot. Pure.
pub fn commander_enter(
    topology: &TopologyFacts,
    state: &PivotRedirectStateV2,
    facts: &CommanderPairFacts,
) -> Result<CommanderTransition, PivotRedirectError> {
    topology.validate()?;
    topology.resolve_identity(&facts.commander)?;
    topology.resolve_identity(&facts.host)?;
    if facts.commander.slot == facts.host.slot {
        return Err(PivotRedirectError::CommanderSameSlot);
    }
    if facts.commander.slot.side != facts.host.slot.side {
        return Err(PivotRedirectError::CommanderCrossSide);
    }
    if state.commander.is_some() {
        return Err(PivotRedirectError::CommanderAlreadyActive);
    }

    let (next_state, _) = state
        .assign_commander(facts.commander.pokemon, facts.commander.slot, facts.host)
        .map_err(PivotRedirectError::State)?;
    Ok(CommanderTransition {
        operations: vec![StagedPivotRedirectOperation::VacateSlot {
            slot: facts.commander.slot,
            departing: facts.commander.pokemon,
        }],
        state: next_state,
    })
}

/// Why the Commander pairing ends.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommanderLeaveTrigger {
    /// The host switched out of its slot.
    HostLeftField,
    /// The host fainted.
    HostFainted,
}

/// Ends the Commander pairing and returns the commander to its reserved
/// slot. `None` means no pairing was active. Pure.
pub fn commander_leave(
    topology: &TopologyFacts,
    state: &PivotRedirectStateV2,
    trigger: CommanderLeaveTrigger,
) -> Result<Option<CommanderTransition>, PivotRedirectError> {
    topology.validate()?;
    let Some(pairing) = &state.commander else {
        return Ok(None);
    };
    if matches!(trigger, CommanderLeaveTrigger::HostLeftField)
        && topology.occupant(pairing.host.slot) == Some(pairing.host.pokemon)
    {
        return Err(PivotRedirectError::HostStillPresent);
    }
    let reserved = topology
        .slots
        .get(&pairing.commander_slot)
        .ok_or(PivotRedirectError::UnknownSlot {
            slot: pairing.commander_slot,
        })?;
    if reserved.occupant.is_some() {
        return Err(PivotRedirectError::CommanderReservedSlotOccupied {
            slot: pairing.commander_slot,
        });
    }

    let next_state = state.clear_commander().map_err(PivotRedirectError::State)?;
    Ok(Some(CommanderTransition {
        operations: vec![StagedPivotRedirectOperation::EnterSlot {
            slot: pairing.commander_slot,
            arriving: pairing.commander,
        }],
        state: next_state,
    }))
}

/// Complete output of one fainted-source cleanup sweep.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CleanupTransition {
    pub released_traps: Vec<TrapInstanceState>,
    pub dropped_redirects: Vec<RedirectDirectiveState>,
    pub dropped_intents: Vec<PivotIntentState>,
    /// Whether the commander left the pairing by returning to its slot.
    pub commander_returned: bool,
    pub operations: Vec<StagedPivotRedirectOperation>,
    pub state: PivotRedirectStateV2,
}

/// Cleans up every family effect anchored to one fainted source: redirects
/// it drew, traps it placed, traps anchoring to it, its staged pivot
/// intents, and its Commander role in either direction. A hosting fainted
/// host sends the commander back to its reserved slot. Pure.
pub fn cleanup_fainted_source(
    topology: &TopologyFacts,
    state: &PivotRedirectStateV2,
    fainted: &OccupantIdentity,
) -> Result<CleanupTransition, PivotRedirectError> {
    topology.validate()?;
    // Cleanup targets a fainted source, so liveness is inverted here: the
    // slot must still anchor the expected Pokémon and it must be fainted.
    let facts_at = topology
        .slots
        .get(&fainted.slot)
        .ok_or(PivotRedirectError::UnknownSlot {
            slot: fainted.slot,
        })?;
    if facts_at.occupant != Some(fainted.pokemon) {
        return Err(PivotRedirectError::StaleIdentity {
            expected: *fainted,
            actual: facts_at.occupant,
        });
    }
    if !facts_at.fainted {
        return Err(PivotRedirectError::NotFainted {
            pokemon: fainted.pokemon,
        });
    }

    let (after_owned_traps, mut released_traps) =
        state.end_traps_owned_by(fainted.pokemon).map_err(PivotRedirectError::State)?;
    let (after_anchored_traps, anchored_traps) =
        after_owned_traps
            .end_traps_on(fainted.pokemon)
            .map_err(PivotRedirectError::State)?;
    released_traps.extend(anchored_traps);
    let (after_redirects, dropped_redirects) = after_anchored_traps
        .drop_redirects_from(fainted.pokemon)
        .map_err(PivotRedirectError::State)?;
    let (after_intents, dropped_intents) = after_intents_step(&after_redirects, fainted.pokemon)?;

    let mut operations =
        vec![StagedPivotRedirectOperation::CleanupFaintedSource {
            source: fainted.pokemon,
        }];
    let mut commander_returned = false;
    let mut final_state = after_intents;
    if let Some(pairing) = final_state.commander.clone() {
        if pairing.host.pokemon == fainted.pokemon {
            let reserved = topology
                .slots
                .get(&pairing.commander_slot)
                .ok_or(PivotRedirectError::UnknownSlot {
                    slot: pairing.commander_slot,
                })?;
            if reserved.occupant.is_some() {
                return Err(PivotRedirectError::CommanderReservedSlotOccupied {
                    slot: pairing.commander_slot,
                });
            }
            operations.push(StagedPivotRedirectOperation::EnterSlot {
                slot: pairing.commander_slot,
                arriving: pairing.commander,
            });
            commander_returned = true;
        }
        final_state = final_state.clear_commander().map_err(PivotRedirectError::State)?;
    }

    Ok(CleanupTransition {
        released_traps,
        dropped_redirects,
        dropped_intents,
        commander_returned,
        operations,
        state: final_state,
    })
}

/// Applies one pivot intent from canonical state once the atomic transition
/// confirmed the swap: drops the staged intent and ages timed traps. Pure.
pub fn settle_pivot_intent(
    state: &PivotRedirectStateV2,
    subject: PokemonId,
) -> Result<PivotRedirectStateV2, PivotRedirectError> {
    let (without_intent, _) = state
        .drop_intents_for(subject)
        .map_err(PivotRedirectError::State)?;
    let (settled, _) = without_intent
        .tick_traps()
        .map_err(PivotRedirectError::State)?;
    Ok(settled)
}

fn after_intents_step(
    state: &PivotRedirectStateV2,
    subject: PokemonId,
) -> Result<(PivotRedirectStateV2, Vec<PivotIntentState>), PivotRedirectError> {
    state.drop_intents_for(subject).map_err(PivotRedirectError::State)
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PivotRedirectError {
    #[error("Pokémon {pokemon} would occupy more than one field slot")]
    DuplicateFieldOccupant { pokemon: PokemonId },
    #[error("field slot {slot:?} is not part of the validated topology")]
    UnknownSlot { slot: FieldSlot },
    #[error("stable identity at {expected:?} is stale; slot now holds {actual:?}")]
    StaleIdentity {
        expected: OccupantIdentity,
        actual: Option<PokemonId>,
    },
    #[error("Pokémon {pokemon} has fainted and cannot act")]
    ParticipantFainted { pokemon: PokemonId },
    #[error("Pokémon {pokemon} has not fainted; cleanup requires a fainted source")]
    NotFainted { pokemon: PokemonId },
    #[error("commander pairing is already active")]
    CommanderAlreadyActive,
    #[error("commander and host must occupy distinct slots")]
    CommanderSameSlot,
    #[error("commander and host must share one side of the field")]
    CommanderCrossSide,
    #[error("reserved commander slot {slot:?} is no longer vacant")]
    CommanderReservedSlotOccupied { slot: FieldSlot },
    #[error("host still occupies its slot; the pairing cannot end through this trigger")]
    HostStillPresent,
    #[error("Pokémon {pokemon} is not a legal pivot replacement")]
    IllegalReplacement { pokemon: PokemonId },
    #[error("family state rejected the transition: {0}")]
    State(#[from] PivotRedirectStateError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::pivot_redirect::{RedirectKind, TrapKind};
    use er_types::battle_ids::BattleSide;

    const PLAYER: BattleSide = BattleSide::Player;
    const ENEMY: BattleSide = BattleSide::Enemy;

    fn slot(side: BattleSide, position: u8) -> FieldSlot {
        FieldSlot { side, position }
    }

    fn ident(side: BattleSide, position: u8, pokemon: u64) -> OccupantIdentity {
        OccupantIdentity::new(
            slot(side, position),
            PokemonId::try_from_u64(pokemon).expect("pokemon id"),
        )
    }

    fn poke(id: u64) -> PokemonId {
        PokemonId::try_from_u64(id).expect("pokemon id")
    }

    /// Builds a doubles topology: `(side, position, pokemon_id, fainted)`;
    /// `pokemon_id == 0` marks an unoccupied slot.
    fn doubles_topology(entries: &[(BattleSide, u8, u64, bool)]) -> TopologyFacts {
        let mut slots = BTreeMap::new();
        for (side, position, pokemon, fainted) in entries {
            slots.insert(
                slot(*side, *position),
                OccupantFacts {
                    occupant: if *pokemon == 0 { None } else { Some(poke(*pokemon)) },
                    fainted: *fainted,
                },
            );
        }
        TopologyFacts { slots }
    }

    fn fresh_state() -> PivotRedirectStateV2 {
        PivotRedirectStateV2::default()
    }

    #[test]
    fn higher_precedence_wins_and_ties_break_by_declaration_order() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 11, false),
            (ENEMY, 0, 20, false),
            (ENEMY, 1, 21, false),
        ]);
        let state = fresh_state();
        let (state, follow_me) = state
            .admit_redirect(ident(ENEMY, 0, 20), RedirectKind::FollowMe)
            .expect("admit follow me");
        let (state, rage_powder) = state
            .admit_redirect(ident(ENEMY, 1, 21), RedirectKind::RagePowder)
            .expect("admit rage powder");
        let (state, type_directed) = state
            .admit_redirect(ident(PLAYER, 0, 10), RedirectKind::TypeDirected)
            .expect("admit type-directed");
        assert!(type_directed.creation_ordinal > rage_powder.creation_ordinal);

        // Type-directed outranks both powder/follow-me tiers despite being
        // declared last.
        let resolution = resolve_redirect(
            &topology,
            &RedirectRequestFacts {
                actor: ident(PLAYER, 1, 11),
                original_target: ident(ENEMY, 0, 20),
                bypass_redirect: false,
                candidates: vec![
                    RedirectCandidateFacts {
                        directive: follow_me.clone(),
                        attacker_immune: false,
                        bypassed: false,
                    },
                    RedirectCandidateFacts {
                        directive: rage_powder.clone(),
                        attacker_immune: false,
                        bypassed: false,
                    },
                    RedirectCandidateFacts {
                        directive: type_directed.clone(),
                        attacker_immune: false,
                        bypassed: false,
                    },
                ],
            },
        )
        .expect("redirect resolves");
        assert_eq!(resolution.winner.as_ref(), Some(&type_directed));
        assert_eq!(resolution.new_target, Some(ident(PLAYER, 0, 10)));

        // Same-tier ties break by declaration order: follow me (earlier)
        // beats rage powder.
        let resolution = resolve_redirect(
            &topology,
            &RedirectRequestFacts {
                actor: ident(PLAYER, 1, 11),
                original_target: ident(ENEMY, 0, 20),
                bypass_redirect: false,
                candidates: vec![
                    RedirectCandidateFacts {
                        directive: follow_me.clone(),
                        attacker_immune: false,
                        bypassed: false,
                    },
                    RedirectCandidateFacts {
                        directive: rage_powder.clone(),
                        attacker_immune: false,
                        bypassed: false,
                    },
                ],
            },
        )
        .expect("redirect resolves");
        assert_eq!(resolution.winner.as_ref(), Some(&follow_me));
        assert_eq!(
            resolution.rejected,
            vec![RejectedRedirect {
                source: rage_powder.source,
                kind: RedirectKind::RagePowder,
                reason: RedirectRejectionReason::Superseded,
            }]
        );
    }

    #[test]
    fn rage_powder_immunity_supplied_as_fact_falls_back_to_follow_me() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (ENEMY, 0, 20, false),
            (ENEMY, 1, 21, false),
        ]);
        let state = fresh_state();
        let (state, follow_me) = state
            .admit_redirect(ident(ENEMY, 0, 20), RedirectKind::FollowMe)
            .expect("admit follow me");
        let (_, rage_powder) = state
            .admit_redirect(ident(ENEMY, 1, 21), RedirectKind::RagePowder)
            .expect("admit rage powder");

        let resolution = resolve_redirect(
            &topology,
            &RedirectRequestFacts {
                actor: ident(PLAYER, 0, 10),
                original_target: ident(ENEMY, 0, 20),
                bypass_redirect: false,
                candidates: vec![
                    RedirectCandidateFacts {
                        directive: rage_powder.clone(),
                        attacker_immune: true,
                        bypassed: false,
                    },
                    RedirectCandidateFacts {
                        directive: follow_me.clone(),
                        attacker_immune: false,
                        bypassed: false,
                    },
                ],
            },
        )
        .expect("redirect resolves");
        assert_eq!(resolution.winner.as_ref(), Some(&follow_me));
        assert_eq!(resolution.rejected[0].reason, RedirectRejectionReason::AttackerImmune);
    }

    #[test]
    fn no_legal_redirect_leaves_the_original_target() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (ENEMY, 0, 20, false),
            (ENEMY, 1, 21, false),
        ]);
        let state = fresh_state();
        let (state, rage_powder) = state
            .admit_redirect(ident(ENEMY, 1, 21), RedirectKind::RagePowder)
            .expect("admit rage powder");

        // Every route blocked: explicit bypass wins over any candidate.
        let resolution = resolve_redirect(
            &topology,
            &RedirectRequestFacts {
                actor: ident(PLAYER, 0, 10),
                original_target: ident(ENEMY, 0, 20),
                bypass_redirect: true,
                candidates: vec![RedirectCandidateFacts {
                    directive: rage_powder.clone(),
                    attacker_immune: false,
                    bypassed: false,
                }],
            },
        )
        .expect("redirect resolves");
        assert_eq!(resolution.new_target, None);
        assert_eq!(resolution.winner, None);
        assert_eq!(resolution.rejected[0].reason, RedirectRejectionReason::Bypassed);

        // Immune attacker plus a fainted source: nothing legal remains.
        let fainted_topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (ENEMY, 0, 20, true),
            (ENEMY, 1, 21, false),
        ]);
        let (state, follow_me) = state
            .admit_redirect(ident(ENEMY, 0, 20), RedirectKind::FollowMe)
            .expect("admit follow me");
        let resolution = resolve_redirect(
            &fainted_topology,
            &RedirectRequestFacts {
                actor: ident(PLAYER, 0, 10),
                original_target: ident(ENEMY, 0, 20),
                bypass_redirect: false,
                candidates: vec![
                    RedirectCandidateFacts {
                        directive: rage_powder.clone(),
                        attacker_immune: true,
                        bypassed: false,
                    },
                    RedirectCandidateFacts {
                        directive: follow_me.clone(),
                        attacker_immune: false,
                        bypassed: false,
                    },
                ],
            },
        )
        .expect("redirect resolves");
        assert_eq!(resolution.new_target, None);
        assert_eq!(resolution.winner, None);
    }

    #[test]
    fn trap_denies_escape_until_typed_routes_apply() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 11, false),
            (ENEMY, 0, 20, false),
        ]);
        let state = fresh_state();
        let trapper = ident(ENEMY, 0, 20);
        let subject = ident(PLAYER, 1, 11);
        let (state, trap) = state
            .admit_trap(TrapKind::Binding, subject, Some(trapper), None)
            .expect("admit trap");

        let escape_facts = |ghost: bool, artifact: bool| EscapeFacts {
            subject,
            ghost_type: ghost,
            escape_artifact: artifact,
        };

        let decision =
            evaluate_escape(&topology, &state, &escape_facts(false, false)).expect("evaluate");
        assert_eq!(decision, EscapeDecision::Denied { trap: trap.clone() });

        let decision =
            evaluate_escape(&topology, &state, &escape_facts(true, false)).expect("evaluate");
        assert_eq!(
            decision,
            EscapeDecision::Allowed {
                reasons: vec![EscapeReason::GhostType]
            }
        );

        let decision =
            evaluate_escape(&topology, &state, &escape_facts(false, true)).expect("evaluate");
        assert_eq!(
            decision,
            EscapeDecision::Allowed {
                reasons: vec![EscapeReason::EscapeArtifact]
            }
        );

        // A stale trapper (replaced on its slot) leaves the trap inert.
        let swapped_topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 11, false),
            (ENEMY, 0, 99, false),
        ]);
        let decision = evaluate_escape(
            &swapped_topology,
            &state,
            &escape_facts(false, false),
        )
        .expect("evaluate");
        assert_eq!(
            decision,
            EscapeDecision::Allowed {
                reasons: vec![EscapeReason::Untrapped]
            }
        );
    }

    #[test]
    fn voluntary_pivot_after_hit_records_intent_and_preserves_slot_identity() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 11, false),
            (ENEMY, 0, 20, false),
        ]);
        let state = fresh_state();
        let (state, trap) = state
            .admit_trap(TrapKind::Binding, ident(PLAYER, 0, 10), None, Some(2))
            .expect("admit arena-style trap");

        let transition = plan_pivot(
            &topology,
            &state,
            &PivotRequestFacts {
                subject: ident(PLAYER, 0, 10),
                kind: PivotKind::Voluntary,
                replacement: poke(30),
                replacement_switch_legal: true,
                subject_fainted: false,
                forced_switch_immune: false,
                ghost_type: false,
                escape_artifact: false,
            },
        );
        // Trapped without escape routes: denied, state unchanged.
        let denied = transition.expect("voluntary pivot evaluates");
        assert_eq!(
            denied.operations,
            vec![StagedPivotRedirectOperation::VoluntaryPivotDenied {
                subject: ident(PLAYER, 0, 10),
            }]
        );
        assert_eq!(denied.intent, None);
        assert_eq!(denied.state.traps, vec![trap]);

        // With the escape artifact the same pivot proceeds and preserves
        // the slot identity through the swap.
        let transition = plan_pivot(
            &topology,
            &state,
            &PivotRequestFacts {
                subject: ident(PLAYER, 0, 10),
                kind: PivotKind::Voluntary,
                replacement: poke(30),
                replacement_switch_legal: true,
                subject_fainted: false,
                forced_switch_immune: false,
                ghost_type: false,
                escape_artifact: true,
            },
        )
        .expect("pivot plans");
        assert_eq!(
            transition.operations,
            vec![StagedPivotRedirectOperation::PivotOut {
                vacated: slot(PLAYER, 0),
                outgoing: poke(10),
                incoming: poke(30),
            }]
        );
        let intent = transition.intent.expect("intent recorded");
        assert_eq!(intent.subject, ident(PLAYER, 0, 10));
        assert_eq!(intent.replacement, poke(30));
        assert_eq!(transition.state.pivot_intents.len(), 1);

        // Settling the swap consumes the intent and ages the timed trap.
        let settled = settle_pivot_intent(&transition.state, poke(10)).expect("settle");
        assert!(settled.pivot_intents.is_empty());
        assert_eq!(settled.traps.len(), 1);
        assert_eq!(settled.traps[0].remaining_turns, Some(1));

        // An illegal replacement is a typed failure, never a silent swap.
        let error = plan_pivot(
            &topology,
            &state,
            &PivotRequestFacts {
                subject: ident(PLAYER, 0, 10),
                kind: PivotKind::Voluntary,
                replacement: poke(11),
                replacement_switch_legal: true,
                subject_fainted: false,
                forced_switch_immune: false,
                ghost_type: false,
                escape_artifact: true,
            },
        )
        .expect_err("on-field replacement must fail");
        assert_eq!(error, PivotRedirectError::IllegalReplacement { pokemon: poke(11) });
    }

    #[test]
    fn forced_pivot_respects_immunity_but_ignores_trapping() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (ENEMY, 0, 20, false),
        ]);
        let state = fresh_state();
        let (state, _) = state
            .admit_trap(TrapKind::Binding, ident(PLAYER, 0, 10), None, None)
            .expect("admit trap");

        // Trapped subjects are still forced out; traps block only
        // voluntary escapes.
        let transition = plan_pivot(
            &topology,
            &state,
            &PivotRequestFacts {
                subject: ident(PLAYER, 0, 10),
                kind: PivotKind::Forced,
                replacement: poke(31),
                replacement_switch_legal: true,
                subject_fainted: false,
                forced_switch_immune: false,
                ghost_type: false,
                escape_artifact: false,
            },
        )
        .expect("forced pivot plans");
        assert_eq!(
            transition.operations,
            vec![StagedPivotRedirectOperation::PivotOut {
                vacated: slot(PLAYER, 0),
                outgoing: poke(10),
                incoming: poke(31),
            }]
        );

        // Typed forced-switch immunity denies the forced pivot.
        let transition = plan_pivot(
            &topology,
            &state,
            &PivotRequestFacts {
                subject: ident(PLAYER, 0, 10),
                kind: PivotKind::Forced,
                replacement: poke(31),
                replacement_switch_legal: true,
                subject_fainted: false,
                forced_switch_immune: true,
                ghost_type: false,
                escape_artifact: false,
            },
        )
        .expect("forced pivot evaluates");
        assert_eq!(
            transition.operations,
            vec![StagedPivotRedirectOperation::ForcedPivotDenied {
                subject: ident(PLAYER, 0, 10),
            }]
        );
        assert_eq!(transition.intent, None);
    }

    #[test]
    fn pivot_of_a_fainted_subject_degrades_to_cleanup() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, true),
            (ENEMY, 0, 20, false),
        ]);
        let state = fresh_state();
        let subject = ident(PLAYER, 0, 10);
        let (state, _) = state
            .admit_trap(TrapKind::Binding, subject, Some(ident(ENEMY, 0, 20)), None)
            .expect("admit trap");

        let transition = plan_pivot(
            &topology,
            &state,
            &PivotRequestFacts {
                subject,
                kind: PivotKind::Voluntary,
                replacement: poke(30),
                replacement_switch_legal: true,
                subject_fainted: true,
                forced_switch_immune: false,
                ghost_type: false,
                escape_artifact: false,
            },
        )
        .expect("fainted pivot cleans up");
        assert!(transition.intent.is_none());
        assert!(transition
            .operations
            .contains(&StagedPivotRedirectOperation::CleanupFaintedSource {
                source: poke(10)
            }));
        assert!(transition.state.traps.is_empty());
    }

    #[test]
    fn commander_enters_only_within_one_side_and_vacates_its_slot() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 11, false),
            (ENEMY, 0, 20, false),
            (ENEMY, 1, 21, false),
        ]);
        let state = fresh_state();

        let error = commander_enter(
            &topology,
            &state,
            &CommanderPairFacts {
                commander: ident(PLAYER, 0, 10),
                host: ident(ENEMY, 0, 20),
            },
        )
        .expect_err("cross-side pairing must fail");
        assert_eq!(error, PivotRedirectError::CommanderCrossSide);

        let transition = commander_enter(
            &topology,
            &state,
            &CommanderPairFacts {
                commander: ident(PLAYER, 1, 11),
                host: ident(PLAYER, 0, 10),
            },
        )
        .expect("pairing establishes");
        assert_eq!(
            transition.operations,
            vec![StagedPivotRedirectOperation::VacateSlot {
                slot: slot(PLAYER, 1),
                departing: poke(11),
            }]
        );
        let pairing = transition.state.commander.expect("pairing stored");
        assert_eq!(pairing.commander, poke(11));
        assert_eq!(pairing.host, ident(PLAYER, 0, 10));

        let error = commander_enter(
            &topology,
            &transition.state,
            &CommanderPairFacts {
                commander: ident(ENEMY, 1, 21),
                host: ident(ENEMY, 0, 20),
            },
        )
        .expect_err("second pairing must fail");
        assert_eq!(error, PivotRedirectError::CommanderAlreadyActive);
    }

    #[test]
    fn commander_leaves_when_the_host_departs_and_reclaims_its_slot() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 11, false),
            (ENEMY, 0, 20, false),
        ]);
        let state = fresh_state();
        let paired = commander_enter(
            &topology,
            &state,
            &CommanderPairFacts {
                commander: ident(PLAYER, 1, 11),
                host: ident(PLAYER, 0, 10),
            },
        )
        .expect("pairing establishes")
        .state;

        // The host is still present: the leave trigger is invalid.
        let error = commander_leave(&topology, &paired, CommanderLeaveTrigger::HostLeftField)
            .expect_err("host still present");
        assert_eq!(error, PivotRedirectError::HostStillPresent);

        // After the host leaves the field the commander reclaims its
        // reserved slot exactly.
        let vacated_topology = doubles_topology(&[
            (PLAYER, 0, 0, false),
            (PLAYER, 1, 0, false),
            (ENEMY, 0, 20, false),
        ]);
        let transition = commander_leave(
            &vacated_topology,
            &paired,
            CommanderLeaveTrigger::HostLeftField,
        )
        .expect("leave evaluates")
        .expect("pairing ends");
        assert_eq!(
            transition.operations,
            vec![StagedPivotRedirectOperation::EnterSlot {
                slot: slot(PLAYER, 1),
                arriving: poke(11),
            }]
        );
        assert!(transition.state.commander.is_none());

        // No pairing: leaving is a no-op.
        assert!(commander_leave(&vacated_topology, &state, CommanderLeaveTrigger::HostFainted)
            .expect("no pairing")
            .is_none());

        // A reserved slot that gained an occupant can never receive the
        // commander back.
        let occupied_reserved = doubles_topology(&[
            (PLAYER, 0, 0, false),
            (PLAYER, 1, 50, false),
            (ENEMY, 0, 20, false),
        ]);
        let error = commander_leave(
            &occupied_reserved,
            &paired,
            CommanderLeaveTrigger::HostFainted,
        )
        .expect_err("occupied reserved slot must fail");
        assert_eq!(
            error,
            PivotRedirectError::CommanderReservedSlotOccupied {
                slot: slot(PLAYER, 1)
            }
        );
    }

    #[test]
    fn fainted_source_cleanup_releases_every_owned_effect() {
        // The reserved commander slot (player 1) is vacant while the
        // pairing is active, and the fainted host anchors enemy slot 0.
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 0, false),
            (ENEMY, 0, 20, true),
            (ENEMY, 1, 0, false),
        ]);
        let state = fresh_state();
        let fainted = ident(ENEMY, 0, 20);
        let victim = ident(PLAYER, 0, 10);

        let (state, _) = state
            .admit_redirect(fainted, RedirectKind::FollowMe)
            .expect("redirect");
        let (state, _) = state
            .admit_trap(TrapKind::Binding, victim, Some(fainted), None)
            .expect("owned trap");
        let (state, _) = state
            .admit_trap(TrapKind::Arena, fainted, None, None)
            .expect("anchored trap");
        let (state, _) = state
            .record_pivot_intent(victim, PivotKind::Forced, poke(99))
            .expect("unrelated intent kept");
        let (state, pairing) = state
            .assign_commander(poke(12), slot(PLAYER, 1), fainted)
            .expect("host pairing");

        let cleanup = cleanup_fainted_source(&topology, &state, &fainted).expect("cleanup");
        assert_eq!(cleanup.dropped_redirects.len(), 1);
        assert_eq!(cleanup.released_traps.len(), 2);
        assert!(cleanup.dropped_intents.is_empty());
        assert!(cleanup.commander_returned);
        assert_eq!(
            cleanup.operations,
            vec![
                StagedPivotRedirectOperation::CleanupFaintedSource { source: poke(20) },
                StagedPivotRedirectOperation::EnterSlot {
                    slot: slot(PLAYER, 1),
                    arriving: poke(12),
                },
            ]
        );
        let cleaned = cleanup.state;
        assert!(cleaned.redirects.is_empty());
        assert!(cleaned.traps.is_empty());
        assert_eq!(cleaned.pivot_intents.len(), 1);
        assert!(cleaned.commander.is_none());
        assert_eq!(pairing.commander_slot, slot(PLAYER, 1));

        // Cleanup requires a genuinely fainted source; an alive source is
        // rejected instead of silently swept.
        let alive_topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (ENEMY, 0, 20, false),
        ]);
        let error = cleanup_fainted_source(&alive_topology, &fresh_state(), &victim)
            .expect_err("cleanup of an alive source must fail");
        assert_eq!(error, PivotRedirectError::NotFainted { pokemon: poke(10) });
    }

    #[test]
    fn topology_enforces_the_one_occupant_invariant_and_stable_identities() {
        let invalid = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (PLAYER, 1, 10, false),
            (ENEMY, 0, 20, false),
        ]);
        assert_eq!(
            invalid.validate().expect_err("duplicate occupant"),
            PivotRedirectError::DuplicateFieldOccupant { pokemon: poke(10) }
        );

        let valid = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (ENEMY, 0, 20, false),
        ]);
        valid.validate().expect("valid topology");

        let stale = ident(ENEMY, 0, 99);
        assert_eq!(
            valid.resolve_identity(&stale).expect_err("stale identity"),
            PivotRedirectError::StaleIdentity {
                expected: stale,
                actual: Some(poke(20)),
            }
        );
        assert_eq!(
            valid.resolve_identity(&ident(BattleSide::Enemy, 3, 20)).expect_err("unknown slot"),
            PivotRedirectError::UnknownSlot {
                slot: slot(BattleSide::Enemy, 3)
            }
        );
    }

    #[test]
    fn transitions_never_mutate_their_inputs() {
        let topology = doubles_topology(&[
            (PLAYER, 0, 10, false),
            (ENEMY, 0, 20, false),
        ]);
        let state = fresh_state();
        let before = state.clone();
        let _ = plan_pivot(
            &topology,
            &state,
            &PivotRequestFacts {
                subject: ident(PLAYER, 0, 10),
                kind: PivotKind::Forced,
                replacement: poke(30),
                replacement_switch_legal: true,
                subject_fainted: false,
                forced_switch_immune: false,
                ghost_type: false,
                escape_artifact: false,
            },
        )
        .expect("pivot plans");
        assert_eq!(state, before);
        assert!(state.pivot_intents.is_empty());
    }
}
