//! Canonical typed state for the M6 bespoke move-copy/call family.
//!
//! The family covers every copy/call/random-selection behavior unit in the
//! frozen `CUSTOM_DISPATCH` cluster (`MovesetCopyMoveAttr`/MIMIC,
//! `RandomMoveAttr`/METRONOME, `CopyMoveAttr`/COPYCAT+MIRROR_MOVE,
//! `SketchAttr`/SKETCH, `RandomMovesetMoveAttr`/ASSIST+SLEEP_TALK).
//!
//! State shape mirrors the TypeScript semantics pinned at integration base
//! `1931f32a8` (`Pokemon.summonData.moveHistory`, `Battle.lastMove`): a
//! per-actor, oldest→newest execution history that resets on every summon.
//! Every entry carries a battle-wide strictly monotone execution ordinal and
//! the summon generation it was recorded under so stale actors cannot be
//! consulted after a switch-in. History is bounded by a frozen ceiling; the
//! oldest entry is evicted deterministically when the ceiling is exceeded.

use std::collections::BTreeSet;

use er_types::battle_ids::{MoveId, PokemonId};
use er_types::ids::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Frozen per-actor history ceiling. Excess entries evict oldest-first.
pub const MOVE_HISTORY_MAX_ENTRIES: usize = 32;

/// Frozen TypeScript `MoveId.STRUGGLE` numeric identity
/// (`src/enums/move-id.ts` at base `1931f32a8`). Used by last-move queries to
/// mirror `getLastNonVirtualMove(ignoreStruggle)` without embedding content
/// lookups in this crate.
pub const STRUGGLE_MOVE_ID: u64 = 165;

/// How a recorded move was executed. Mirrors the TypeScript `MoveUseMode`
/// ordering: virtual use modes start at `Indirect`, and PP is ignored from
/// `IgnorePp` upward.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MoveUseModeV2 {
    /// Selected normally (or re-issued by Instruct); charges PP.
    Normal,
    /// Forced continuation (e.g. Outrage); ignores PP.
    IgnorePp,
    /// Called out-of-turn by an effect other than the user's own move.
    Indirect,
    /// Called as another move's effect (Copycat/Mirror Move/Metronome…).
    FollowUp,
    /// Reflected by Magic Coat or Magic Bounce.
    Reflected,
    /// Transparent delayed attack; does not count as using a move.
    DelayedAttack,
}

impl MoveUseModeV2 {
    /// Virtual executions are called by an effect rather than selected.
    pub const fn is_virtual(self) -> bool {
        matches!(
            self,
            Self::Indirect | Self::FollowUp | Self::Reflected | Self::DelayedAttack
        )
    }

    /// Executions at or above `IgnorePp` never charge Power Points.
    pub const fn ignores_pp(self) -> bool {
        matches!(
            self,
            Self::IgnorePp | Self::Indirect | Self::FollowUp | Self::Reflected
        )
    }
}

/// Recorded resolution of an executed move (`TurnMove.result`).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MoveOutcomeV2 {
    Succeeded,
    Failed,
    Missed,
    Other,
}

/// One stable move-history entry: an immutable record of one execution.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveHistoryEntryV2 {
    pub move_id: MoveId,
    pub use_mode: MoveUseModeV2,
    pub outcome: MoveOutcomeV2,
    /// Battle-wide strictly monotone execution order.
    pub execution_ordinal: SafeU53,
    /// Summon generation of the recording actor; entries survive only while
    /// the actor stays on the field.
    pub summon_generation: u32,
}

impl MoveHistoryEntryV2 {
    pub fn validate(&self) -> Result<(), MoveCopyStateError> {
        if self.move_id.get() == SafeU53::ZERO {
            return Err(MoveCopyStateError::ZeroMoveId);
        }
        if self.execution_ordinal == SafeU53::ZERO {
            return Err(MoveCopyStateError::ZeroExecutionOrdinal);
        }
        if self.summon_generation == 0 {
            return Err(MoveCopyStateError::ZeroSummonGeneration);
        }
        Ok(())
    }
}

