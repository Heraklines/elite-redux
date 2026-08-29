//! Canonical typed state for the M6C `TRANSFORM_FORM_COPY` bespoke family.
//!
//! One entry records the battle-visible overlay a battler wears while
//! transformed by [`MoveId` 144 Transform] or the Imposter ability. The
//! overlay mirrors the frozen TypeScript `PokemonTransformPhase` copy surface:
//! species/form presentation, typing, gender, battle stats (never HP), stat
//! stages, the PP-capped moveset, and the ability/passive presentation
//! identity. Excluded by contract and therefore absent from this state: HP,
//! status, owner linkage, and the stable Pokémon identity of both sides — a
//! transformed battler keeps its own [`PokemonId`] forever.
//!
//! Pure apply/clear transitions live in
//! `er-battle/src/m6/bespoke/transform_imposter.rs`; this module owns only the
//! serializable DTOs, their constructors, and fail-closed validation.

use er_types::SafeU53;
use er_types::battle_ids::{AbilityId, MoveId, PokemonId};
use er_types::battle_model::{BattleTyping, StatStages};
use er_types::m6::{FormId, M6_TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Highest copied PP the TypeScript transform copy admits
/// (`Math.min(m.getMove().pp, 5)` in `PokemonTransformPhase`).
pub const TRANSFORM_COPIED_PP_CAP: u16 = 5;

/// Largest number of copied moveslots the transform copy accepts.
pub const TRANSFORM_MOVESET_MAX_LEN: usize = 4;

/// Schema version of the transform/imposter canonical state root. Split from
/// the shared mechanic-state envelope when the copied typing gained its
/// explicit typeless variant ([`BattleTyping`]) - a deliberate wire-format
/// change recorded by its own version.
pub const TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION: u32 =
    M6_TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION;

/// Which audited behavior produced the copy.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransformCopyTriggerV2 {
    /// MOVE 144 `TransformAttr`.
    MoveTransform,
    /// Imposter post-summon copy.
    Imposter,
}

/// Gender presentation copied from the source. Presentation-only: it never
/// feeds damage or breeding mechanics.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransformCopiedGenderV2 {
    Male,
    Female,
    Unknown,
}

/// Battle-visible stat values copied by a transform. HP is deliberately
/// absent: the TypeScript phase copies every effective stat *except* HP, so
/// the canonical state cannot even represent an HP copy.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformCopiedStatsV2 {
    pub attack: u32,
    pub defense: u32,
    pub special_attack: u32,
    pub special_defense: u32,
    pub speed: u32,
}

impl TransformCopiedStatsV2 {
    /// Projects full battle stats onto the copyable surface, dropping HP.
    pub fn from_battle_stats(stats: &er_types::battle_model::BattleStats) -> Self {
        Self {
            attack: stats.attack,
            defense: stats.defense,
            special_attack: stats.special_attack,
            special_defense: stats.special_defense,
            speed: stats.speed,
        }
    }
}

/// One copied moveslot. PP is clamped at [`TRANSFORM_COPIED_PP_CAP`] by the
/// planner; storage rejects anything above the cap so stale hand-written
/// state fails closed instead of silently re-clamping.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformCopiedMoveV2 {
    pub move_id: MoveId,
    pub pp: u16,
}

/// Ability presentation identity copied from the source: the active ability
/// plus the ER three-passive triple, mirroring the synchronous
/// `setTempAbility`/`setTempPassives` assignments in the transform phase.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformCopiedAbilitiesV2 {
    pub active: AbilityId,
    pub passives: [Option<AbilityId>; 3],
}

/// The full battle-visible copy payload staged onto one transformed battler.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformCopiedBattleStateV2 {
    pub species: SafeU53,
    pub form_key: FormId,
    /// Explicit copied typing: the concrete pairing or the production
    /// typeless presentation (`493:18:unknown`). Typeless copies stay outside
    /// type-chart lookup by construction.
    pub typing: BattleTyping,
    pub gender: TransformCopiedGenderV2,
    pub stats: TransformCopiedStatsV2,
    pub stages: StatStages,
    pub moveset: Vec<TransformCopiedMoveV2>,
    pub abilities: TransformCopiedAbilitiesV2,
}

