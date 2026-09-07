//! Opt-in current resolver observations. These are not TS phase-order or XP award records.

use std::collections::{BTreeMap, BTreeSet};

use er_types::battle_ids::{BattleId, BattleSide, FieldSlot, PokemonId, TurnIndex, WaveIndex};
use er_types::run_ids::GameRunId;
use er_types::{SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_state::RunStateV3;

pub const MAX_CURRENT_PARTICIPATION_ROSTER_V1: usize = 6;
pub const MAX_CURRENT_PARTICIPATION_EVENTS_V1: usize = 16;
pub const MAX_CURRENT_PARTICIPATION_FAINTS_V1: usize = 12;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentBattleParticipantV1 {
    pub pokemon: PokemonId,
    pub owner: SeatId,
}

/// Bounded causal evidence from the current resolver's ordered mutation list.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentBattleObservationEventV1 {
    FieldChanged {
        slot: FieldSlot,
        before: Option<PokemonId>,
        after: Option<PokemonId>,
    },
    HpChanged {
        pokemon: PokemonId,
        before: u32,
        after: u32,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentBattleFaintObservationV1 {
    pub occurrence: SafeU53,
    pub resolved_turn: TurnIndex,
    /// Ordinal in the current field/HP observation stream, not a TS phase address.
    pub event_ordinal: u16,
    pub pokemon: PokemonId,
    pub slot: FieldSlot,
    pub owner: Option<SeatId>,
    pub before_hp: u32,
    /// Faint-start membership, before removal of this player if applicable.
    pub participants: Vec<CurrentBattleParticipantV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentBattleParticipationV1 {
    pub run: GameRunId,
    pub battle: BattleId,
    pub wave: WaveIndex,
    pub authority: SeatId,
    pub next_turn: TurnIndex,
    /// Retained across natural battle changes; independent of material/control revisions.
    pub next_occurrence: SafeU53,
    pub player_roster: Vec<PokemonId>,
    pub enemy_roster: Vec<PokemonId>,
    pub participants: Vec<CurrentBattleParticipantV1>,
    /// Current-battle observations only. No amount, paid marker or pending-award claim.
    pub faints: Vec<CurrentBattleFaintObservationV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CurrentBattleParticipationError {
    #[error("current battle participation identity or causal evidence is invalid")]
    Invalid,
    #[error("current battle participation scope or capacity is unsupported")]
    Unsupported,
    #[error("current battle participation counter is exhausted")]
    Exhausted,
}

impl CurrentBattleParticipationV1 {
    /// Fresh-battle initializer used by the opt-in natural constructor; old snapshots stay None.
    pub fn fresh(
        run: &RunStateV3,
        next_occurrence: SafeU53,
    ) -> Result<Self, CurrentBattleParticipationError> {
        let battle = run
            .battle
            .as_ref()
            .ok_or(CurrentBattleParticipationError::Invalid)?;
        if battle.turn.get().get() != 1
            || battle.outcome != er_types::battle_model::BattleOutcome::Ongoing
            || !battle.faint_queue.is_empty()
        {
            return Err(CurrentBattleParticipationError::Unsupported);
        }
        let mut player_roster = run
            .party
            .iter()
            .map(|pokemon| pokemon.id)
            .collect::<Vec<_>>();
        let mut enemy_roster = battle
            .enemy_party
            .iter()
            .map(|pokemon| pokemon.id)
            .collect::<Vec<_>>();
        player_roster.sort_unstable();
        enemy_roster.sort_unstable();
        let value = Self {
            run: run.run_id,
            battle: battle.battle_id,
            wave: run.wave,
            authority: battle.authority_seat,
            next_turn: battle.turn,
            next_occurrence,
            player_roster,
            enemy_roster,
            participants: Vec::new(),
            faints: Vec::new(),
        };
        value.validate(run)?;
        Ok(value)
    }

    /// Restore checks structural consistency. Only a validated resolver transaction supplies the causal trace.
    pub fn validate(&self, run: &RunStateV3) -> Result<(), CurrentBattleParticipationError> {
        let battle = run
            .battle
            .as_ref()
            .ok_or(CurrentBattleParticipationError::Invalid)?;
        if self.run != run.run_id
            || self.battle != battle.battle_id
            || self.wave != run.wave
            || self.wave != battle.wave
            || self.authority != battle.authority_seat
            || self.next_turn != battle.turn
            || self.next_occurrence == SafeU53::ZERO
        {
            return Err(CurrentBattleParticipationError::Invalid);
        }
        if battle.format.player_capacity != 1
            || battle.format.enemy_capacity != 1
            || run.party.is_empty()
            || run.party.len() > MAX_CURRENT_PARTICIPATION_ROSTER_V1
            || battle.enemy_party.is_empty()
            || battle.enemy_party.len() > MAX_CURRENT_PARTICIPATION_ROSTER_V1
            || self.faints.len() > MAX_CURRENT_PARTICIPATION_FAINTS_V1
            || run
                .party
                .iter()
                .any(|pokemon| pokemon.owner_seat != Some(self.authority))
            || battle
                .enemy_party
                .iter()
                .any(|pokemon| pokemon.owner_seat.is_some())
        {
            return Err(CurrentBattleParticipationError::Unsupported);
        }
        let players = run
            .party
            .iter()
            .map(|pokemon| pokemon.id)
            .collect::<BTreeSet<_>>();
        let enemies = battle
            .enemy_party
            .iter()
            .map(|pokemon| pokemon.id)
            .collect::<BTreeSet<_>>();
        if !sorted_unique(&self.player_roster)
            || !sorted_unique(&self.enemy_roster)
            || self.player_roster.iter().copied().collect::<BTreeSet<_>>() != players
            || self.enemy_roster.iter().copied().collect::<BTreeSet<_>>() != enemies
            || players.len() != run.party.len()
            || enemies.len() != battle.enemy_party.len()
            || !players.is_disjoint(&enemies)
        {
            return Err(CurrentBattleParticipationError::Invalid);
        }
        self.validate_participants(&self.participants, &players)?;
        let mut ids = BTreeSet::new();
        let mut previous: Option<&CurrentBattleFaintObservationV1> = None;
        for faint in &self.faints {
            let (roster, owner) = match faint.slot.side {
                BattleSide::Player => (&players, Some(self.authority)),
                BattleSide::Enemy => (&enemies, None),
            };
            let pokemon = run
                .party
                .iter()
                .chain(&battle.enemy_party)
                .find(|pokemon| pokemon.id == faint.pokemon)
                .ok_or(CurrentBattleParticipationError::Invalid)?;
            if !roster.contains(&faint.pokemon)
                || faint.slot.position != 0
                || faint.owner != owner
                || faint.before_hp == 0
                || faint.before_hp > pokemon.max_hp
                || faint.occurrence == SafeU53::ZERO
                || faint.occurrence >= self.next_occurrence
                || faint.resolved_turn >= self.next_turn
                || usize::from(faint.event_ordinal) >= MAX_CURRENT_PARTICIPATION_EVENTS_V1
                || !ids.insert(faint.pokemon)
                || previous.is_some_and(|prior| {
                    prior.occurrence.get().checked_add(1) != Some(faint.occurrence.get())
                        || (prior.resolved_turn, prior.event_ordinal)
                            >= (faint.resolved_turn, faint.event_ordinal)
                })
            {
                return Err(CurrentBattleParticipationError::Invalid);
            }
            // Revival, including a deferred summon revive, needs a separately qualified lifecycle.
            if pokemon.hp != 0 || !pokemon.fainted {
                return Err(CurrentBattleParticipationError::Unsupported);
            }
            self.validate_participants(&faint.participants, &players)?;
            if faint.slot.side == BattleSide::Player
                && !faint.participants.contains(&CurrentBattleParticipantV1 {
                    pokemon: faint.pokemon,
                    owner: self.authority,
                })
            {
                return Err(CurrentBattleParticipationError::Invalid);
            }
            previous = Some(faint);
        }
        if self.faints.last().is_some_and(|last| {
            last.occurrence.get().checked_add(1) != Some(self.next_occurrence.get())
        }) {
            return Err(CurrentBattleParticipationError::Invalid);
        }
        for participant in &self.participants {
            if let Some(completed) = self.faints.iter().find(|faint| {
                faint.slot.side == BattleSide::Player && faint.pokemon == participant.pokemon
            }) {
                // A later CURRENT faint-start union can reinsert the still-fielded fainted player.
                // Its recorded membership is the explicit structural reason; this is not TS timing proof.
                if !self.faints.iter().any(|later| {
                    later.occurrence > completed.occurrence
                        && later.participants.contains(participant)
                }) {
                    return Err(CurrentBattleParticipationError::Invalid);
                }
            }
        }
        Ok(())
    }

    fn validate_participants(
        &self,
        participants: &[CurrentBattleParticipantV1],
        players: &BTreeSet<PokemonId>,
    ) -> Result<(), CurrentBattleParticipationError> {
        if participants.len() > MAX_CURRENT_PARTICIPATION_ROSTER_V1
            || !sorted_unique(participants)
            || participants.iter().any(|participant| {
                participant.owner != self.authority || !players.contains(&participant.pokemon)
            })
        {
            return Err(CurrentBattleParticipationError::Invalid);
        }
        Ok(())
    }

    /// Pure candidate computation; caller publishes this only with the complete resolved state.
    pub fn observe_turn(
        &self,
        before: &RunStateV3,
        after: &RunStateV3,
        events: &[CurrentBattleObservationEventV1],
    ) -> Result<Self, CurrentBattleParticipationError> {
        self.validate(before)?;
        if events.len() > MAX_CURRENT_PARTICIPATION_EVENTS_V1 {
            return Err(CurrentBattleParticipationError::Unsupported);
        }
        let before_battle = before
            .battle
            .as_ref()
            .ok_or(CurrentBattleParticipationError::Invalid)?;
        let after_battle = after
            .battle
            .as_ref()
            .ok_or(CurrentBattleParticipationError::Invalid)?;
        if self.next_turn.get().get().checked_add(1) != Some(after_battle.turn.get().get()) {
            return Err(CurrentBattleParticipationError::Invalid);
        }
        let mut candidate = self.clone();
        let mut field = before_battle.field.clone();
        let mut hp = before
            .party
            .iter()
            .chain(&before_battle.enemy_party)
            .map(|pokemon| (pokemon.id, pokemon.hp))
            .collect::<BTreeMap<_, _>>();
        // Source TurnInit membership: active players. Switch itself does not add a participant.
        for slot in &field.slots {
            if slot.slot.side == BattleSide::Player
                && let Some(id) = slot.occupant
                && hp.get(&id).is_some_and(|value| *value > 0)
            {
                insert_participant(&mut candidate.participants, id, self.authority);
            }
        }
        for (ordinal, event) in events.iter().enumerate() {
            match *event {
                CurrentBattleObservationEventV1::FieldChanged {
                    slot,
                    before: old,
                    after: new,
                } => {
                    let target = field
                        .slots
                        .iter_mut()
                        .find(|entry| entry.slot == slot)
                        .ok_or(CurrentBattleParticipationError::Invalid)?;
                    let roster = match slot.side {
                        BattleSide::Player => &self.player_roster,
                        BattleSide::Enemy => &self.enemy_roster,
                    };
                    if target.occupant != old || new.is_none_or(|id| !roster.contains(&id)) {
                        return Err(CurrentBattleParticipationError::Invalid);
                    }
                    target.occupant = new;
                }
                CurrentBattleObservationEventV1::HpChanged {
                    pokemon,
                    before: old,
                    after: new,
                } => {
                    let current = hp
                        .get_mut(&pokemon)
                        .ok_or(CurrentBattleParticipationError::Invalid)?;
                    if *current != old {
                        return Err(CurrentBattleParticipationError::Invalid);
                    }
                    if old == 0 && new > 0 {
                        return Err(CurrentBattleParticipationError::Unsupported);
                    }
                    *current = new;
                    if old > 0 && new == 0 {
                        let slot = field
                            .slots
                            .iter()
                            .find(|entry| entry.occupant == Some(pokemon))
                            .ok_or(CurrentBattleParticipationError::Invalid)?
                            .slot;
                        if candidate.faints.len() == MAX_CURRENT_PARTICIPATION_FAINTS_V1
                            || candidate
                                .faints
                                .iter()
                                .any(|faint| faint.pokemon == pokemon)
                        {
                            return Err(CurrentBattleParticipationError::Unsupported);
                        }
                        // Source Faint start includes active OR fainted player field identities.
                        // This reducer observes CURRENT mutation order, not asynchronous TS phase order.
                        for entry in &field.slots {
                            if entry.slot.side == BattleSide::Player
                                && let Some(id) = entry.occupant
                            {
                                insert_participant(&mut candidate.participants, id, self.authority);
                            }
                        }
                        let next = candidate
                            .next_occurrence
                            .get()
                            .checked_add(1)
                            .and_then(|value| SafeU53::new(value).ok())
                            .ok_or(CurrentBattleParticipationError::Exhausted)?;
                        candidate.faints.push(CurrentBattleFaintObservationV1 {
                            occurrence: candidate.next_occurrence,
                            resolved_turn: self.next_turn,
                            event_ordinal: u16::try_from(ordinal)
                                .map_err(|_| CurrentBattleParticipationError::Unsupported)?,
                            pokemon,
                            slot,
                            owner: (slot.side == BattleSide::Player).then_some(self.authority),
                            before_hp: old,
                            participants: candidate.participants.clone(),
                        });
                        candidate.next_occurrence = next;
                        if slot.side == BattleSide::Player {
                            candidate
                                .participants
                                .retain(|participant| participant.pokemon != pokemon);
                        }
                    }
                }
            }
        }
        let expected_hp = after
            .party
            .iter()
            .chain(&after_battle.enemy_party)
            .map(|pokemon| (pokemon.id, pokemon.hp))
            .collect::<BTreeMap<_, _>>();
        if hp != expected_hp || field != after_battle.field {
            return Err(CurrentBattleParticipationError::Invalid);
        }
        candidate.next_turn = after_battle.turn;
        candidate.validate(after)?;
        Ok(candidate)
    }
}

fn sorted_unique<T: Ord>(values: &[T]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}

fn insert_participant(
    values: &mut Vec<CurrentBattleParticipantV1>,
    pokemon: PokemonId,
    owner: SeatId,
) {
    let participant = CurrentBattleParticipantV1 { pokemon, owner };
    match values.binary_search(&participant) {
        Ok(_) => {}
        Err(index) => values.insert(index, participant),
    }
}