/// Per-actor ordered bounded history. `entries` is sorted oldest→newest with
/// strictly ascending execution ordinals, all recorded under the current
/// summon generation.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActorMoveHistoryV2 {
    pub actor: PokemonId,
    /// Increments on every switch-in; resets the visible history window.
    pub summon_generation: u32,
    pub entries: Vec<MoveHistoryEntryV2>,
}

impl ActorMoveHistoryV2 {
    pub fn validate(&self) -> Result<(), MoveCopyStateError> {
        if self.summon_generation == 0 {
            return Err(MoveCopyStateError::ZeroSummonGeneration);
        }
        if self.entries.len() > MOVE_HISTORY_MAX_ENTRIES {
            return Err(MoveCopyStateError::HistoryTooLong);
        }
        let mut previous_ordinal: Option<SafeU53> = None;
        for entry in &self.entries {
            entry.validate()?;
            if previous_ordinal.is_some_and(|previous| entry.execution_ordinal <= previous) {
                return Err(MoveCopyStateError::EntriesOutOfOrder);
            }
            if entry.summon_generation != self.summon_generation {
                return Err(MoveCopyStateError::EntryGenerationMismatch);
            }
            previous_ordinal = Some(entry.execution_ordinal);
        }
        Ok(())
    }

    /// Newest entry satisfying `predicate`, scanning newest→oldest.
    fn last_matching(
        &self,
        predicate: impl Fn(&MoveHistoryEntryV2) -> bool,
    ) -> Option<&MoveHistoryEntryV2> {
        self.entries.iter().rev().find(|entry| predicate(entry))
    }
}

/// Canonical move-copy family state root: one bounded history per actor plus
/// the battle-wide ordinal allocator.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveCopyStateV2 {
    /// Strictly ascending unique `actor` identities.
    pub actors: Vec<ActorMoveHistoryV2>,
    /// Next execution ordinal to hand out; must stay ahead of every recorded
    /// entry. Starts at 1 so zero is always invalid.
    pub next_execution_ordinal: SafeU53,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MoveCopyStateError {
    #[error("move history rejects the NONE move identity")]
    ZeroMoveId,
    #[error("execution ordinal must be positive")]
    ZeroExecutionOrdinal,
    #[error("summon generation must be positive")]
    ZeroSummonGeneration,
    #[error("history exceeds the frozen ceiling of 32 entries")]
    HistoryTooLong,
    #[error("history entries must be strictly ordered by execution ordinal")]
    EntriesOutOfOrder,
    #[error("execution ordinals must be unique across actors")]
    DuplicateExecutionOrdinal,
    #[error("next execution ordinal must be positive")]
    ZeroNextExecutionOrdinal,
    #[error("next execution ordinal must stay ahead of every recorded entry")]
    NextOrdinalNotAhead,
    #[error("actor histories must be strictly ordered and unique")]
    ActorsOutOfOrder,
    #[error("entry summon generation diverges from its actor's current generation")]
    EntryGenerationMismatch,
    #[error("actor {actor} is not tracked by the move-copy state")]
    UnknownActor { actor: PokemonId },
    #[error("actor {actor} is stale: state generation {expected}, request generation {actual}")]
    StaleActorGeneration {
        actor: PokemonId,
        expected: u32,
        actual: u32,
    },
    #[error("execution ordinals are exhausted")]
    OrdinalsExhausted,
    #[error("recording a duplicate execution ordinal {0}")]
    DuplicateRecordOrdinal(u64),
}

impl Default for MoveCopyStateV2 {
    fn default() -> Self {
        Self {
            actors: Vec::new(),
            next_execution_ordinal: SafeU53::new(1).unwrap_or(SafeU53::ZERO),
        }
    }
}