impl TransformCopiedBattleStateV2 {
    pub fn validate(&self) -> Result<(), TransformFormCopyStateError> {
        if self.species == SafeU53::ZERO {
            return Err(TransformFormCopyStateError::ZeroSpecies);
        }
        if self.moveset.is_empty() {
            return Err(TransformFormCopyStateError::EmptyMoveset);
        }
        if self.moveset.len() > TRANSFORM_MOVESET_MAX_LEN {
            return Err(TransformFormCopyStateError::MovesetTooLong {
                len: self.moveset.len(),
            });
        }
        for slot in &self.moveset {
            if slot.move_id == MoveId::ZERO {
                return Err(TransformFormCopyStateError::ZeroCopiedMoveId);
            }
            if slot.pp > TRANSFORM_COPIED_PP_CAP {
                return Err(TransformFormCopyStateError::CopiedPpAboveCap {
                    pp: slot.pp,
                    cap: TRANSFORM_COPIED_PP_CAP,
                });
            }
        }
        if self.abilities.active == AbilityId::ZERO {
            return Err(TransformFormCopyStateError::ZeroActiveAbility);
        }
        let stage_in_range = |stage: i8| (-6..=6).contains(&stage);
        if !(stage_in_range(self.stages.attack)
            && stage_in_range(self.stages.defense)
            && stage_in_range(self.stages.special_attack)
            && stage_in_range(self.stages.special_defense)
            && stage_in_range(self.stages.speed)
            && stage_in_range(self.stages.accuracy)
            && stage_in_range(self.stages.evasion))
        {
            return Err(TransformFormCopyStateError::StatStageOutOfRange);
        }
        Ok(())
    }
}

/// Per-battler transform record. An inactive entry is a stable tombstone: the
/// battler identity remains registered while every copied overlay is dropped.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformCopyEntryV2 {
    pub subject: PokemonId,
    pub active: bool,
    pub trigger: Option<TransformCopyTriggerV2>,
    /// Stable identity of the copied source battler, recorded as evidence
    /// only. It is never merged into the subject's own identity.
    pub source: Option<PokemonId>,
    pub copied: Option<TransformCopiedBattleStateV2>,
}

impl TransformCopyEntryV2 {
    /// Active entry carrying a validated copy payload.
    pub fn active(
        subject: PokemonId,
        trigger: TransformCopyTriggerV2,
        source: PokemonId,
        copied: TransformCopiedBattleStateV2,
    ) -> Result<Self, TransformFormCopyStateError> {
        copied.validate()?;
        Ok(Self {
            subject,
            active: true,
            trigger: Some(trigger),
            source: Some(source),
            copied: Some(copied),
        })
    }

    /// Inactive tombstone preserving the stable subject identity.
    pub fn cleared(subject: PokemonId) -> Self {
        Self {
            subject,
            active: false,
            trigger: None,
            source: None,
            copied: None,
        }
    }

    fn validate(&self) -> Result<(), TransformFormCopyStateError> {
        match (self.active, self.trigger, self.source, self.copied.as_ref()) {
            (true, Some(_), Some(_), Some(copied)) => copied.validate(),
            (false, None, None, None) => Ok(()),
            _ => Err(TransformFormCopyStateError::OverlayShapeMismatch),
        }
    }
}

/// Canonical state root for the transform/imposter family. Entries are
/// strictly ordered by subject so serialized output is byte-stable.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformFormCopyStateV2 {
    pub schema_version: u32,
    pub entries: Vec<TransformCopyEntryV2>,
}

impl Default for TransformFormCopyStateV2 {
    fn default() -> Self {
        Self::new()
    }
}

