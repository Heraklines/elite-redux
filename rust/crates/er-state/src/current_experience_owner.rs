//! Non-paying current XP source context and unresolved ownership. No neutral admission or amount is implied.
use er_types::battle_ids::{BattleId, BattleSide, GameModeId, PokemonId, SpeciesId, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::run_ids::{Experience, GameRunId};
use er_types::{GameContentIdentityV2, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::current_battle_participation::{CurrentBattleParticipantV1, CurrentBattleParticipationV1};
use crate::m7_state::RunStateV3;

pub const CURRENT_EXPERIENCE_ORACLE: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
pub const MAX_PENDING_EXPERIENCE_V1: usize = 6;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value", deny_unknown_fields)]
pub enum CurrentExperienceCapPolicyV1 {
    NormalClassic,
    Override(i32),
    Ignored,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentExperienceEncounterV1 { OrdinaryWild, OrdinaryTrainer }

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentExperienceContinuationV1 { BattleTail, WaveVictoryTail, RunDefeatTail }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentExperienceSourceV1 {
    pub pokemon: PokemonId,
    pub species: SpeciesId,
    pub compiled_form: u16,
    /// None means the source species object has NO forms. Some(i) is source forms[i].
    pub source_form: Option<u16>,
    pub unadjusted_base_exp: SafeU53,
    pub source_sprite_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentExperienceRecipientV1 {
    pub pokemon: PokemonId,
    pub owner: SeatId,
    pub hp: u32,
    pub level: u16,
    pub experience: Experience,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentPendingExperienceV1 {
    pub id: SafeU53,
    pub observation: SafeU53,
    pub source: CurrentExperienceSourceV1,
    pub defeated_level: u16,
    pub participants: Vec<CurrentBattleParticipantV1>,
    /// Actual party order; includes ineligible members. It is NOT an eligible-recipient count.
    pub recipients: Vec<CurrentExperienceRecipientV1>,
    pub continuation: CurrentExperienceContinuationV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentExperienceOwnerV1 {
    pub content_identity: GameContentIdentityV2,
    pub run: GameRunId,
    pub battle: BattleId,
    pub wave: WaveIndex,
    pub authority: SeatId,
    pub mode: GameModeId,
    pub cap_policy: CurrentExperienceCapPolicyV1,
    pub encounter: CurrentExperienceEncounterV1,
    pub enemy_sources: Vec<CurrentExperienceSourceV1>,
    pub next_observation: SafeU53,
    pub next_pending_id: SafeU53,
    /// Every entry is unresolved. There is deliberately no amount, applied marker or settlement API.
    pub pending: Vec<CurrentPendingExperienceV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CurrentExperienceOwnerError {
    #[error("current experience ownership or explicit source provenance is invalid")]
    Invalid,
    #[error("current experience source scope or unsettled continuation is unsupported")]
    Unsupported,
    #[error("current experience pending identity is exhausted")]
    Exhausted,
}

impl CurrentExperienceOwnerV1 {
    pub fn fresh(
        observation: &CurrentBattleParticipationV1,
        run: &RunStateV3,
        content_identity: GameContentIdentityV2,
        cap_policy: CurrentExperienceCapPolicyV1,
        encounter: CurrentExperienceEncounterV1,
        enemy_sources: Vec<CurrentExperienceSourceV1>,
    ) -> Result<Self, CurrentExperienceOwnerError> {
        if !observation.faints.is_empty() || !observation.participants.is_empty()
            || observation.next_turn.get().get() != 1 || observation.experience.is_some()
        {
            return Err(CurrentExperienceOwnerError::Unsupported);
        }
        let value = Self {
            content_identity,
            run: observation.run,
            battle: observation.battle,
            wave: observation.wave,
            authority: observation.authority,
            mode: run.mode,
            cap_policy,
            encounter,
            enemy_sources,
            next_observation: observation.next_occurrence,
            next_pending_id: SafeU53::new(1).map_err(|_| CurrentExperienceOwnerError::Invalid)?,
            pending: Vec::new(),
        };
        value.validate(observation, run)?;
        Ok(value)
    }

    /// Structural restore checks, not proof of source phase order or neutral eligibility.
    pub fn validate(&self, observation: &CurrentBattleParticipationV1, run: &RunStateV3)
        -> Result<(), CurrentExperienceOwnerError>
    {
        let battle = run.battle.as_ref().ok_or(CurrentExperienceOwnerError::Invalid)?;
        if self.content_identity.oracle_sha.as_str() != CURRENT_EXPERIENCE_ORACLE
            || self.run != observation.run || self.run != run.run_id
            || self.battle != observation.battle || self.battle != battle.battle_id
            || self.wave != observation.wave || self.wave != run.wave
            || self.authority != observation.authority || self.authority != battle.authority_seat
            || self.mode != run.mode || self.next_observation != observation.next_occurrence
            || self.next_pending_id == SafeU53::ZERO
        { return Err(CurrentExperienceOwnerError::Invalid); }
        if self.cap_policy != CurrentExperienceCapPolicyV1::NormalClassic
            || self.encounter != CurrentExperienceEncounterV1::OrdinaryWild
            || !(1..=200).contains(&run.wave.get().get())
            || self.pending.len() > MAX_PENDING_EXPERIENCE_V1
        { return Err(CurrentExperienceOwnerError::Unsupported); }
        if self.enemy_sources.len() != observation.enemy_roster.len()
            || !self.enemy_sources.windows(2).all(|pair| pair[0].pokemon < pair[1].pokemon)
        { return Err(CurrentExperienceOwnerError::Invalid); }
        for (source, id) in self.enemy_sources.iter().zip(&observation.enemy_roster) {
            let pokemon = battle.enemy_party.iter().find(|pokemon| pokemon.id == *id)
                .ok_or(CurrentExperienceOwnerError::Invalid)?;
            if source.pokemon != *id || source.species != pokemon.species_id
                || source.compiled_form != pokemon.form_index
                || match source.source_form { None => source.compiled_form != 0, Some(index) => index.checked_add(1) != Some(source.compiled_form) }
            { return Err(CurrentExperienceOwnerError::Invalid); }
        }
        let expected = observation.faints.iter().filter(|faint| faint.slot.side == BattleSide::Enemy)
            .collect::<Vec<_>>();
        if expected.len() != self.pending.len() { return Err(CurrentExperienceOwnerError::Invalid); }
        let recipients = recipient_snapshot(run)?;
        for (index, (pending, faint)) in self.pending.iter().zip(expected).enumerate() {
            let source = self.enemy_sources.iter().find(|source| source.pokemon == faint.pokemon)
                .ok_or(CurrentExperienceOwnerError::Invalid)?;
            let pokemon = battle.enemy_party.iter().find(|pokemon| pokemon.id == faint.pokemon)
                .ok_or(CurrentExperienceOwnerError::Invalid)?;
            if pending.id == SafeU53::ZERO || pending.id >= self.next_pending_id
                || pending.observation != faint.occurrence || pending.source != *source
                || pending.defeated_level != pokemon.level || pending.participants != faint.participants
                || pending.recipients != recipients || pending.continuation != continuation(battle.outcome)
                || (index > 0 && self.pending[index - 1].id.get().checked_add(1) != Some(pending.id.get()))
            { return Err(CurrentExperienceOwnerError::Invalid); }
        }
        if self.pending.last().is_some_and(|last| last.id.get().checked_add(1) != Some(self.next_pending_id.get())) {
            return Err(CurrentExperienceOwnerError::Invalid);
        }
        Ok(())
    }

    /// Conserves context across common material application. Settlement is not yet a supported successor.
    pub fn validate_successor(&self, next: &Self) -> Result<(), CurrentExperienceOwnerError> {
        if !self.pending.is_empty() {
            return if self == next { Ok(()) } else { Err(CurrentExperienceOwnerError::Unsupported) };
        }
        let mut expected = self.clone();
        expected.next_observation = next.next_observation;
        expected.next_pending_id = next.next_pending_id;
        expected.pending = next.pending.clone();
        if expected != *next || next.next_observation < self.next_observation
            || next.pending.first().is_some_and(|pending| pending.id != self.next_pending_id || pending.observation < self.next_observation)
            || (next.pending.is_empty() && next.next_pending_id != self.next_pending_id)
        { return Err(CurrentExperienceOwnerError::Invalid); }
        Ok(())
    }

    pub fn observe_next(&self, observation: &CurrentBattleParticipationV1, run: &RunStateV3)
        -> Result<Self, CurrentExperienceOwnerError>
    {
        if !self.pending.is_empty() { return Err(CurrentExperienceOwnerError::Unsupported); }
        let battle = run.battle.as_ref().ok_or(CurrentExperienceOwnerError::Invalid)?;
        let mut candidate = self.clone();
        for faint in observation.faints.iter().filter(|faint| faint.occurrence >= self.next_observation) {
            if faint.slot.side != BattleSide::Enemy { continue; }
            if candidate.pending.len() == MAX_PENDING_EXPERIENCE_V1 { return Err(CurrentExperienceOwnerError::Unsupported); }
            let source = self.enemy_sources.iter().find(|source| source.pokemon == faint.pokemon)
                .ok_or(CurrentExperienceOwnerError::Invalid)?.clone();
            let defeated = battle.enemy_party.iter().find(|pokemon| pokemon.id == faint.pokemon)
                .ok_or(CurrentExperienceOwnerError::Invalid)?;
            let next = candidate.next_pending_id.get().checked_add(1)
                .and_then(|value| SafeU53::new(value).ok()).ok_or(CurrentExperienceOwnerError::Exhausted)?;
            candidate.pending.push(CurrentPendingExperienceV1 {
                id: candidate.next_pending_id,
                observation: faint.occurrence,
                source,
                defeated_level: defeated.level,
                participants: faint.participants.clone(),
                recipients: recipient_snapshot(run)?,
                continuation: continuation(battle.outcome),
            });
            candidate.next_pending_id = next;
        }
        candidate.next_observation = observation.next_occurrence;
        candidate.validate(observation, run)?;
        Ok(candidate)
    }
}

fn recipient_snapshot(run: &RunStateV3) -> Result<Vec<CurrentExperienceRecipientV1>, CurrentExperienceOwnerError> {
    run.party.iter().map(|pokemon| Ok(CurrentExperienceRecipientV1 {
        pokemon: pokemon.id,
        owner: pokemon.owner_seat.ok_or(CurrentExperienceOwnerError::Invalid)?,
        hp: pokemon.hp,
        level: pokemon.level,
        experience: pokemon.experience,
    })).collect()
}

fn continuation(outcome: BattleOutcome) -> CurrentExperienceContinuationV1 {
    match outcome {
        BattleOutcome::Ongoing => CurrentExperienceContinuationV1::BattleTail,
        BattleOutcome::Victory => CurrentExperienceContinuationV1::WaveVictoryTail,
        BattleOutcome::Defeat => CurrentExperienceContinuationV1::RunDefeatTail,
    }
}
