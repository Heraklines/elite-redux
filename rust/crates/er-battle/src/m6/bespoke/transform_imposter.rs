//! M6C battle transitions for the `TRANSFORM_FORM_COPY` bespoke family.
//!
//! Pure planning and apply/clear transitions for the battle-state copy
//! performed by MOVE 144 `TransformAttr` (`PokemonTransformPhase`) and the
//! Imposter post-summon copy. The executor consumes a typed facts snapshot of
//! canonical battle state by the caller, validates the closed guard set
//! (missing, self, terminal, already-transformed, illusion, substitute,
//! fusion), projects the target onto the
//! canonical copy payload owned by [`er_state::bespoke_v2::transform_imposter`],
//! and returns a fresh state plus deterministic evidence. Inputs are never
//! mutated: every transition clones, applies, revalidates, then returns.
//!
//! Exclusions are structural: HP has no field in the copied stats, status and
//! owner linkage have no field anywhere in the overlay, and both battlers
//! keep their stable Pokémon identity. Form-change mechanics (mega/stance
//! overlays) stay with the forms family; this module never touches them.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_state::bespoke_v2::transform_imposter::{
    TRANSFORM_COPIED_PP_CAP, TransformCopiedAbilitiesV2, TransformCopiedBattleStateV2,
    TransformCopiedGenderV2, TransformCopiedMoveV2, TransformCopiedStatsV2, TransformCopyEntryV2,
    TransformCopyTriggerV2, TransformFormCopyStateError, TransformFormCopyStateV2,
};
use er_types::SafeU53;
use er_types::battle_ids::{FieldSlot, MoveId, PokemonId};
use er_types::battle_model::{BattleStats, PokemonTyping, StatStages};
use er_types::m6::FormId;

/// Battle-visible facts snapshot for one battler, taken from validated
/// canonical battle state by the caller. The planner reads it read-only.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransformBattlerFactsV2 {
    /// Stable identity; a copied subject keeps its own forever.
    pub pokemon: PokemonId,
    pub slot: FieldSlot,
    /// Terminal battlers can neither copy nor be copied.
    pub fainted: bool,
    /// Whether an active transform overlay already covers this battler.
    pub transformed: bool,
    /// Oracle `summonData.illusion` blocker: an illusioned battler can
    /// neither transform nor be transformed.
    pub behind_illusion: bool,
    /// Oracle `BattlerTagType.SUBSTITUTE` blocker on this battler.
    pub has_substitute: bool,
    /// Oracle `isFusion()` blocker: fusion battlers are excluded on both
    /// sides of a copy.
    pub fusion: bool,
    pub species: SafeU53,
    pub form_key: FormId,
    pub typing: PokemonTyping,
    pub gender: TransformCopiedGenderV2,
    /// Full stat block including HP; only the non-HP fields are copyable.
    pub stats: BattleStats,
    pub stages: StatStages,
    /// Observed source moveset with uncapped PP; the planner clamps to 5.
    pub moveset: Vec<TransformSourceMoveFactsV2>,
    pub abilities: TransformCopiedAbilitiesV2,
}

/// One observed source moveslot before PP capping.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransformSourceMoveFactsV2 {
    pub move_id: MoveId,
    pub pp: u16,
}

/// Typed facts pair plus the audited trigger requesting the copy.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransformImposterFactsV2 {
    pub trigger: TransformCopyTriggerV2,
    pub subject: TransformBattlerFactsV2,
    /// `None` reproduces the missing-target failure path.
    pub target: Option<TransformBattlerFactsV2>,
}

/// Every battle-visible field the transform copy carries, in the fixed
/// evidence order used by all successful plans.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransformCopiedFieldV2 {
    Species,
    FormKey,
    Typing,
    Gender,
    StatsExcludingHp,
    StatStages,
    MovesetPpCapped,
    AbilityPresentationIdentity,
}