impl TransformFormCopyStateV2 {
    pub fn new() -> Self {
        Self {
            schema_version: TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION,
            entries: Vec::new(),
        }
    }

    /// Position of `subject`'s entry, if registered.
    pub fn position_of(&self, subject: PokemonId) -> Option<usize> {
        self.entries
            .iter()
            .position(|entry| entry.subject == subject)
    }

    /// Validated insert-or-replace preserving strict subject ordering.
    pub fn upsert(
        &mut self,
        entry: TransformCopyEntryV2,
    ) -> Result<(), TransformFormCopyStateError> {
        entry.validate()?;
        match self
            .entries
            .binary_search_by(|probe| probe.subject.cmp(&entry.subject))
        {
            Ok(index) => self.entries[index] = entry,
            Err(index) => self.entries.insert(index, entry),
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), TransformFormCopyStateError> {
        if self.schema_version != TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION {
            return Err(TransformFormCopyStateError::SchemaVersion {
                expected: TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        let mut previous: Option<PokemonId> = None;
        for entry in &self.entries {
            if previous.is_some_and(|prior| entry.subject <= prior) {
                return Err(TransformFormCopyStateError::EntriesOutOfOrder);
            }
            entry.validate()?;
            previous = Some(entry.subject);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TransformFormCopyStateError {
    #[error("transform form-copy state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("transform copy entries must be strictly ordered by unique subject")]
    EntriesOutOfOrder,
    #[error("transform copy entry overlay fields disagree with the active flag")]
    OverlayShapeMismatch,
    #[error("copied species id must be positive")]
    ZeroSpecies,
    #[error("copied moveset must contain at least one move")]
    EmptyMoveset,
    #[error("copied moveset exceeds the four-slot ceiling, got {len}")]
    MovesetTooLong { len: usize },
    #[error("copied move id must be positive")]
    ZeroCopiedMoveId,
    #[error("copied PP {pp} exceeds the transform copy cap of {cap}")]
    CopiedPpAboveCap { pp: u16, cap: u16 },
    #[error("copied active ability id must be positive")]
    ZeroActiveAbility,
    #[error("copied stat stage falls outside the closed [-6, 6] range")]
    StatStageOutOfRange,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subject(value: u64) -> PokemonId {
        PokemonId::try_from_u64(value).expect("in-range pokemon id")
    }

    fn ability(value: u64) -> AbilityId {
        AbilityId::try_from_u64(value).expect("in-range ability id")
    }

    fn copied_move(value: u64) -> TransformCopiedMoveV2 {
        TransformCopiedMoveV2 {
            move_id: MoveId::try_from_u64(value).expect("in-range move id"),
            pp: 5,
        }
    }

    fn valid_copied() -> TransformCopiedBattleStateV2 {
        TransformCopiedBattleStateV2 {
            species: SafeU53::new(132).expect("in-range species"),
            form_key: FormId::parse("0").expect("compound form id"),
            typing: BattleTyping::from(er_types::battle_model::PokemonTyping {
                primary: er_types::battle_model::PokemonType::Normal,
                secondary: None,
            }),
            gender: TransformCopiedGenderV2::Unknown,
            stats: TransformCopiedStatsV2 {
                attack: 48,
                defense: 48,
                special_attack: 48,
                special_defense: 48,
                speed: 48,
            },
            stages: StatStages {
                attack: 0,
                defense: 0,
                special_attack: 0,
                special_defense: 0,
                speed: 0,
                accuracy: 0,
                evasion: 0,
            },
            moveset: vec![copied_move(1)],
            abilities: TransformCopiedAbilitiesV2 {
                active: ability(150),
                passives: [None, None, None],
            },
        }
    }

    #[test]
    fn valid_copied_state_round_trips_canonically() {
        let copied = valid_copied();
        copied.validate().expect("fixture must validate");
        let state = TransformFormCopyStateV2 {
            schema_version: TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION,
            entries: vec![
                TransformCopyEntryV2::active(
                    subject(1),
                    TransformCopyTriggerV2::MoveTransform,
                    subject(2),
                    copied.clone(),
                )
                .expect("entry must validate"),
                TransformCopyEntryV2::cleared(subject(3)),
            ],
        };
        state.validate().expect("state must validate");
        let serialized = serde_json::to_string(&state).expect("serialization");
        let deserialized: TransformFormCopyStateV2 =
            serde_json::from_str(&serialized).expect("deserialization");
        assert_eq!(deserialized, state);
    }

    #[test]
    fn typeless_copy_is_representable_and_never_carries_a_chart_entry() {
        // The frozen oracle's typeless identity (`493:18:unknown`) copies as
        // the explicit TYPELESS presentation, not as an UNKNOWN chart row.
        let mut copied = valid_copied();
        copied.typing = BattleTyping::Typeless;
        copied.validate().expect("typeless copy validates");
        let serialized = serde_json::to_string(&copied).expect("serialize");
        assert!(serialized.contains("TYPELESS"), "wire form: {serialized}");
        let round_tripped: TransformCopiedBattleStateV2 =
            serde_json::from_str(&serialized).expect("deserialize");
        assert_eq!(round_tripped, copied);
        assert!(round_tripped.typing.is_typeless());
        assert!(round_tripped.typing.typed().is_none());
    }

    #[test]
    fn reject_pp_above_cap_and_zero_ids() {
        let mut over_cap = valid_copied();
        over_cap.moveset[0].pp = TRANSFORM_COPIED_PP_CAP + 1;
        assert_eq!(
            over_cap.validate(),
            Err(TransformFormCopyStateError::CopiedPpAboveCap {
                pp: TRANSFORM_COPIED_PP_CAP + 1,
                cap: TRANSFORM_COPIED_PP_CAP,
            })
        );

        let mut zero_species = valid_copied();
        zero_species.species = SafeU53::ZERO;
        assert_eq!(
            zero_species.validate(),
            Err(TransformFormCopyStateError::ZeroSpecies)
        );

        let mut zero_move = valid_copied();
        zero_move.moveset[0].move_id = MoveId::ZERO;
        assert_eq!(
            zero_move.validate(),
            Err(TransformFormCopyStateError::ZeroCopiedMoveId)
        );
    }

    #[test]
    fn reject_out_of_order_entries_and_shape_mismatch() {
        let mut state = TransformFormCopyStateV2::new();
        state
            .upsert(TransformCopyEntryV2::cleared(subject(7)))
            .expect("first insert");
        // Upsert on an already-registered subject is a validated
        // replace-by-design: one entry per stable identity, still valid.
        state
            .upsert(TransformCopyEntryV2::cleared(subject(7)))
            .expect("same-subject upsert must replace in place");
        assert_eq!(state.entries.len(), 1);

        let mut torn = TransformCopyEntryV2::cleared(subject(9));
        torn.copied = Some(valid_copied());
        assert_eq!(
            state.upsert(torn),
            Err(TransformFormCopyStateError::OverlayShapeMismatch)
        );

        // Canonical ordering guards raw entry vectors (direct construction
        // or deserialization): duplicates and descending subjects fail.
        let duplicated = TransformFormCopyStateV2 {
            schema_version: TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION,
            entries: vec![
                TransformCopyEntryV2::cleared(subject(5)),
                TransformCopyEntryV2::cleared(subject(5)),
            ],
        };
        assert_eq!(
            duplicated.validate(),
            Err(TransformFormCopyStateError::EntriesOutOfOrder)
        );
        let descending = TransformFormCopyStateV2 {
            schema_version: TRANSFORM_FORM_COPY_STATE_SCHEMA_VERSION,
            entries: vec![
                TransformCopyEntryV2::cleared(subject(9)),
                TransformCopyEntryV2::cleared(subject(5)),
            ],
        };
        assert_eq!(
            descending.validate(),
            Err(TransformFormCopyStateError::EntriesOutOfOrder)
        );
    }
}