impl MoveCopyStateV2 {
    /// Validates ordering, bounds, generations, and the ordinal allocator.
    pub fn validate(&self) -> Result<(), MoveCopyStateError> {
        if self.next_execution_ordinal == SafeU53::ZERO {
            return Err(MoveCopyStateError::ZeroNextExecutionOrdinal);
        }
        let mut previous_actor: Option<PokemonId> = None;
        let mut seen_ordinals = BTreeSet::new();
        for history in &self.actors {
            history.validate()?;
            if previous_actor.is_some_and(|previous| history.actor <= previous) {
                return Err(MoveCopyStateError::ActorsOutOfOrder);
            }
            for entry in &history.entries {
                if !seen_ordinals.insert(entry.execution_ordinal) {
                    return Err(MoveCopyStateError::DuplicateExecutionOrdinal);
                }
                if entry.execution_ordinal >= self.next_execution_ordinal {
                    return Err(MoveCopyStateError::NextOrdinalNotAhead);
                }
            }
            previous_actor = Some(history.actor);
        }
        Ok(())
    }

    /// Read-only lookup of one actor's history.
    pub fn actor_history(
        &self,
        actor: PokemonId,
    ) -> Result<&ActorMoveHistoryV2, MoveCopyStateError> {
        let index = self
            .actors
            .binary_search_by(|history| history.actor.cmp(&actor))
            .map_err(|_| MoveCopyStateError::UnknownActor { actor })?;
        Ok(&self.actors[index])
    }

    /// Newest entry passing `predicate` for `actor`, rejecting stale actors.
    pub fn last_matching(
        &self,
        actor: PokemonId,
        summon_generation: u32,
        predicate: impl Fn(&MoveHistoryEntryV2) -> bool,
    ) -> Result<Option<MoveHistoryEntryV2>, MoveCopyStateError> {
        let history = self.actor_history(actor)?;
        if history.summon_generation != summon_generation {
            return Err(MoveCopyStateError::StaleActorGeneration {
                actor,
                expected: history.summon_generation,
                actual: summon_generation,
            });
        }
        Ok(history.last_matching(predicate).copied())
    }

    /// Pure transition appending one execution to `actor`'s history.
    ///
    /// Returns the updated state plus the recorded entry and the entry evicted
    /// to keep the frozen bound (oldest-first eviction). Rejects unknown or
    /// stale actors and duplicate ordinals without mutating the input.
    pub fn with_recorded_entry(
        &self,
        actor: PokemonId,
        summon_generation: u32,
        move_id: MoveId,
        use_mode: MoveUseModeV2,
        outcome: MoveOutcomeV2,
    ) -> Result<(Self, MoveHistoryEntryV2, Option<MoveHistoryEntryV2>), MoveCopyStateError> {
        let ordinal = self.next_execution_ordinal;
        if ordinal == SafeU53::ZERO {
            return Err(MoveCopyStateError::ZeroExecutionOrdinal);
        }
        let next_value = ordinal
            .get()
            .checked_add(1)
            .ok_or(MoveCopyStateError::OrdinalsExhausted)?;
        let next = SafeU53::new(next_value).map_err(|_| MoveCopyStateError::OrdinalsExhausted)?;

        let index = self
            .actors
            .binary_search_by(|history| history.actor.cmp(&actor))
            .map_err(|_| MoveCopyStateError::UnknownActor { actor })?;
        let history = &self.actors[index];
        if history.summon_generation != summon_generation {
            return Err(MoveCopyStateError::StaleActorGeneration {
                actor,
                expected: history.summon_generation,
                actual: summon_generation,
            });
        }
        if history
            .entries
            .iter()
            .any(|existing| existing.execution_ordinal == ordinal)
        {
            return Err(MoveCopyStateError::DuplicateRecordOrdinal(ordinal.get()));
        }

        let entry = MoveHistoryEntryV2 {
            move_id,
            use_mode,
            outcome,
            execution_ordinal: ordinal,
            summon_generation,
        };
        entry.validate()?;

        let mut updated = self.clone();
        let mut evicted = None;
        let target = &mut updated.actors[index];
        target.entries.push(entry);
        if target.entries.len() > MOVE_HISTORY_MAX_ENTRIES {
            evicted = Some(target.entries.remove(0));
        }
        updated.next_execution_ordinal = next;
        updated.validate()?;
        Ok((updated, entry, evicted))
    }
}