/// Full ordered list of copied fields; identical on every success so parity
/// harnesses can compare evidence byte-for-byte.
pub fn copied_field_evidence() -> Vec<TransformCopiedFieldV2> {
    vec![
        TransformCopiedFieldV2::Species,
        TransformCopiedFieldV2::FormKey,
        TransformCopiedFieldV2::Typing,
        TransformCopiedFieldV2::Gender,
        TransformCopiedFieldV2::StatsExcludingHp,
        TransformCopiedFieldV2::StatStages,
        TransformCopiedFieldV2::MovesetPpCapped,
        TransformCopiedFieldV2::AbilityPresentationIdentity,
    ]
}

/// A validated plan: the exact overlay to stage, ready for
/// [`apply_transform_copy`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransformApplyPlanV2 {
    pub subject: PokemonId,
    pub source: PokemonId,
    pub trigger: TransformCopyTriggerV2,
    pub copied: TransformCopiedBattleStateV2,
    pub evidence: Vec<TransformCopiedFieldV2>,
}

/// Outcome kind recorded in every transition's evidence.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransformTransitionKindV2 {
    Applied,
    IdempotentRepeat,
    Cleared,
    ClearNoOp,
}

/// Deterministic evidence returned alongside the new state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformTransitionEvidenceV2 {
    pub subject: PokemonId,
    pub source: Option<PokemonId>,
    pub trigger: Option<TransformCopyTriggerV2>,
    pub kind: TransformTransitionKindV2,
    pub copied_fields: Vec<TransformCopiedFieldV2>,
}

/// Output of one pure transition: new state plus its evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransformFormCopyTransitionV2 {
    pub state: TransformFormCopyStateV2,
    pub evidence: TransformTransitionEvidenceV2,
}

/// Validates the closed guard set and projects the target onto the canonical
/// copy payload. Pure: returns the plan without touching any state.
pub fn plan_transform_copy(
    facts: &TransformImposterFactsV2,
) -> Result<TransformApplyPlanV2, TransformImposterError> {
    let Some(target) = facts.target.as_ref() else {
        return Err(TransformImposterError::MissingTarget);
    };
    if facts.subject.pokemon == target.pokemon {
        return Err(TransformImposterError::SelfTarget);
    }
    if facts.subject.fainted {
        return Err(TransformImposterError::TerminalSubject);
    }
    if target.fainted {
        return Err(TransformImposterError::TerminalTarget);
    }
    // Frozen TypeScript guard: neither side may already be transformed.
    if facts.subject.transformed || target.transformed {
        return Err(TransformImposterError::AlreadyTransformed);
    }
    // Frozen TypeScript `canTransformInto` blockers, checked in oracle
    // order after the transformed guard: illusions on either side, then a
    // substitute on the target, then fusion on either side.
    if target.behind_illusion {
        return Err(TransformImposterError::TargetIllusion);
    }
    if facts.subject.behind_illusion {
        return Err(TransformImposterError::SubjectIllusion);
    }
    if target.has_substitute {
        return Err(TransformImposterError::TargetSubstitute);
    }
    if facts.subject.fusion {
        return Err(TransformImposterError::SubjectFusion);
    }
    if target.fusion {
        return Err(TransformImposterError::TargetFusion);
    }

    let mut moveset = Vec::with_capacity(target.moveset.len());
    for slot in &target.moveset {
        moveset.push(TransformCopiedMoveV2 {
            move_id: slot.move_id,
            // Frozen clamp: `Math.min(m.getMove().pp, 5)`.
            pp: slot.pp.min(TRANSFORM_COPIED_PP_CAP),
        });
    }
    let copied = TransformCopiedBattleStateV2 {
        species: target.species,
        form_key: target.form_key.clone(),
        typing: target.typing,
        gender: target.gender,
        stats: TransformCopiedStatsV2::from_battle_stats(&target.stats),
        stages: target.stages,
        moveset,
        abilities: target.abilities,
    };
    copied
        .validate()
        .map_err(TransformImposterError::InvalidCopiedState)?;

    Ok(TransformApplyPlanV2 {
        subject: facts.subject.pokemon,
        source: target.pokemon,
        trigger: facts.trigger,
        copied,
        evidence: copied_field_evidence(),
    })
}

/// Applies a validated plan to canonical state. Idempotent: repeating the
/// identical live plan returns the unchanged state with
/// [`TransformTransitionKindV2::IdempotentRepeat`]; staging a different copy
/// while one is live fails closed. The input state is never mutated.
pub fn apply_transform_copy(
    state: &TransformFormCopyStateV2,
    plan: &TransformApplyPlanV2,
) -> Result<TransformFormCopyTransitionV2, TransformImposterError> {
    state
        .validate()
        .map_err(TransformImposterError::InvalidInputState)?;
    plan.copied
        .validate()
        .map_err(TransformImposterError::InvalidCopiedState)?;
    let entry =
        TransformCopyEntryV2::active(plan.subject, plan.trigger, plan.source, plan.copied.clone())
            .map_err(TransformImposterError::InvalidCopiedState)?;

    let mut next = state.clone();
    match next
        .entries
        .iter()
        .position(|existing| existing.subject == plan.subject)
    {
        Some(index) => {
            if state.entries[index].active {
                let existing = &state.entries[index];
                let identical = existing.trigger == entry.trigger
                    && existing.source == entry.source
                    && existing.copied.as_ref() == entry.copied.as_ref();
                if !identical {
                    return Err(TransformImposterError::ConflictingActiveCopy {
                        subject: plan.subject,
                    });
                }
                // Idempotent repeat: the state stays exactly as it was.
                return Ok(TransformFormCopyTransitionV2 {
                    state: next,
                    evidence: TransformTransitionEvidenceV2 {
                        subject: plan.subject,
                        source: Some(plan.source),
                        trigger: Some(plan.trigger),
                        kind: TransformTransitionKindV2::IdempotentRepeat,
                        copied_fields: plan.evidence.clone(),
                    },
                });
            }
            next.entries[index] = entry;
        }
        None => {
            next.upsert(entry)
                .map_err(TransformImposterError::InvalidOutputState)?;
        }
    }

    next.validate()
        .map_err(TransformImposterError::InvalidOutputState)?;
    Ok(TransformFormCopyTransitionV2 {
        state: next,
        evidence: TransformTransitionEvidenceV2 {
            subject: plan.subject,
            source: Some(plan.source),
            trigger: Some(plan.trigger),
            kind: TransformTransitionKindV2::Applied,
            copied_fields: plan.evidence.clone(),
        },
    })
}

/// Clears the transform overlay for `subject`, keeping its stable tombstone
/// entry registered under the same identity. Idempotent: clearing an absent
/// or already-inactive subject reports [`TransformTransitionKindV2::ClearNoOp`]
/// over an unchanged clone of the input.
pub fn clear_transform_copy(
    state: &TransformFormCopyStateV2,
    subject: PokemonId,
) -> Result<TransformFormCopyTransitionV2, TransformImposterError> {
    state
        .validate()
        .map_err(TransformImposterError::InvalidInputState)?;

    let mut next = state.clone();
    let active_index = next
        .entries
        .iter()
        .position(|entry| entry.subject == subject && entry.active);
    match active_index {
        Some(index) => {
            next.entries[index] = TransformCopyEntryV2::cleared(subject);
            next.validate()
                .map_err(TransformImposterError::InvalidOutputState)?;
            Ok(TransformFormCopyTransitionV2 {
                state: next,
                evidence: TransformTransitionEvidenceV2 {
                    subject,
                    source: None,
                    trigger: None,
                    kind: TransformTransitionKindV2::Cleared,
                    copied_fields: Vec::new(),
                },
            })
        }
        None => Ok(TransformFormCopyTransitionV2 {
            state: next,
            evidence: TransformTransitionEvidenceV2 {
                subject,
                source: None,
                trigger: None,
                kind: TransformTransitionKindV2::ClearNoOp,
                copied_fields: Vec::new(),
            },
        }),
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TransformImposterError {
    #[error("input transform form-copy state is invalid: {0}")]
    InvalidInputState(#[source] TransformFormCopyStateError),
    #[error("transform target battler is missing")]
    MissingTarget,
    #[error("transform cannot copy the acting battler itself")]
    SelfTarget,
    #[error("fainted battlers cannot perform a transform copy")]
    TerminalSubject,
    #[error("transform target is terminal and cannot be copied")]
    TerminalTarget,
    #[error("neither side of a transform may already be transformed")]
    AlreadyTransformed,
    #[error("transform target is behind an illusion and cannot be copied")]
    TargetIllusion,
    #[error("an illusioned battler cannot perform a transform copy")]
    SubjectIllusion,
    #[error("a battler behind a substitute cannot be copied by transform")]
    TargetSubstitute,
    #[error("fusion battlers cannot perform a transform copy")]
    SubjectFusion,
    #[error("fusion battlers cannot be copied by transform")]
    TargetFusion,
    #[error("staged copy payload is invalid: {0}")]
    InvalidCopiedState(#[source] TransformFormCopyStateError),
    #[error("battler {subject:?} already carries a different live transform copy")]
    ConflictingActiveCopy { subject: PokemonId },
    #[error("candidate output state is invalid: {0}")]
    InvalidOutputState(#[source] TransformFormCopyStateError),
}

#[cfg(test)]
mod tests {
    use er_types::battle_ids::{AbilityId, BattleSide};
    use super::TransformTransitionKindV2 as Kind;
    use super::*;

    const SUBJECT_ID: u64 = 10;
    const SOURCE_ID: u64 = 20;
    const OTHER_ID: u64 = 30;

    fn pid(value: u64) -> PokemonId {
        PokemonId::try_from_u64(value).expect("in-range pokemon id")
    }

    fn slot(position: u8) -> FieldSlot {
        FieldSlot::new(BattleSide::Player, position).expect("valid slot")
    }

    fn species(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("in-range species id")
    }

    fn ability(value: u64) -> AbilityId {
        AbilityId::try_from_u64(value).expect("in-range ability id")
    }

    fn move_id(value: u64) -> MoveId {
        MoveId::try_from_u64(value).expect("in-range move id")
    }

    fn battler(id: u64, hp: u32, attack: u32) -> TransformBattlerFactsV2 {
        TransformBattlerFactsV2 {
            pokemon: pid(id),
            slot: slot(if id == SUBJECT_ID { 0 } else { 1 }),
            fainted: false,
            transformed: false,
            behind_illusion: false,
            has_substitute: false,
            fusion: false,
            species: species(if id == SOURCE_ID { 6 } else { 25 }),
            form_key: FormId::parse("1").expect("non-empty"),
            typing: PokemonTyping {
                primary: er_types::battle_model::PokemonType::Fire,
                secondary: Some(er_types::battle_model::PokemonType::Flying),
            },
            gender: TransformCopiedGenderV2::Male,
            stats: BattleStats {
                hp,
                attack,
                defense: 60,
                special_attack: 70,
                special_defense: 65,
                speed: 90,
            },
            stages: StatStages {
                attack: 1,
                defense: 0,
                special_attack: -1,
                special_defense: 0,
                speed: 2,
                accuracy: 0,
                evasion: 0,
            },
            moveset: vec![
                TransformSourceMoveFactsV2 {
                    move_id: move_id(17),
                    pp: 35,
                },
                TransformSourceMoveFactsV2 {
                    move_id: move_id(84),
                    pp: 3,
                },
                TransformSourceMoveFactsV2 {
                    move_id: move_id(97),
                    pp: TRANSFORM_COPIED_PP_CAP + 4,
                },
            ],
            abilities: TransformCopiedAbilitiesV2 {
                active: ability(58),
                passives: [Some(ability(66)), None, Some(ability(34))],
            },
        }
    }

    fn facts(
        subject: TransformBattlerFactsV2,
        target: Option<TransformBattlerFactsV2>,
    ) -> TransformImposterFactsV2 {
        TransformImposterFactsV2 {
            trigger: TransformCopyTriggerV2::MoveTransform,
            subject,
            target,
        }
    }

    fn standard_plan() -> TransformApplyPlanV2 {
        plan_transform_copy(&facts(
            battler(SUBJECT_ID, 100, 55),
            Some(battler(SOURCE_ID, 42, 81)),
        ))
        .expect("plan must succeed")
    }

    fn applied_transition() -> TransformFormCopyTransitionV2 {
        apply_transform_copy(&TransformFormCopyStateV2::new(), &standard_plan())
            .expect("apply must succeed")
    }

    #[test]
    fn plan_copies_every_supported_field_and_excludes_hp() {
        let plan = standard_plan();

        assert_eq!(plan.evidence, copied_field_evidence());
        let copied = &plan.copied;
        // Presentation identity comes entirely from the source.
        assert_eq!(plan.source, pid(SOURCE_ID));
        assert_eq!(copied.species, species(6));
        assert_eq!(copied.form_key.as_str(), "1");
        assert_eq!(
            copied.typing.primary,
            er_types::battle_model::PokemonType::Fire
        );
        assert_eq!(copied.gender, TransformCopiedGenderV2::Male);
        assert_eq!(copied.abilities.active, ability(58));
        assert_eq!(copied.abilities.passives[0], Some(ability(66)));
        assert_eq!(copied.abilities.passives[2], Some(ability(34)));
        // Stats carry the source's values with HP structurally absent.
        assert_eq!(copied.stats.attack, 81);
        assert_eq!(copied.stats.speed, 90);
        // Stages copy verbatim, including negative values.
        assert_eq!(copied.stages.attack, 1);
        assert_eq!(copied.stages.special_attack, -1);
        assert_eq!(copied.stages.speed, 2);
        // Moveset copies in order with PP capped at five.
        assert_eq!(copied.moveset.len(), 3);
        assert_eq!(
            copied.moveset[0],
            TransformCopiedMoveV2 {
                move_id: move_id(17),
                pp: 5
            }
        );
        assert_eq!(copied.moveset[1].pp, 3);
        assert_eq!(
            copied.moveset[2],
            TransformCopiedMoveV2 {
                move_id: move_id(97),
                pp: TRANSFORM_COPIED_PP_CAP
            }
        );
    }

    #[test]
    fn apply_is_pure_and_preserves_excluded_fields() {
        let before = TransformFormCopyStateV2::new();
        let transition = applied_transition();
        // The pure transition left its input untouched.
        assert_eq!(before, TransformFormCopyStateV2::new());
        // Stable identities survive: subject keeps its own id, source is
        // recorded as evidence only.
        let entry = &transition.state.entries[0];
        assert_eq!(transition.state.entries.len(), 1);
        assert_eq!(entry.subject, pid(SUBJECT_ID));
        assert_eq!(entry.source, Some(pid(SOURCE_ID)));
        assert!(entry.active);
        // No excluded field can appear in serialized state: HP has no field
        // on copied stats, status/owner have no field anywhere.
        let serialized = serde_json::to_string(&transition.state).expect("serialize");
        let lowered = serialized.to_ascii_lowercase();
        assert!(!lowered.contains("\"hp\""));
        assert!(!lowered.contains("status"));
        assert!(!lowered.contains("owner"));
        // Round-trip through canonical JSON is lossless.
        let round_tripped: TransformFormCopyStateV2 =
            serde_json::from_str(&serialized).expect("deserialize");
        assert_eq!(round_tripped, transition.state);
        assert!(
            serde_json::from_str::<TransformFormCopyStateV2>(
                &serialized.replace("\"active\":true", "\"active\":true,\"stale\":1"),
            )
            .is_err()
        );
    }

    #[test]
    fn duplicate_identical_application_is_idempotent() {
        let first = applied_transition();
        let second = apply_transform_copy(&first.state, &standard_plan())
            .expect("repeat must be idempotent");
        assert_eq!(second.evidence.kind, Kind::IdempotentRepeat);
        assert_eq!(second.state, first.state);

        // Conflicting different copy fails closed and leaves input intact.
        let conflicting_plan = plan_transform_copy(&facts(
            battler(SUBJECT_ID, 100, 55),
            Some(battler(OTHER_ID, 33, 44)),
        ))
        .expect("conflicting plan itself must succeed");
        assert_eq!(
            apply_transform_copy(&first.state, &conflicting_plan),
            Err(TransformImposterError::ConflictingActiveCopy {
                subject: pid(SUBJECT_ID),
            })
        );
    }

    #[test]
    fn clear_is_idempotent_and_keeps_stable_identity() {
        let applied = applied_transition();
        let cleared =
            clear_transform_copy(&applied.state, pid(SUBJECT_ID)).expect("clear must succeed");
        assert_eq!(cleared.evidence.kind, Kind::Cleared);
        let entry = &cleared.state.entries[0];
        assert_eq!(entry.subject, pid(SUBJECT_ID));
        assert!(!entry.active);
        assert_eq!(entry.copied, None);
        assert_eq!(entry.source, None);

        let repeat = clear_transform_copy(&cleared.state, pid(SUBJECT_ID))
            .expect("repeat clear must succeed");
        assert_eq!(repeat.evidence.kind, Kind::ClearNoOp);
        assert_eq!(repeat.state, cleared.state);

        let unknown = clear_transform_copy(&cleared.state, pid(999))
            .expect("clearing an unknown subject is a no-op");
        assert_eq!(unknown.evidence.kind, Kind::ClearNoOp);
        assert_eq!(unknown.state, cleared.state);

        // After a clear the identical copy can be staged again.
        let reapplied = apply_transform_copy(&cleared.state, &standard_plan())
            .expect("reapply after clear must succeed");
        assert_eq!(reapplied.evidence.kind, Kind::Applied);
        assert_eq!(reapplied.state, applied.state);
    }

    #[test]
    fn guards_fail_closed_on_invalid_targets_without_mutating_input() {
        let base_subject = battler(SUBJECT_ID, 100, 55);
        let valid_target = battler(SOURCE_ID, 42, 81);

        assert_eq!(
            plan_transform_copy(&facts(base_subject.clone(), None)),
            Err(TransformImposterError::MissingTarget)
        );
        assert_eq!(
            plan_transform_copy(&facts(base_subject.clone(), Some(base_subject.clone()))),
            Err(TransformImposterError::SelfTarget)
        );

        let mut terminal_subject = base_subject.clone();
        terminal_subject.fainted = true;
        assert_eq!(
            plan_transform_copy(&facts(terminal_subject, Some(valid_target.clone()))),
            Err(TransformImposterError::TerminalSubject)
        );

        let mut terminal_target = valid_target.clone();
        terminal_target.fainted = true;
        assert_eq!(
            plan_transform_copy(&facts(base_subject.clone(), Some(terminal_target))),
            Err(TransformImposterError::TerminalTarget)
        );

        let mut transformed_subject = base_subject.clone();
        transformed_subject.transformed = true;
        assert_eq!(
            plan_transform_copy(&facts(transformed_subject, Some(valid_target.clone()))),
            Err(TransformImposterError::AlreadyTransformed)
        );
        let mut transformed_target = valid_target;
        transformed_target.transformed = true;
        assert_eq!(
            plan_transform_copy(&facts(base_subject, Some(transformed_target))),
            Err(TransformImposterError::AlreadyTransformed)
        );

        // Error paths leave any input state exactly unchanged.
        let applied = applied_transition();
        assert_eq!(
            clear_transform_copy(&applied.state, pid(999)).expect("no-op clear"),
            TransformFormCopyTransitionV2 {
                state: applied.state.clone(),
                evidence: TransformTransitionEvidenceV2 {
                    subject: pid(999),
                    source: None,
                    trigger: None,
                    kind: Kind::ClearNoOp,
                    copied_fields: Vec::new(),
                },
            }
        );
    }

    #[test]
    fn oracle_blockers_fail_closed_distinctly() {
        let base_subject = battler(SUBJECT_ID, 100, 55);
        let valid_target = battler(SOURCE_ID, 42, 81);

        // Illusion on either side, target checked first (oracle order).
        let mut illusioned_target = valid_target.clone();
        illusioned_target.behind_illusion = true;
        assert_eq!(
            plan_transform_copy(&facts(base_subject.clone(), Some(illusioned_target))),
            Err(TransformImposterError::TargetIllusion)
        );
        let mut illusioned_subject = base_subject.clone();
        illusioned_subject.behind_illusion = true;
        assert_eq!(
            plan_transform_copy(&facts(illusioned_subject, Some(valid_target.clone()))),
            Err(TransformImposterError::SubjectIllusion)
        );

        // Substitute only blocks the copied side.
        let mut substituted_target = valid_target.clone();
        substituted_target.has_substitute = true;
        assert_eq!(
            plan_transform_copy(&facts(base_subject.clone(), Some(substituted_target))),
            Err(TransformImposterError::TargetSubstitute)
        );

        // Fusion is excluded on both sides, subject checked first.
        let mut fusion_subject = base_subject;
        fusion_subject.fusion = true;
        assert_eq!(
            plan_transform_copy(&facts(fusion_subject, Some(valid_target.clone()))),
            Err(TransformImposterError::SubjectFusion)
        );
        let mut fusion_target = valid_target;
        fusion_target.fusion = true;
        assert_eq!(
            plan_transform_copy(&facts(battler(SUBJECT_ID, 100, 55), Some(fusion_target))),
            Err(TransformImposterError::TargetFusion)
        );
    }

    #[test]
    fn invalid_copied_values_fail_closed_before_any_mutation() {
        // Uncapped PP above the frozen cap cannot occur through the planner's
        // clamp, so hand-built payloads are rejected at validation.
        let mut plan = standard_plan();
        plan.copied.moveset[0].pp = TRANSFORM_COPIED_PP_CAP + 1;
        let applied = applied_transition();
        assert_eq!(
            apply_transform_copy(&applied.state, &plan),
            Err(TransformImposterError::InvalidCopiedState(
                TransformFormCopyStateError::CopiedPpAboveCap {
                    pp: TRANSFORM_COPIED_PP_CAP + 1,
                    cap: TRANSFORM_COPIED_PP_CAP,
                }
            ))
        );

        let mut zero_species = standard_plan();
        zero_species.copied.species = SafeU53::ZERO;
        assert_eq!(
            apply_transform_copy(&TransformFormCopyStateV2::new(), &zero_species),
            Err(TransformImposterError::InvalidCopiedState(
                TransformFormCopyStateError::ZeroSpecies
            ))
        );

        let mut bad_stage = standard_plan();
        bad_stage.copied.stages.evasion = 7;
        assert_eq!(
            apply_transform_copy(&TransformFormCopyStateV2::new(), &bad_stage),
            Err(TransformImposterError::InvalidCopiedState(
                TransformFormCopyStateError::StatStageOutOfRange
            ))
        );

        // Input state untouched by every rejected application.
        assert_eq!(applied.state.entries[0].subject, pid(SUBJECT_ID));
    }

    #[test]
    fn independent_subjects_apply_in_canonical_order() {
        let first = applied_transition();
        let other_plan = plan_transform_copy(&facts(
            battler(OTHER_ID, 70, 40),
            Some(battler(SOURCE_ID, 42, 81)),
        ))
        .expect("second plan must succeed");
        let second =
            apply_transform_copy(&first.state, &other_plan).expect("second apply must succeed");
        assert_eq!(second.evidence.kind, Kind::Applied);
        let subjects: Vec<u64> = second
            .state
            .entries
            .iter()
            .map(|entry| entry.subject.get().get())
            .collect();
        assert_eq!(
            subjects,
            vec![SUBJECT_ID.min(OTHER_ID), SUBJECT_ID.max(OTHER_ID)]
        );
        second.state.validate().expect("output state must validate");
    }
}
