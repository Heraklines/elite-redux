//! M6 bespoke move-copy/call family and exhaustive `CUSTOM_DISPATCH` closure.
//!
//! Two responsibilities live here:
//!
//! 1. **Copy / call / random-selection mechanics** over the canonical
//!    [`MoveCopyStateV2`] history (`er-state::bespoke_v2::move_copy`):
//!    stable ordered bounded move-history recording, last-move eligibility
//!    mirroring TypeScript `getLastNonVirtualMove`, Copycat/Mirror Move/Mimic/
//!    Sketch resolution, and audited random selection (Metronome/Assist/
//!    Sleep Talk). No RNG is implemented in this module: the caller supplies
//!    an already-drawn, audited choice index and this module turns it into a
//!    deterministic, replayable call plan.
//! 2. **Typed classification/dispatch for all 394 `MOVE`-source behavior
//!    units of the frozen `CUSTOM_DISPATCH` cluster** (pinned at integration
//!    base `1931f32a8`). Every unit resolves to either an explicit
//!    [`CopyCallVariant`] family variant or an ordinary executable
//!    [`ExecutableOp`] operation routed by the unit's semantic
//!    implementation base / effect kind / hook axes. There is no unsupported
//!    or no-op residual: an unknown attribute or a descriptor whose catalog
//!    axes disagree with the frozen table is a hard classification error.
//! Every transition is pure: inputs are validated, outputs are cloned into
//! fresh typed state, results are re-validated, and nothing mutates its
//! arguments. Failures that are legitimate battle outcomes are typed values
//! ([`MoveCopyFailure`]); invariant violations are errors
//! ([`MoveCopyTransitionError`]).

use std::collections::BTreeSet;

use er_state::bespoke_v2::move_copy::{
    MoveCopyStateError, MoveCopyStateV2, MoveHistoryEntryV2, MoveOutcomeV2, MoveUseModeV2,
    STRUGGLE_MOVE_ID,
};
use er_types::battle_ids::{MoveId, PokemonId};
use er_types::ids::SafeU53;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Frozen identities
// ---------------------------------------------------------------------------

/// The seven copy/call/random-selection moves of this family, frozen at base
/// `1931f32a8` (semantic-catalog-v1.json, `CUSTOM_DISPATCH`):
/// MIMIC=102, METRONOME=118, COPYCAT=119, SKETCH=166, ASSIST=214,
/// SLEEP_TALK=274, MIRROR_MOVE=383. A dispatch-family move selected by
/// another dispatch-family effect is recursion and is rejected.
pub fn is_dispatch_family_move(move_id: MoveId) -> bool {
    matches!(move_id.get().get(), 102 | 118 | 119 | 166 | 214 | 274 | 383)
}

/// Frozen total size of the classified closure: every `MOVE`-source
/// behavior unit of `CUSTOM_DISPATCH`. Tests assert the route table closes
/// over exactly this many units.
pub const CLOSURE_TOTAL_UNITS: usize = 394;

// ---------------------------------------------------------------------------
// Transition errors and typed failures
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MoveCopyTransitionError {
    #[error("move-copy state rejected the transition: {0}")]
    State(#[from] MoveCopyStateError),
    /// A legitimate mechanical failure: the effect fails as in the pinned
    /// TypeScript semantics ("attack failed"), never a panic or silent no-op.
    #[error("move-copy effect failed: {0}")]
    Failed(#[from] MoveCopyFailure),
    #[error(
        "audited choice index {index} is outside the closed candidate set of {candidate_count}"
    )]
    ChoiceOutOfRange {
        candidate_count: usize,
        index: usize,
    },
    #[error("candidate set contains the NONE move identity")]
    InvalidCandidateSet,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MoveCopyFailure {
    #[error("no eligible non-virtual last move exists for the requested source")]
    NoEligibleLastMove,
    #[error("move {move_id} is forbidden by content policy for this effect")]
    ForbiddenByContent { move_id: u64 },
    #[error("dispatch-family move {move_id} cannot be selected by another dispatch effect")]
    DispatchFamilyRecursion { move_id: u64 },
    #[error("charging move {move_id} never completed its charge and cannot be copied")]
    ChargingMoveIncomplete { move_id: u64 },
    #[error("move {move_id} is already known by the copier and cannot be sketched")]
    SketchAlreadyKnown { move_id: u64 },
    #[error("the invoking move has no slot in the caller's moveset to replace")]
    NoInvokingSlot,
    #[error("no callable candidate remains after closed filtering")]
    EmptyCandidateSet,
}

// ---------------------------------------------------------------------------
// Recording executions
// ---------------------------------------------------------------------------

/// Request to append one executed move to an actor's stable history.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordRequest {
    pub actor: PokemonId,
    pub summon_generation: u32,
    pub move_id: MoveId,
    pub use_mode: MoveUseModeV2,
    pub outcome: MoveOutcomeV2,
}

/// Evidence produced by a successful recording.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordEvidence {
    pub entry: MoveHistoryEntryV2,
    /// Entry evicted oldest-first when the frozen bound was exceeded.
    pub evicted: Option<MoveHistoryEntryV2>,
}

/// Pure recording transition: fresh state plus append evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordedExecution {
    pub state: MoveCopyStateV2,
    pub evidence: RecordEvidence,
}

/// Validates the request, clones state, appends the entry, re-validates.
pub fn record_execution(
    state: &MoveCopyStateV2,
    request: &RecordRequest,
) -> Result<RecordedExecution, MoveCopyTransitionError> {
    if request.move_id.get() == SafeU53::ZERO {
        return Err(MoveCopyTransitionError::State(
            MoveCopyStateError::ZeroMoveId,
        ));
    }
    let (updated, entry, evicted) = state.with_recorded_entry(
        request.actor,
        request.summon_generation,
        request.move_id,
        request.use_mode,
        request.outcome,
    )?;
    Ok(RecordedExecution {
        state: updated,
        evidence: RecordEvidence { entry, evicted },
    })
}

// ---------------------------------------------------------------------------
// Last-move queries
// ---------------------------------------------------------------------------

/// Mirrors TypeScript `getLastNonVirtualMove(ignoreStruggle, ignoreFollowUp)`.
///
/// `ignore_follow_up = true` (the default everywhere except Mirror Move)
/// excludes follow-up casts so a Copycat chain cannot loop through itself;
/// Mirror Move passes `false` so reflected follow-ups remain eligible.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LastMoveFilter {
    pub ignore_struggle: bool,
    pub ignore_follow_up: bool,
}

impl LastMoveFilter {
    /// `getLastNonVirtualMove()` defaults: keep struggle, drop follow-ups.
    pub const DEFAULT: Self = Self {
        ignore_struggle: false,
        ignore_follow_up: true,
    };

    /// Mirror Move's `getLastNonVirtualMove(false, false)`: struggle and
    /// follow-ups both stay eligible.
    pub const MIRROR_MOVE: Self = Self {
        ignore_struggle: false,
        ignore_follow_up: false,
    };
}

fn matches_last_non_virtual(entry: &MoveHistoryEntryV2, filter: &LastMoveFilter) -> bool {
    entry.move_id.get() != SafeU53::ZERO
        && (!filter.ignore_struggle || entry.move_id.get().get() != STRUGGLE_MOVE_ID)
        && (!entry.use_mode.is_virtual()
            || (!filter.ignore_follow_up && entry.use_mode == MoveUseModeV2::FollowUp))
}

/// Newest eligible non-virtual execution for `actor`; stale actors error.
pub fn last_non_virtual(
    state: &MoveCopyStateV2,
    actor: PokemonId,
    summon_generation: u32,
    filter: &LastMoveFilter,
) -> Result<Option<MoveHistoryEntryV2>, MoveCopyTransitionError> {
    state
        .last_matching(actor, summon_generation, |entry| {
            matches_last_non_virtual(entry, filter)
        })
        .map_err(MoveCopyTransitionError::from)
}

// ---------------------------------------------------------------------------
// Copy / call resolution
// ---------------------------------------------------------------------------

/// Where a recorded-last copy reads its source move from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RecordedLastSource {
    /// Copycat: the battle-scoped `Battle.lastMove`.
    BattleLastMove { last_move: Option<MoveId> },
    /// Mirror Move / Mimic / Sketch: the target's recorded history.
    ActorHistory {
        target: PokemonId,
        summon_generation: u32,
        filter: LastMoveFilter,
    },
}

/// Content-supplied closed sets (no content lookups inside this module).
#[derive(Clone, Copy, Debug)]
pub struct ContentMoveSets<'a> {
    /// Moves this effect must refuse (e.g. `invalidMetronomeMoves`).
    pub forbidden: &'a BTreeSet<MoveId>,
    /// Moves that charge across turns; copying one mid-charge fails.
    pub charging_moves: &'a BTreeSet<MoveId>,
}

/// PP/ownership rules captured as a typed decision. The frozen rule for the
/// whole family: a called move executes as a follow-up that charges no PP
/// anywhere and leaves the caller's own moveslots untouched; slot-replacing
/// variants (Mimic/Sketch) instead take over the invoking slot itself.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PpOwnershipDecision {
    /// FOLLOW_UP cast: no PP charged, no moveslot touched.
    FollowUpNoCharge,
    /// Mimic/Sketch replacement: the invoking slot adopts the copied move.
    SlotReplacementAdopted,
}

/// Targeting plan for a called cast.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CallTargeting {
    /// Mirror Move: the copied attack returns to its original attacker.
    Retaliate { target: PokemonId },
    /// Standard targeting resolved downstream by the move pipeline.
    NormalTargeting,
}

impl CallTargeting {
    pub fn targets(self) -> Vec<PokemonId> {
        match self {
            Self::Retaliate { target } => vec![target],
            Self::NormalTargeting => Vec::new(),
        }
    }
}

/// Deterministic replay token of a resolved call: equal tokens mean the same
/// battle-observable call decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CastReplayToken {
    pub called_move: MoveId,
    pub use_mode: MoveUseModeV2,
    pub targeting: CallTargeting,
}

/// A resolved immediate cast of another move.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CalledCastPlan {
    pub called_move: MoveId,
    pub use_mode: MoveUseModeV2,
    pub pp_decision: PpOwnershipDecision,
    pub targeting: CallTargeting,
}

impl CalledCastPlan {
    pub fn replay_token(&self) -> CastReplayToken {
        CastReplayToken {
            called_move: self.called_move,
            use_mode: self.use_mode,
            targeting: self.targeting,
        }
    }
}

/// Mimic/Sketch-style slot adoption outcome.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SlotReplacement {
    pub slot: u8,
    pub copied_move: MoveId,
    /// Sketch replaces permanently; Mimic only for the current summon.
    pub permanent: bool,
    pub pp_decision: PpOwnershipDecision,
}

/// Typed success of a recorded-last copy resolution.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopyCallOutcome {
    Cast(CalledCastPlan),
    ReplaceMoveslot(SlotReplacement),
}

/// Evidence trail of a successful copy resolution.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CopyCallEvidence {
    /// History ordinal of the copied actor entry, when sourced from history.
    pub source_ordinal: Option<SafeU53>,
    pub copied_move: MoveId,
    /// True when the source passed the closed forbidden-move set unchanged.
    pub forbidden_set_checked: bool,
}

/// Full transition result of a copy resolution.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedCopyCall {
    /// Copy resolution consults state read-only; the updated root is echoed
    /// unchanged so callers can thread uniform transition plumbing.
    pub state_after: MoveCopyStateV2,
    pub outcome: CopyCallOutcome,
    pub evidence: CopyCallEvidence,
}

/// Inputs for resolving Copycat / Mirror Move / Mimic / Sketch.
#[derive(Clone, Debug)]
pub struct RecordedLastCopyRequest<'a> {
    pub caller: PokemonId,
    pub caller_generation: u32,
    /// Numeric identity of the invoking move (COPYCAT/MIRROR_MOVE/MIMIC/SKETCH).
    pub invoking_move: MoveId,
    pub source: RecordedLastSource,
    pub content: ContentMoveSets<'a>,
    /// Mirror Move retaliation target; ignored by slot-replacing variants.
    pub retaliate_target: Option<PokemonId>,
    /// Moveset slot occupied by the invoking move, required for Mimic/Sketch.
    pub invoking_slot: Option<u8>,
    /// Caller's current moveset; required for Sketch's uniqueness guard.
    pub caller_moveset: &'a [MoveId],
}

enum ResolvedLastMove {
    Battle(MoveId),
    FromHistory(MoveHistoryEntryV2),
}

fn resolve_source(
    state: &MoveCopyStateV2,
    source: &RecordedLastSource,
) -> Result<ResolvedLastMove, MoveCopyTransitionError> {
    match source {
        RecordedLastSource::BattleLastMove { last_move } => match last_move {
            Some(move_id) if move_id.get() != SafeU53::ZERO => {
                Ok(ResolvedLastMove::Battle(*move_id))
            }
            _ => Err(MoveCopyFailure::NoEligibleLastMove.into()),
        },
        RecordedLastSource::ActorHistory {
            target,
            summon_generation,
            filter,
        } => last_non_virtual(state, *target, *summon_generation, filter)?
            .map(ResolvedLastMove::FromHistory)
            .ok_or(MoveCopyFailure::NoEligibleLastMove.into()),
    }
}

/// Shared guard chain: content forbids → dispatch recursion → charging guard.
fn guard_copied_move(
    copied_move: MoveId,
    content: &ContentMoveSets<'_>,
) -> Result<(), MoveCopyTransitionError> {
    let id = copied_move.get().get();
    if content.forbidden.contains(&copied_move) {
        return Err(MoveCopyFailure::ForbiddenByContent { move_id: id }.into());
    }
    if is_dispatch_family_move(copied_move) {
        return Err(MoveCopyFailure::DispatchFamilyRecursion { move_id: id }.into());
    }
    Ok(())
}

/// Resolves Copycat (cast), Mirror Move (retaliating cast), Mimic and Sketch
/// (slot adoption) against the canonical history.
pub fn resolve_recorded_last_copy(
    state: &MoveCopyStateV2,
    request: &RecordedLastCopyRequest<'_>,
) -> Result<ResolvedCopyCall, MoveCopyTransitionError> {
    // Stale or unknown callers are rejected before any source is consulted.
    let caller_history = state.actor_history(request.caller)?;
    if caller_history.summon_generation != request.caller_generation {
        return Err(MoveCopyStateError::StaleActorGeneration {
            actor: request.caller,
            expected: caller_history.summon_generation,
            actual: request.caller_generation,
        }
        .into());
    }

    let (copied_move, source_ordinal) = match resolve_source(state, &request.source)? {
        ResolvedLastMove::Battle(move_id) => (move_id, None),
        ResolvedLastMove::FromHistory(entry) => (entry.move_id, Some(entry.execution_ordinal)),
    };

    guard_copied_move(copied_move, &request.content)?;
    let numeric = copied_move.get().get();

    // Mimic/Sketch share the charging-guard condition: a charging move whose
    // recorded turn ended in `Other` never completed and cannot be adopted.
    let slot_replacement = matches!(numeric, 102 /* MIMIC */ | 166 /* SKETCH */);
    if slot_replacement && request.content.charging_moves.contains(&copied_move) {
        let charging_incomplete = match &request.source {
            RecordedLastSource::ActorHistory { .. } => {
                matches!(
                    resolve_source(state, &request.source)?,
                    ResolvedLastMove::FromHistory(entry)
                        if entry.outcome == MoveOutcomeV2::Other
                )
            }
            RecordedLastSource::BattleLastMove { .. } => true,
        };
        if charging_incomplete {
            return Err(MoveCopyFailure::ChargingMoveIncomplete { move_id: numeric }.into());
        }
    }

    let permanent = numeric == 166; // SKETCH
    if slot_replacement {
        let slot = request
            .invoking_slot
            .ok_or(MoveCopyFailure::NoInvokingSlot)?;
        if permanent
            && request
                .caller_moveset
                .iter()
                .any(|known| *known == copied_move)
        {
            return Err(MoveCopyFailure::SketchAlreadyKnown { move_id: numeric }.into());
        }
        return Ok(ResolvedCopyCall {
            state_after: state.clone(),
            outcome: CopyCallOutcome::ReplaceMoveslot(SlotReplacement {
                slot,
                copied_move,
                permanent,
                pp_decision: PpOwnershipDecision::SlotReplacementAdopted,
            }),
            evidence: CopyCallEvidence {
                source_ordinal,
                copied_move,
                forbidden_set_checked: true,
            },
        });
    }

    let targeting = match request.retaliate_target {
        Some(target) => CallTargeting::Retaliate { target },
        None => CallTargeting::NormalTargeting,
    };
    let plan = CalledCastPlan {
        called_move: copied_move,
        use_mode: MoveUseModeV2::FollowUp,
        pp_decision: PpOwnershipDecision::FollowUpNoCharge,
        targeting,
    };
    Ok(ResolvedCopyCall {
        state_after: state.clone(),
        outcome: CopyCallOutcome::Cast(plan),
        evidence: CopyCallEvidence {
            source_ordinal,
            copied_move,
            forbidden_set_checked: true,
        },
    })
}

// ---------------------------------------------------------------------------
// Audited random selection (Metronome / Assist / Sleep Talk)
// ---------------------------------------------------------------------------

/// An externally drawn, auditable selection result. This module implements no
/// RNG; it only validates the draw against the closed candidate set.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuditedChoice {
    pub index: usize,
}

/// Selects deterministically from an already-closed candidate list.
///
/// Identical `(candidates, choice)` inputs always produce identical plans —
/// the boundary required for deterministic replay. The recursion guard runs
/// on the selected move even though candidates are pre-filtered by content.
pub fn select_random_call(
    candidates: &[MoveId],
    choice: &AuditedChoice,
) -> Result<CalledCastPlan, MoveCopyTransitionError> {
    if candidates.is_empty() {
        return Err(MoveCopyFailure::EmptyCandidateSet.into());
    }
    for candidate in candidates {
        if candidate.get() == SafeU53::ZERO {
            return Err(MoveCopyTransitionError::InvalidCandidateSet);
        }
    }
    if choice.index >= candidates.len() {
        return Err(MoveCopyTransitionError::ChoiceOutOfRange {
            candidate_count: candidates.len(),
            index: choice.index,
        });
    }
    let called_move = candidates[choice.index];
    if is_dispatch_family_move(called_move) {
        return Err(MoveCopyFailure::DispatchFamilyRecursion {
            move_id: called_move.get().get(),
        }
        .into());
    }
    Ok(CalledCastPlan {
        called_move,
        use_mode: MoveUseModeV2::FollowUp,
        pp_decision: PpOwnershipDecision::FollowUpNoCharge,
        targeting: CallTargeting::NormalTargeting,
    })
}

/// Deterministic replay proof: two resolutions of the same audited choice
/// carry identical replay tokens.
pub fn verify_deterministic_replay(first: &CalledCastPlan, second: &CalledCastPlan) -> bool {
    first.replay_token() == second.replay_token()
}

// ---------------------------------------------------------------------------
// Exhaustive CUSTOM_DISPATCH MOVE-source classifier (394 units)
// ---------------------------------------------------------------------------

/// Semantic implementation base axis (TypeScript attribute superclass).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CustomImplBase {
    AddArenaTag,
    AddBattlerTag,
    AddBattlerTagHeader,
    CallMove,
    ChangeMultiHitType,
    ConsecutiveUsePowerMultiplier,
    FixedDamage,
    ForceSwitchOut,
    Heal,
    HitHeal,
    Move,
    MoveEffect,
    MoveHeader,
    MoveTypeChartOverride,
    OneHitKOAccuracy,
    OverrideMoveEffect,
    Protect,
    ReducePpMove,
    RemoveArenaTags,
    Sacrificial,
    StatChangeBeforeDmgCalc,
    VariableAccuracy,
    VariableAtk,
    VariableDef,
    VariableMoveCategory,
    VariableMoveType,
    VariablePower,
    WeatherHeal,
}

/// Semantic effect-kind axis.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CustomEffectKind {
    Unresolved,
    Heal,
    ModifyType,
    ModifyWeather,
    ModifyTerrain,
}

/// Semantic hook axis.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CustomHook {
    Unresolved,
    MovePowerQuery,
    AccuracyQuery,
    PriorityQuery,
    TerrainChanged,
    WeatherChanged,
}

/// Catalog identity of one classifiable behavior unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CustomUnitRef<'a> {
    pub provenance_hash: &'a str,
    pub ordinal: u16,
    pub source_move: MoveId,
}

/// Frozen-catalog descriptor consumed by [`classify_custom_move`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CustomMoveUnitDescriptor<'a> {
    pub unit: CustomUnitRef<'a>,
    /// Exact TypeScript attribute name (e.g. `"FlinchAttr"`).
    pub attribute: &'a str,
    pub implementation_base: CustomImplBase,
    pub effect_kind: CustomEffectKind,
    pub hook: CustomHook,
}

/// Explicit bespoke copy/call/random-selection family variants.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopyCallVariant {
    /// CopyMoveAttr — Copycat/Mirror Move: cast the recorded last move.
    RecordedLast,
    /// MovesetCopyMoveAttr — Mimic: adopt the invoking slot for this summon.
    MimicSlotCopy,
    /// SketchAttr — permanent moveslot adoption of the target's last move.
    SketchPermanent,
    /// RandomMoveAttr — Metronome: audited random pick over the global table.
    GlobalRandom,
    /// RandomMovesetMoveAttr — Assist/Sleep Talk: random party/user moveset.
    MovesetRandom,
    /// NaturePowerAttr — terrain-determined call.
    TerrainCall,
    /// RepeatMoveAttr — Instruct: repeat the user's last own execution.
    RepeatLastOwn,
}

/// Ordinary executable operations, routed to the standard M6 surfaces.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutableOp {
    /// Power modifiers on `MOVE_POWER_QUERY` or variable-power bases.
    PowerQuery,
    /// Accuracy modifiers on `ACCURACY_QUERY`.
    AccuracyQuery,
    /// Priority increments on `PRIORITY_QUERY`.
    PriorityIncrement,
    /// Hit-count selection and multi-hit type shaping.
    MultiHit,
    /// Fixed-value damage override.
    FixedDamage,
    /// One-hit-KO damage resolution.
    Ohko,
    /// Offensive/defensive category overrides (Photon Geyser, Shell Side Arm…).
    CategoryOverride,
    /// Stat-substitution and pre-damage stat staging.
    StatOverride(StatOverrideSurface),
    /// Attacker/defender typing and type-chart modifications.
    TypeOverride(TypeOverrideLayer),
    /// Weather creation or clearing on `WEATHER_CHANGED`.
    WeatherSet { clear_only: bool },
    /// Terrain creation or clearing on `TERRAIN_CHANGED`.
    TerrainSet { clear_only: bool },
    /// HP restoration in a documented scope.
    Heal(HealScope),
    /// Volatile battler-tag application (flinch, confusion, curse…).
    VolatileTag(VolatileTagKind),
    /// Arena-tag add/remove, including pledge field effects and screen clears.
    ArenaTags { removal: bool },
    /// Recoil/drain fractions on after-damage.
    RecoilDrain(RecoilKind),
    /// Post-use self costs (faint, half HP, full restore…).
    Sacrifice(SacrificeKind),
    /// Forced switch-out.
    ForcedSwitchOut,
    /// Target-side PP reduction.
    PpReduction,
    /// Two-turn attacks, frenzies, Sky Drop release, deferred Wish healing.
    DelayedCommit(DelayedCommitKind),
    /// Ability change/copy/give effects.
    AbilityOp(AbilityOpKind),
    /// After You / next-round cueing.
    TurnOrderManipulation,
    /// Battle money awards.
    MoneyAward,
    /// Revival Blessing party revival.
    RevivalBlessing,
    /// Psycho Shift status transfer.
    StatusTransfer,
    /// Sleep-ignoring bypasses (Snore/Sleep Talk pre-move).
    SleepBypass,
    /// Combined-pledge awaiting side.
    PledgeCombo,
    /// Presentation cues at a pinned timing.
    Presentation(PresentationTiming),
    /// Pre-use header interrupts (Beak Blast, MoveHeaderAttr…).
    HeaderEffect,
    /// Protect-family guard activation.
    GuardProtection,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatOverrideSurface {
    Offensive,
    Defensive,
    BeforeDamageCalc,
    BoostSteal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TypeOverrideLayer {
    DerivedType,
    ChartOverride,
    Typelessness,
    TypeAddRemove,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HealScope {
    User,
    DrainOnHit,
    WeatherConditional,
    GroundedConditional,
    BoostedByModifier,
    Ally,
    StockpileRelease,
    Equalize,
    AverageWithTarget,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VolatileTagKind {
    Flinch,
    Confusion,
    LeechSeed,
    Trap,
    Exposure,
    ForcedLanding,
    TerrainConditional,
    Curse,
    DestinyBond,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoilKind {
    RecoilFraction,
    DelayedDrain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SacrificeKind {
    FaintAfterUse,
    FaintOnHit,
    HalfHpAfterUse,
    FullRestoreAfterUse,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DelayedCommitKind {
    Frenzy,
    TwoTurnAttack,
    DelayedRelease,
    DeferredHeal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbilityOpKind {
    Copy,
    Change,
    Give,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PresentationTiming {
    OnFailureImmunity,
    OnFailureMiss,
    OnExecution,
    BeforeExecution,
    Header,
}

/// Typed dispatch decision for one behavior unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CustomDispatchDecision<'a> {
    pub unit: CustomUnitRef<'a>,
    pub route: CustomDispatchRoute,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CustomDispatchRoute {
    /// Explicit bespoke copy/call/random-selection family variant.
    CopyCall(CopyCallVariant),
    /// Ordinary executable operation on the standard M6 surfaces.
    Executable(ExecutableOp),
}

/// Accepted catalog axes per attribute, frozen at base `1931f32a8`.
struct AttributeRoute {
    route: CustomDispatchRoute,
    accepted_bases: &'static [CustomImplBase],
    accepted_effects: &'static [CustomEffectKind],
    accepted_hooks: &'static [CustomHook],
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum DispatchClassificationError {
    #[error("attribute {attribute:?} is not part of the frozen 394-unit closure")]
    UnknownAttribute { attribute: String },
    #[error("descriptor axes for {attribute:?} diverge from the frozen catalog")]
    CatalogAxisMismatch { attribute: &'static str },
}

/// The frozen route table: one row per distinct attribute across all 394
/// `MOVE`-source `CUSTOM_DISPATCH` units (133 attributes). Generated from
/// semantic-catalog-v1.json ∩ bespoke-clusters-v1.json at base `1931f32a8`;
/// each row carries the exact base/effect/hook combinations observed there.
static ROUTE_TABLE: &[(&str, AttributeRoute)] = &[
    (
        "AbilityChangeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AbilityOp(AbilityOpKind::Change)),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AbilityCopyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AbilityOp(AbilityOpKind::Copy)),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AbilityGiveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AbilityOp(AbilityOpKind::Give)),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AddPledgeEffectAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::ArenaTags { removal: false }),
            accepted_bases: &[CustomImplBase::AddArenaTag],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AddTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::TypeAddRemove,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AfterYouAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TurnOrderManipulation),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AlwaysHitMinimizeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AccuracyQuery),
            accepted_bases: &[CustomImplBase::VariableAccuracy],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::AccuracyQuery],
        },
    ),
    (
        "AngelsWrathDrainAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::RecoilDrain(
                RecoilKind::DelayedDrain,
            )),
            accepted_bases: &[CustomImplBase::HitHeal],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AngelsWrathElectrowebAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::TwoTurnAttack,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AngelsWrathGroundSuperEffectiveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::TwoTurnAttack,
            )),
            accepted_bases: &[CustomImplBase::MoveTypeChartOverride],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AngelsWrathHazardAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::TwoTurnAttack,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AngelsWrathKingsShieldAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::TwoTurnAttack,
            )),
            accepted_bases: &[CustomImplBase::Protect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AngelsWrathSteelSuperEffectiveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::TwoTurnAttack,
            )),
            accepted_bases: &[CustomImplBase::MoveTypeChartOverride],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AngelsWrathTackleAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::TwoTurnAttack,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AntiSunlightPowerDecreaseAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AttackReducePpMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PpReduction),
            accepted_bases: &[CustomImplBase::ReducePpMove],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AuraWheelTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "AwaitCombinedPledgeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PledgeCombo),
            accepted_bases: &[CustomImplBase::OverrideMoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "BeakBlastHeaderAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::HeaderEffect),
            accepted_bases: &[CustomImplBase::AddBattlerTagHeader],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "BeatUpAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "BlizzardAccuracyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AccuracyQuery),
            accepted_bases: &[CustomImplBase::VariableAccuracy],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::AccuracyQuery],
        },
    ),
    (
        "BoostHealAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(
                HealScope::BoostedByModifier,
            )),
            accepted_bases: &[CustomImplBase::Heal],
            accepted_effects: &[CustomEffectKind::Heal],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "BypassSleepAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::SleepBypass),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ChangeTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::TypeAddRemove,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ChillyReceptionAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::WeatherSet { clear_only: false }),
            accepted_bases: &[CustomImplBase::ForceSwitchOut],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ClearTerrainAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TerrainSet { clear_only: true }),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyTerrain],
            accepted_hooks: &[CustomHook::TerrainChanged],
        },
    ),
    (
        "ClearWeatherAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::WeatherSet { clear_only: true }),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyWeather],
            accepted_hooks: &[CustomHook::WeatherChanged],
        },
    ),
    (
        "CombinedPledgePowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "CombinedPledgeTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "CompareWeightPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ConfuseAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::Confusion,
            )),
            accepted_bases: &[CustomImplBase::AddBattlerTag],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ConsecutiveUseDoublePowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::ConsecutiveUsePowerMultiplier],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ConsecutiveUseMultiBasePowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::ConsecutiveUsePowerMultiplier],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "CopyBiomeTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "CopyMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::CopyCall(CopyCallVariant::RecordedLast),
            accepted_bases: &[CustomImplBase::CallMove],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "CopyTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "CueNextRoundAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TurnOrderManipulation),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "CurseAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::Curse,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "DefAtkAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::StatOverride(
                StatOverrideSurface::Offensive,
            )),
            accepted_bases: &[CustomImplBase::VariableAtk],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "DefDefAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::StatOverride(
                StatOverrideSurface::Defensive,
            )),
            accepted_bases: &[CustomImplBase::VariableDef],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "DestinyBondAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::DestinyBond,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "DoublePowerChanceAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ElectroBallPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ErFlingPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ErNaturalGiftPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ErNaturalGiftTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ErSkyDropReleaseAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::DelayedRelease,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ExposedMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::Exposure,
            )),
            accepted_bases: &[CustomImplBase::AddBattlerTag],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "FallDownAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::ForcedLanding,
            )),
            accepted_bases: &[CustomImplBase::AddBattlerTag],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "FirstMoveTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "FlinchAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::Flinch,
            )),
            accepted_bases: &[CustomImplBase::AddBattlerTag],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "FlyingTypeMultiplierAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::ChartOverride,
            )),
            accepted_bases: &[CustomImplBase::MoveTypeChartOverride],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "FreezeDryAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::ChartOverride,
            )),
            accepted_bases: &[CustomImplBase::MoveTypeChartOverride],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "FrenzyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::Frenzy,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "FriendshipPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "GyroBallPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HalfSacrificialAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Sacrifice(
                SacrificeKind::HalfHpAfterUse,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HealAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(HealScope::User)),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Heal],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HealOnAllyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(HealScope::Ally)),
            accepted_bases: &[CustomImplBase::Heal],
            accepted_effects: &[CustomEffectKind::Heal],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HiddenPowerTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HitHealAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(HealScope::DrainOnHit)),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Heal],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HitsSameTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::MultiHit),
            accepted_bases: &[CustomImplBase::MoveTypeChartOverride],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HpPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "HpSplitAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(
                HealScope::AverageWithTarget,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "IceNoEffectTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::ChartOverride,
            )),
            accepted_bases: &[CustomImplBase::MoveTypeChartOverride],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "IgnoreWeatherTypeDebuffAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::WeatherChanged],
        },
    ),
    (
        "IncrementMovePriorityAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PriorityIncrement),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::PriorityQuery],
        },
    ),
    (
        "IvyCudgelTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "JawLockAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::Trap,
            )),
            accepted_bases: &[CustomImplBase::AddBattlerTag],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "LastMoveDoublePowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "LeechSeedAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::LeechSeed,
            )),
            accepted_bases: &[CustomImplBase::AddBattlerTag],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "LessPPMorePowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "LowHpPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MagnitudePowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MatchHpAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(HealScope::Equalize)),
            accepted_bases: &[CustomImplBase::FixedDamage],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MatchUserTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MessageAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Presentation(
                PresentationTiming::OnExecution,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MessageHeaderAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Presentation(
                PresentationTiming::Header,
            )),
            accepted_bases: &[CustomImplBase::MoveHeader],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MissEffectAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Presentation(
                PresentationTiming::OnFailureMiss,
            )),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MoneyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::MoneyAward),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MovePowerMultiplierAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::MovePowerQuery],
        },
    ),
    (
        "MovesetCopyMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::CopyCall(CopyCallVariant::MimicSlotCopy),
            accepted_bases: &[CustomImplBase::OverrideMoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MultiHitAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::MultiHit),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "MultiHitPowerIncrementAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "NaturePowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::CopyCall(CopyCallVariant::TerrainCall),
            accepted_bases: &[CustomImplBase::OverrideMoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "NoEffectAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Presentation(
                PresentationTiming::OnFailureImmunity,
            )),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "OneHitKOAccuracyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AccuracyQuery),
            accepted_bases: &[CustomImplBase::VariableAccuracy],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::AccuracyQuery],
        },
    ),
    (
        "OneHitKOAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Ohko),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "OpponentHighHpPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PhotonGeyserCategoryAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::CategoryOverride),
            accepted_bases: &[CustomImplBase::VariableMoveCategory],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PlantHealAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(
                HealScope::GroundedConditional,
            )),
            accepted_bases: &[CustomImplBase::WeatherHeal],
            accepted_effects: &[CustomEffectKind::Heal],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PreMoveMessageAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Presentation(
                PresentationTiming::BeforeExecution,
            )),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PreUseInterruptAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::HeaderEffect),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PresentPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PsychoShiftEffectAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::StatusTransfer),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PunishmentPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "PursuitPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RageFistPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RagingBullTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RandomMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::CopyCall(CopyCallVariant::GlobalRandom),
            accepted_bases: &[CustomImplBase::CallMove],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RandomMovesetMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::CopyCall(CopyCallVariant::MovesetRandom),
            accepted_bases: &[CustomImplBase::CallMove],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RecoilAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::RecoilDrain(
                RecoilKind::RecoilFraction,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ReducePpMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PpReduction),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RemoveScreensAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::ArenaTags { removal: true }),
            accepted_bases: &[CustomImplBase::RemoveArenaTags],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RemoveTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::TypeAddRemove,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RepeatMoveAttr",
        AttributeRoute {
            route: CustomDispatchRoute::CopyCall(CopyCallVariant::RepeatLastOwn),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "ResistLastMoveTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::ChartOverride,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RevivalBlessingAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::RevivalBlessing),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "RoundPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SacrificialAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Sacrifice(
                SacrificeKind::FaintAfterUse,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SacrificialAttrOnHit",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Sacrifice(
                SacrificeKind::FaintOnHit,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SacrificialFullRestoreAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Sacrifice(
                SacrificeKind::FullRestoreAfterUse,
            )),
            accepted_bases: &[CustomImplBase::Sacrificial],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SandHealAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(
                HealScope::WeatherConditional,
            )),
            accepted_bases: &[CustomImplBase::WeatherHeal],
            accepted_effects: &[CustomEffectKind::Heal],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SecretPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(
                VolatileTagKind::TerrainConditional,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SheerColdAccuracyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AccuracyQuery),
            accepted_bases: &[CustomImplBase::OneHitKOAccuracy],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::AccuracyQuery],
        },
    ),
    (
        "ShellSideArmCategoryAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::CategoryOverride),
            accepted_bases: &[CustomImplBase::VariableMoveCategory],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SketchAttr",
        AttributeRoute {
            route: CustomDispatchRoute::CopyCall(CopyCallVariant::SketchPermanent),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SpectralThiefAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::StatOverride(
                StatOverrideSurface::BoostSteal,
            )),
            accepted_bases: &[CustomImplBase::StatChangeBeforeDmgCalc],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "SpitUpPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "StormAccuracyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AccuracyQuery),
            accepted_bases: &[CustomImplBase::VariableAccuracy],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::AccuracyQuery],
        },
    ),
    (
        "SwallowHealAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::Heal(HealScope::StockpileRelease)),
            accepted_bases: &[CustomImplBase::Heal],
            accepted_effects: &[CustomEffectKind::Heal],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "TechnoBlastTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "TerrainChangeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TerrainSet { clear_only: false }),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyTerrain],
            accepted_hooks: &[CustomHook::TerrainChanged],
        },
    ),
    (
        "TerrainPulseTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::TerrainChanged],
        },
    ),
    (
        "ThunderAccuracyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AccuracyQuery),
            accepted_bases: &[CustomImplBase::VariableAccuracy],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::AccuracyQuery],
        },
    ),
    (
        "ToxicAccuracyAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::AccuracyQuery),
            accepted_bases: &[CustomImplBase::VariableAccuracy],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::AccuracyQuery],
        },
    ),
    (
        "TypelessAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::Typelessness,
            )),
            accepted_bases: &[CustomImplBase::Move],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "WaterShurikenMultiHitTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::MultiHit),
            accepted_bases: &[CustomImplBase::ChangeMultiHitType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "WaterShurikenPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "WeatherBallTypeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::TypeOverride(
                TypeOverrideLayer::DerivedType,
            )),
            accepted_bases: &[CustomImplBase::VariableMoveType],
            accepted_effects: &[CustomEffectKind::ModifyType],
            accepted_hooks: &[CustomHook::WeatherChanged],
        },
    ),
    (
        "WeatherChangeAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::WeatherSet { clear_only: false }),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::ModifyWeather],
            accepted_hooks: &[CustomHook::WeatherChanged],
        },
    ),
    (
        "WeightPowerAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::PowerQuery),
            accepted_bases: &[CustomImplBase::VariablePower],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
    (
        "WishAttr",
        AttributeRoute {
            route: CustomDispatchRoute::Executable(ExecutableOp::DelayedCommit(
                DelayedCommitKind::DeferredHeal,
            )),
            accepted_bases: &[CustomImplBase::MoveEffect],
            accepted_effects: &[CustomEffectKind::Unresolved],
            accepted_hooks: &[CustomHook::Unresolved],
        },
    ),
];

/// Units per attribute, used by tests to prove exact 394-unit closure.
static ATTRIBUTE_UNIT_WEIGHTS: &[(&str, usize)] = &[
    ("AbilityChangeAttr", 2),
    ("AbilityCopyAttr", 2),
    ("AbilityGiveAttr", 1),
    ("AddArenaTagAttr", 0),
    ("AddBattlerTagHeaderAttr", 0),
    ("AddPledgeEffectAttr", 6),
    ("AddTypeAttr", 2),
    ("AfterYouAttr", 1),
    ("AlwaysHitMinimizeAttr", 9),
    ("AngelsWrathDrainAttr", 1),
    ("AngelsWrathElectrowebAttr", 1),
    ("AngelsWrathGroundSuperEffectiveAttr", 1),
    ("AngelsWrathHazardAttr", 4),
    ("AngelsWrathKingsShieldAttr", 1),
    ("AngelsWrathSteelSuperEffectiveAttr", 1),
    ("AngelsWrathTackleAttr", 1),
    ("AntiSunlightPowerDecreaseAttr", 2),
    ("AttackReducePpMoveAttr", 1),
    ("AuraWheelTypeAttr", 1),
    ("AwaitCombinedPledgeAttr", 3),
    ("BeakBlastHeaderAttr", 1),
    ("BeatUpAttr", 1),
    ("BlizzardAccuracyAttr", 1),
    ("BoostHealAttr", 1),
    ("BypassSleepAttr", 2),
    ("ChangeMultiHitTypeAttr", 0),
    ("ChangeTypeAttr", 2),
    ("ChillyReceptionAttr", 1),
    ("ClearTerrainAttr", 4),
    ("ClearWeatherAttr", 2),
    ("CombinedPledgePowerAttr", 3),
    ("CombinedPledgeTypeAttr", 3),
    ("CompareWeightPowerAttr", 2),
    ("ConfuseAttr", 18),
    ("ConsecutiveUseDoublePowerAttr", 3),
    ("ConsecutiveUseMultiBasePowerAttr", 1),
    ("ConsecutiveUsePowerMultiplierAttr", 0),
    ("CopyBiomeTypeAttr", 1),
    ("CopyMoveAttr", 2),
    ("CopyTypeAttr", 1),
    ("CueNextRoundAttr", 1),
    ("CurseAttr", 1),
    ("DefAtkAttr", 1),
    ("DefDefAttr", 3),
    ("DestinyBondAttr", 1),
    ("DoublePowerChanceAttr", 1),
    ("ElectroBallPowerAttr", 1),
    ("ErFlingPowerAttr", 1),
    ("ErNaturalGiftPowerAttr", 1),
    ("ErNaturalGiftTypeAttr", 1),
    ("ErSkyDropReleaseAttr", 1),
    ("ExposedMoveAttr", 3),
    ("FallDownAttr", 2),
    ("FirstMoveTypeAttr", 1),
    ("FixedDamageAttr", 0),
    ("FlinchAttr", 33),
    ("FlyingTypeMultiplierAttr", 1),
    ("ForceSwitchOutAttr", 0),
    ("FreezeDryAttr", 1),
    ("FrenzyAttr", 4),
    ("FriendshipPowerAttr", 4),
    ("GyroBallPowerAttr", 1),
    ("HalfSacrificialAttr", 2),
    ("HealAttr", 11),
    ("HealOnAllyAttr", 1),
    ("HiddenPowerTypeAttr", 1),
    ("HitHealAttr", 14),
    ("HitsSameTypeAttr", 1),
    ("HpPowerAttr", 3),
    ("HpSplitAttr", 1),
    ("IceNoEffectTypeAttr", 1),
    ("IgnoreWeatherTypeDebuffAttr", 1),
    ("IncrementMovePriorityAttr", 2),
    ("IvyCudgelTypeAttr", 1),
    ("JawLockAttr", 1),
    ("LastMoveDoublePowerAttr", 2),
    ("LeechSeedAttr", 2),
    ("LessPPMorePowerAttr", 1),
    ("LowHpPowerAttr", 2),
    ("MagnitudePowerAttr", 1),
    ("MatchHpAttr", 1),
    ("MatchUserTypeAttr", 1),
    ("MessageAttr", 5),
    ("MessageHeaderAttr", 1),
    ("MissEffectAttr", 8),
    ("MoneyAttr", 3),
    ("MoveHeaderAttr", 0),
    ("MovePowerMultiplierAttr", 34),
    ("MoveTypeChartOverrideAttr", 0),
    ("MovesetCopyMoveAttr", 1),
    ("MultiHitAttr", 33),
    ("MultiHitPowerIncrementAttr", 2),
    ("NaturePowerAttr", 1),
    ("NoEffectAttr", 8),
    ("OneHitKOAccuracyAttr", 3),
    ("OneHitKOAttr", 4),
    ("OpponentHighHpPowerAttr", 3),
    ("PhotonGeyserCategoryAttr", 2),
    ("PlantHealAttr", 3),
    ("PreMoveMessageAttr", 5),
    ("PreUseInterruptAttr", 1),
    ("PresentPowerAttr", 1),
    ("ProtectAttr", 0),
    ("PsychoShiftEffectAttr", 1),
    ("PunishmentPowerAttr", 1),
    ("PursuitPowerAttr", 1),
    ("RageFistPowerAttr", 1),
    ("RagingBullTypeAttr", 1),
    ("RandomMoveAttr", 1),
    ("RandomMovesetMoveAttr", 2),
    ("RecoilAttr", 14),
    ("ReducePpMoveAttr", 1),
    ("RemoveArenaTagsAttr", 0),
    ("RemoveScreensAttr", 4),
    ("RemoveTypeAttr", 2),
    ("RepeatMoveAttr", 1),
    ("ResistLastMoveTypeAttr", 1),
    ("RevivalBlessingAttr", 1),
    ("RoundPowerAttr", 1),
    ("SacrificialAttr", 4),
    ("SacrificialAttrOnHit", 2),
    ("SacrificialFullRestoreAttr", 2),
    ("SandHealAttr", 1),
    ("SecretPowerAttr", 1),
    ("SheerColdAccuracyAttr", 1),
    ("ShellSideArmCategoryAttr", 1),
    ("SketchAttr", 1),
    ("SpectralThiefAttr", 1),
    ("SpitUpPowerAttr", 1),
    ("StatChangeBeforeDmgCalcAttr", 0),
    ("StormAccuracyAttr", 3),
    ("SwallowHealAttr", 1),
    ("TechnoBlastTypeAttr", 1),
    ("TerrainChangeAttr", 5),
    ("TerrainPulseTypeAttr", 1),
    ("ThunderAccuracyAttr", 2),
    ("ToxicAccuracyAttr", 1),
    ("TypelessAttr", 1),
    ("VariableAccuracyAttr", 0),
    ("VariableAtkAttr", 0),
    ("VariableDefAttr", 0),
    ("VariableMoveCategoryAttr", 0),
    ("VariableMoveTypeAttr", 0),
    ("WaterShurikenMultiHitTypeAttr", 1),
    ("WaterShurikenPowerAttr", 1),
    ("WeatherBallTypeAttr", 1),
    ("WeatherChangeAttr", 5),
    ("WeatherHealAttr", 0),
    ("WeightPowerAttr", 2),
    ("WishAttr", 1),
];

/// Classifies one descriptor. Total over the frozen closure: every unit whose
/// attribute exists in the table and whose axes match the frozen catalog gets
/// a typed route; anything else is a fail-closed error, never a fallback.
pub fn classify_custom_move<'a>(
    descriptor: &CustomMoveUnitDescriptor<'a>,
) -> Result<CustomDispatchDecision<'a>, DispatchClassificationError> {
    // ROUTE_TABLE is built sorted; linear scan keeps lifetimes simple and the
    // table small (133 rows).
    let found = ROUTE_TABLE
        .iter()
        .find(|(name, _)| *name == descriptor.attribute);
    let route = match found {
        Some((name, entry)) => {
            let axes_match = entry
                .accepted_bases
                .contains(&descriptor.implementation_base)
                && entry.accepted_effects.contains(&descriptor.effect_kind)
                && entry.accepted_hooks.contains(&descriptor.hook);
            if !axes_match {
                return Err(DispatchClassificationError::CatalogAxisMismatch { attribute: name });
            }
            entry.route
        }
        None => {
            return Err(DispatchClassificationError::UnknownAttribute {
                attribute: descriptor.attribute.to_owned(),
            });
        }
    };
    Ok(CustomDispatchDecision {
        unit: descriptor.unit,
        route,
    })
}

/// Routes a classified decision into the family transitions above.
///
/// `CopyCall` variants map onto the copy/call transitions; executable routes
/// are handed back as typed operations for the standard M6 executor surface.
pub fn route_to_family_transition(
    decision: &CustomDispatchRoute,
    state: &MoveCopyStateV2,
    request: &RecordedLastCopyRequest<'_>,
    candidates: &[MoveId],
    choice: &AuditedChoice,
) -> Result<Option<ResolvedCopyCall>, MoveCopyTransitionError> {
    match decision {
        CustomDispatchRoute::CopyCall(CopyCallVariant::RecordedLast) => {
            resolve_recorded_last_copy(state, request).map(Some)
        }
        CustomDispatchRoute::CopyCall(CopyCallVariant::MimicSlotCopy)
        | CustomDispatchRoute::CopyCall(CopyCallVariant::SketchPermanent) => {
            resolve_recorded_last_copy(state, request).map(Some)
        }
        CustomDispatchRoute::CopyCall(CopyCallVariant::GlobalRandom)
        | CustomDispatchRoute::CopyCall(CopyCallVariant::MovesetRandom)
        | CustomDispatchRoute::CopyCall(CopyCallVariant::TerrainCall)
        | CustomDispatchRoute::CopyCall(CopyCallVariant::RepeatLastOwn) => {
            select_random_call(candidates, choice).map(|plan| {
                Some(ResolvedCopyCall {
                    state_after: state.clone(),
                    outcome: CopyCallOutcome::Cast(plan),
                    evidence: CopyCallEvidence {
                        source_ordinal: None,
                        copied_move: plan.called_move,
                        forbidden_set_checked: false,
                    },
                })
            })
        }
        CustomDispatchRoute::Executable(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::move_copy::ActorMoveHistoryV2;

    fn caller() -> PokemonId {
        PokemonId::new(SafeU53::new(7).expect("in range"))
    }

    fn target() -> PokemonId {
        PokemonId::new(SafeU53::new(9).expect("in range"))
    }

    fn move_id(value: u64) -> MoveId {
        MoveId::new(SafeU53::new(value).unwrap_or(SafeU53::ZERO))
    }

    fn actor(id: u64) -> ActorMoveHistoryV2 {
        ActorMoveHistoryV2 {
            actor: PokemonId::new(SafeU53::new(id).unwrap_or(SafeU53::ZERO)),
            summon_generation: 1,
            entries: Vec::new(),
        }
    }

    fn empty_state() -> MoveCopyStateV2 {
        MoveCopyStateV2 {
            actors: vec![actor(7), actor(9)],
            ..MoveCopyStateV2::default()
        }
    }

    fn record(
        state: &MoveCopyStateV2,
        actor_id: u64,
        move_num: u64,
        mode: MoveUseModeV2,
    ) -> MoveCopyStateV2 {
        record_outcome(state, actor_id, move_num, mode, MoveOutcomeV2::Succeeded)
    }

    fn record_outcome(
        state: &MoveCopyStateV2,
        actor_id: u64,
        move_num: u64,
        mode: MoveUseModeV2,
        outcome: MoveOutcomeV2,
    ) -> MoveCopyStateV2 {
        record_execution(
            state,
            &RecordRequest {
                actor: PokemonId::new(SafeU53::new(actor_id).unwrap_or(SafeU53::ZERO)),
                summon_generation: 1,
                move_id: move_id(move_num),
                use_mode: mode,
                outcome,
            },
        )
        .expect("record succeeds")
        .state
    }

    fn no_sets() -> ContentMoveSets<'static> {
        ContentMoveSets {
            forbidden: &EMPTY_FORBIDDEN,
            charging_moves: &EMPTY_CHARGING,
        }
    }

    static EMPTY_FORBIDDEN: BTreeSet<MoveId> = BTreeSet::new();
    static EMPTY_CHARGING: BTreeSet<MoveId> = BTreeSet::new();

    #[test]
    fn history_is_ordered_bounded_and_evicts_oldest() {
        let state = empty_state();
        let mut next = record(&state, 7, 10, MoveUseModeV2::Normal);
        assert_eq!(next.actors[0].entries.len(), 1);
        for value in 11..=45_u64 {
            next = record(&next, 7, value, MoveUseModeV2::Normal);
        }
        assert_eq!(next.actors[0].entries.len(), 32);
        assert_eq!(next.actors[0].entries[0].move_id, move_id(14));
        let newest = next.actors[0].entries.last().expect("nonempty").clone();
        assert_eq!(newest.move_id, move_id(45));
        assert_eq!(
            newest.execution_ordinal,
            SafeU53::new(36).expect("in range")
        );
        next.validate().expect("bounded state stays valid");
    }

    #[test]
    fn validate_rejects_stale_entries_and_duplicate_ordinals() {
        let mut bad = empty_state();
        bad.actors[0].summon_generation = 2;
        bad.actors[0].entries.push(MoveHistoryEntryV2 {
            move_id: move_id(10),
            use_mode: MoveUseModeV2::Normal,
            outcome: MoveOutcomeV2::Succeeded,
            execution_ordinal: SafeU53::new(1).expect("in range"),
            summon_generation: 1,
        });
        assert_eq!(
            bad.validate(),
            Err(MoveCopyStateError::EntryGenerationMismatch)
        );

        let mut duplicate = empty_state();
        let entry = |ordinal: u64| MoveHistoryEntryV2 {
            move_id: move_id(10),
            use_mode: MoveUseModeV2::Normal,
            outcome: MoveOutcomeV2::Succeeded,
            execution_ordinal: SafeU53::new(ordinal).expect("in range"),
            summon_generation: 1,
        };
        duplicate.actors[0].entries.push(entry(1));
        duplicate.actors[1].entries.push(entry(1));
        assert_eq!(
            duplicate.validate(),
            Err(MoveCopyStateError::DuplicateExecutionOrdinal)
        );
    }

    #[test]
    fn recording_rejects_none_moves_unknown_and_stale_actors() {
        let state = empty_state();
        let none_request = RecordRequest {
            actor: caller(),
            summon_generation: 1,
            move_id: SafeU53::ZERO.into(),
            use_mode: MoveUseModeV2::Normal,
            outcome: MoveOutcomeV2::Succeeded,
        };
        assert!(matches!(
            record_execution(&state, &none_request),
            Err(MoveCopyTransitionError::State(
                MoveCopyStateError::ZeroMoveId
            ))
        ));
        let stale = RecordRequest {
            actor: caller(),
            summon_generation: 5,
            move_id: move_id(10),
            use_mode: MoveUseModeV2::Normal,
            outcome: MoveOutcomeV2::Succeeded,
        };
        assert!(matches!(
            record_execution(&state, &stale),
            Err(MoveCopyTransitionError::State(
                MoveCopyStateError::StaleActorGeneration { .. }
            ))
        ));
        let unknown = RecordRequest {
            actor: PokemonId::new(SafeU53::new(99).unwrap_or(SafeU53::ZERO)),
            summon_generation: 1,
            move_id: move_id(10),
            use_mode: MoveUseModeV2::Normal,
            outcome: MoveOutcomeV2::Succeeded,
        };
        assert!(matches!(
            record_execution(&state, &unknown),
            Err(MoveCopyTransitionError::State(
                MoveCopyStateError::UnknownActor { .. }
            ))
        ));
    }

    #[test]
    fn recording_is_pure_and_evidence_tracks_eviction() {
        let state = empty_state();
        let snapshot = state.clone();
        let first = record_execution(
            &state,
            &RecordRequest {
                actor: caller(),
                summon_generation: 1,
                move_id: move_id(50),
                use_mode: MoveUseModeV2::Indirect,
                outcome: MoveOutcomeV2::Missed,
            },
        )
        .expect("records");
        assert_eq!(state, snapshot, "input state untouched");
        assert_eq!(first.evidence.evicted, None);
        assert_eq!(first.evidence.entry.use_mode, MoveUseModeV2::Indirect);
    }

    #[test]
    fn last_non_virtual_filters_virtual_struggle_and_follow_ups() {
        let mut state = empty_state();
        state = record(&state, 9, 20, MoveUseModeV2::Normal);
        state = record(&state, 9, STRUGGLE_MOVE_ID, MoveUseModeV2::IgnorePp);
        state = record(&state, 9, 30, MoveUseModeV2::Reflected);
        state = record(&state, 9, 40, MoveUseModeV2::FollowUp);

        // Default filter skips all virtual entries → last normal (non-struggle
        // filtering off) is move 20.
        let seen = last_non_virtual(&state, target(), 1, &LastMoveFilter::DEFAULT)
            .expect("query ok")
            .expect("has default-visible entry");
        assert_eq!(seen.move_id, move_id(20));

        // Mirror Move filter admits follow-ups but still skips Reflected.
        let mirrored = last_non_virtual(&state, target(), 1, &LastMoveFilter::MIRROR_MOVE)
            .expect("query ok")
            .expect("mirror sees follow-up");
        assert_eq!(mirrored.move_id, move_id(40));
    }

    #[test]
    fn copycat_casts_battle_last_move_as_free_follow_up() {
        let state = empty_state();
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 1,
            invoking_move: move_id(119), // COPYCAT
            source: RecordedLastSource::BattleLastMove {
                last_move: Some(move_id(33)),
            },
            content: no_sets(),
            retaliate_target: None,
            invoking_slot: None,
            caller_moveset: &[],
        };
        let resolved = resolve_recorded_last_copy(&state, &request).expect("copycat succeeds");
        match resolved.outcome {
            CopyCallOutcome::Cast(plan) => {
                assert_eq!(plan.called_move, move_id(33));
                assert_eq!(plan.use_mode, MoveUseModeV2::FollowUp);
                assert_eq!(plan.pp_decision, PpOwnershipDecision::FollowUpNoCharge);
                assert_eq!(plan.targeting, CallTargeting::NormalTargeting);
            }
            other => panic!("expected cast, got {other:?}"),
        }
        assert_eq!(resolved.evidence.copied_move, move_id(33));
    }

    #[test]
    fn mirror_move_fails_without_history_and_retaliates_with_it() {
        let state = empty_state();
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 1,
            invoking_move: move_id(383), // MIRROR_MOVE
            source: RecordedLastSource::ActorHistory {
                target: target(),
                summon_generation: 1,
                filter: LastMoveFilter::MIRROR_MOVE,
            },
            content: no_sets(),
            retaliate_target: Some(target()),
            invoking_slot: None,
            caller_moveset: &[],
        };
        assert_eq!(
            resolve_recorded_last_copy(&state, &request),
            Err(MoveCopyTransitionError::Failed(
                MoveCopyFailure::NoEligibleLastMove
            ))
        );
        let with_history = record(&state, 9, 55, MoveUseModeV2::FollowUp);
        let resolved =
            resolve_recorded_last_copy(&with_history, &request).expect("mirror move succeeds");
        match resolved.outcome {
            CopyCallOutcome::Cast(plan) => {
                assert_eq!(plan.called_move, move_id(55));
                assert_eq!(
                    plan.targeting,
                    CallTargeting::Retaliate { target: target() }
                );
            }
            other => panic!("expected retaliating cast, got {other:?}"),
        }
    }

    #[test]
    fn mimic_adopts_slot_but_refuses_incomplete_charging_moves() {
        let mut charging = BTreeSet::new();
        charging.insert(move_id(60));
        let sets = ContentMoveSets {
            forbidden: &EMPTY_FORBIDDEN,
            charging_moves: &charging,
        };
        let mut state = empty_state();
        // Incomplete charge: recorded outcome Other.
        state = record_outcome(&state, 9, 60, MoveUseModeV2::Normal, MoveOutcomeV2::Other);
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 1,
            invoking_move: move_id(102), // MIMIC
            source: RecordedLastSource::ActorHistory {
                target: target(),
                summon_generation: 1,
                filter: LastMoveFilter::DEFAULT,
            },
            content: sets,
            retaliate_target: None,
            invoking_slot: Some(2),
            caller_moveset: &[],
        };
        assert_eq!(
            resolve_recorded_last_copy(&state, &request),
            Err(MoveCopyTransitionError::Failed(
                MoveCopyFailure::ChargingMoveIncomplete { move_id: 60 }
            ))
        );
        // Completed charge copies fine and adopts the invoking slot.
        let completed = record_outcome(
            &state,
            9,
            61,
            MoveUseModeV2::Normal,
            MoveOutcomeV2::Succeeded,
        );
        let mimic_ok = RecordedLastCopyRequest {
            source: RecordedLastSource::ActorHistory {
                target: target(),
                summon_generation: 1,
                filter: LastMoveFilter::DEFAULT,
            },
            ..request.clone()
        };
        let resolved = resolve_recorded_last_copy(&completed, &mimic_ok).expect("mimic succeeds");
        match resolved.outcome {
            CopyCallOutcome::ReplaceMoveslot(replacement) => {
                assert_eq!(replacement.slot, 2);
                assert_eq!(replacement.copied_move, move_id(61));
                assert!(!replacement.permanent);
                assert_eq!(
                    replacement.pp_decision,
                    PpOwnershipDecision::SlotReplacementAdopted
                );
            }
            other => panic!("expected slot adoption, got {other:?}"),
        }
    }

    #[test]
    fn sketch_is_permanent_and_refuses_known_moves() {
        let mut state = empty_state();
        state = record(&state, 9, 70, MoveUseModeV2::Normal);
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 1,
            invoking_move: move_id(166), // SKETCH
            source: RecordedLastSource::ActorHistory {
                target: target(),
                summon_generation: 1,
                filter: LastMoveFilter::DEFAULT,
            },
            content: no_sets(),
            retaliate_target: None,
            invoking_slot: Some(0),
            caller_moveset: &[move_id(70)],
        };
        assert_eq!(
            resolve_recorded_last_copy(&state, &request),
            Err(MoveCopyTransitionError::Failed(
                MoveCopyFailure::SketchAlreadyKnown { move_id: 70 }
            ))
        );
        let fresh_moveset = RecordedLastCopyRequest {
            caller_moveset: &[move_id(71)],
            ..request.clone()
        };
        let resolved = resolve_recorded_last_copy(&state, &fresh_moveset).expect("sketch succeeds");
        match resolved.outcome {
            CopyCallOutcome::ReplaceMoveslot(replacement) => {
                assert!(replacement.permanent);
                assert_eq!(replacement.copied_move, move_id(70));
            }
            other => panic!("expected sketch adoption, got {other:?}"),
        }
    }

    #[test]
    fn forbidden_and_dispatch_family_sources_are_refused() {
        let mut forbidden = BTreeSet::new();
        forbidden.insert(move_id(80));
        let sets = ContentMoveSets {
            forbidden: &forbidden,
            charging_moves: &EMPTY_CHARGING,
        };
        let state = empty_state();
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 1,
            invoking_move: move_id(119),
            source: RecordedLastSource::BattleLastMove {
                last_move: Some(move_id(80)),
            },
            content: sets,
            retaliate_target: None,
            invoking_slot: None,
            caller_moveset: &[],
        };
        assert_eq!(
            resolve_recorded_last_copy(&state, &request),
            Err(MoveCopyTransitionError::Failed(
                MoveCopyFailure::ForbiddenByContent { move_id: 80 }
            ))
        );
        let recursive = RecordedLastCopyRequest {
            source: RecordedLastSource::BattleLastMove {
                last_move: Some(move_id(118)), // METRONOME
            },
            ..request.clone()
        };
        assert_eq!(
            resolve_recorded_last_copy(&state, &recursive),
            Err(MoveCopyTransitionError::Failed(
                MoveCopyFailure::DispatchFamilyRecursion { move_id: 118 }
            ))
        );
    }

    #[test]
    fn stale_caller_is_rejected_before_source_consultation() {
        let mut state = empty_state();
        state = record(&state, 7, 90, MoveUseModeV2::Normal);
        // Caller generation bumped as after a switch-in: history is gone.
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 2,
            invoking_move: move_id(119),
            source: RecordedLastSource::BattleLastMove {
                last_move: Some(move_id(91)),
            },
            content: no_sets(),
            retaliate_target: None,
            invoking_slot: None,
            caller_moveset: &[],
        };
        assert!(matches!(
            resolve_recorded_last_copy(&state, &request),
            Err(MoveCopyTransitionError::State(
                MoveCopyStateError::StaleActorGeneration { .. }
            ))
        ));
    }

    #[test]
    fn random_selection_boundaries_are_typed() {
        // Empty candidate set is a typed failure, not a panic.
        assert_eq!(
            select_random_call(&[], &AuditedChoice { index: 0 }),
            Err(MoveCopyTransitionError::Failed(
                MoveCopyFailure::EmptyCandidateSet
            ))
        );
        let candidates = vec![move_id(200), move_id(201)];
        // Out-of-range audited draws are invariant errors.
        assert_eq!(
            select_random_call(&candidates, &AuditedChoice { index: 2 }),
            Err(MoveCopyTransitionError::ChoiceOutOfRange {
                candidate_count: 2,
                index: 2
            })
        );
        // NONE candidates invalidate the closed set.
        let invalid = vec![SafeU53::ZERO.into()];
        assert_eq!(
            select_random_call(&invalid, &AuditedChoice { index: 0 }),
            Err(MoveCopyTransitionError::InvalidCandidateSet)
        );
        // Recursion guard rejects dispatch-family selections.
        assert_eq!(
            select_random_call(&[move_id(214)], &AuditedChoice { index: 0 }),
            Err(MoveCopyTransitionError::Failed(
                MoveCopyFailure::DispatchFamilyRecursion { move_id: 214 }
            ))
        );
    }

    #[test]
    fn same_audited_choice_replays_identically() {
        let candidates = vec![move_id(300), move_id(301), move_id(302)];
        let choice = AuditedChoice { index: 1 };
        let first = select_random_call(&candidates, &choice).expect("selects");
        let second = select_random_call(&candidates, &choice).expect("selects again");
        assert!(verify_deterministic_replay(&first, &second));
        assert_eq!(first.replay_token(), second.replay_token());
        let different = select_random_call(&candidates, &AuditedChoice { index: 2 }).expect("ok");
        assert!(!verify_deterministic_replay(&first, &different));
    }

    #[test]
    fn dispatch_family_identity_matches_frozen_seven() {
        for id in [102_u64, 118, 119, 166, 214, 274, 383] {
            assert!(is_dispatch_family_move(move_id(id)));
        }
        assert!(!is_dispatch_family_move(move_id(1)));
    }

    // -- classifier -------------------------------------------------------

    use CustomEffectKind as Effect;
    use CustomHook as Hook;
    use CustomImplBase as Base;

    fn desc<'a>(
        hash: &'a str,
        ordinal: u16,
        move_num: u64,
        attribute: &'a str,
        base: Base,
        effect: Effect,
        hook: Hook,
    ) -> CustomMoveUnitDescriptor<'a> {
        CustomMoveUnitDescriptor {
            unit: CustomUnitRef {
                provenance_hash: hash,
                ordinal,
                source_move: move_id(move_num),
            },
            attribute,
            implementation_base: base,
            effect_kind: effect,
            hook,
        }
    }

    #[test]
    fn route_table_has_one_hundred_thirty_three_attributes() {
        assert_eq!(ROUTE_TABLE.len(), 133);
        let names: BTreeSet<&str> = ROUTE_TABLE.iter().map(|(name, _)| *name).collect();
        assert_eq!(names.len(), ROUTE_TABLE.len(), "attributes are unique");
        let weights: usize = ATTRIBUTE_UNIT_WEIGHTS
            .iter()
            .map(|(_, weight)| weight)
            .sum();
        assert_eq!(weights, CLOSURE_TOTAL_UNITS);
        assert_eq!(ATTRIBUTE_UNIT_WEIGHTS.len(), ROUTE_TABLE.len());
    }

    #[test]
    fn every_table_row_classifies_from_its_first_accepted_axes() {
        let mut classified_units = 0_usize;
        for (name, entry) in ROUTE_TABLE {
            let base = entry.accepted_bases.first().copied().expect("base listed");
            let effect = entry
                .accepted_effects
                .first()
                .copied()
                .expect("effect listed");
            let hook = entry.accepted_hooks.first().copied().expect("hook listed");
            let descriptor = desc("hash", 0, 1, name, base, effect, hook);
            let decision = classify_custom_move(&descriptor).expect("row classifies");
            classified_units += weight_of(name).expect("weight present");
            assert_eq!(decision.route, entry.route, "route mismatch for {name}");
        }
        assert_eq!(classified_units, CLOSURE_TOTAL_UNITS);
    }

    fn weight_of(name: &str) -> Option<usize> {
        ATTRIBUTE_UNIT_WEIGHTS
            .iter()
            .find(|(candidate, _)| *candidate == name)
            .map(|(_, weight)| *weight)
    }

    #[test]
    fn copy_call_variants_cover_exactly_nine_units() {
        let copy_call_units: usize = ROUTE_TABLE
            .iter()
            .filter(|(_, entry)| matches!(entry.route, CustomDispatchRoute::CopyCall(_)))
            .filter_map(|(name, _)| weight_of(name))
            .sum();
        assert_eq!(copy_call_units, 9);
    }

    #[test]
    fn unknown_attribute_and_axis_drift_fail_closed() {
        let descriptor = desc(
            "hash",
            0,
            1,
            "NotAnAttr",
            Base::Move,
            Effect::Unresolved,
            Hook::Unresolved,
        );
        assert!(matches!(
            classify_custom_move(&descriptor),
            Err(DispatchClassificationError::UnknownAttribute { .. })
        ));

        // FlinchAttr is frozen as AddBattlerTag/flinch semantics; feeding it a
        // VariablePower base is catalog drift and must error.
        let drifted = desc(
            "hash",
            0,
            1,
            "FlinchAttr",
            Base::VariablePower,
            Effect::Unresolved,
            Hook::Unresolved,
        );
        assert!(matches!(
            classify_custom_move(&drifted),
            Err(DispatchClassificationError::CatalogAxisMismatch { .. })
        ));
    }

    #[test]
    fn representative_descriptors_classify_to_expected_routes() {
        let flinch = desc(
            "h1",
            0,
            1,
            "FlinchAttr",
            Base::AddBattlerTag,
            Effect::Unresolved,
            Hook::Unresolved,
        );
        let decision = classify_custom_move(&flinch).expect("flinch");
        assert_eq!(
            decision.route,
            CustomDispatchRoute::Executable(ExecutableOp::VolatileTag(VolatileTagKind::Flinch))
        );

        let metronome = desc(
            "h2",
            0,
            118,
            "RandomMoveAttr",
            Base::CallMove,
            Effect::Unresolved,
            Hook::Unresolved,
        );
        let decision = classify_custom_move(&metronome).expect("metronome");
        assert_eq!(
            decision.route,
            CustomDispatchRoute::CopyCall(CopyCallVariant::GlobalRandom)
        );

        let power = desc(
            "h3",
            0,
            1,
            "MovePowerMultiplierAttr",
            Base::VariablePower,
            Effect::Unresolved,
            Hook::MovePowerQuery,
        );
        let decision = classify_custom_move(&power).expect("power");
        assert_eq!(
            decision.route,
            CustomDispatchRoute::Executable(ExecutableOp::PowerQuery)
        );

        let heal = desc(
            "h4",
            0,
            1,
            "HitHealAttr",
            Base::HitHeal,
            Effect::Heal,
            Hook::Unresolved,
        );
        let decision = classify_custom_move(&heal).expect("heal");
        assert_eq!(
            decision.route,
            CustomDispatchRoute::Executable(ExecutableOp::Heal(HealScope::DrainOnHit))
        );
    }

    #[test]
    fn executable_decisions_do_not_enter_family_transitions() {
        let flinch = desc(
            "h",
            0,
            1,
            "FlinchAttr",
            Base::AddBattlerTag,
            Effect::Unresolved,
            Hook::Unresolved,
        );
        let decision = classify_custom_move(&flinch).expect("classifies");
        let state = empty_state();
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 1,
            invoking_move: move_id(119),
            source: RecordedLastSource::BattleLastMove { last_move: None },
            content: no_sets(),
            retaliate_target: None,
            invoking_slot: None,
            caller_moveset: &[],
        };
        let routed = route_to_family_transition(
            &decision.route,
            &state,
            &request,
            &[],
            &AuditedChoice { index: 0 },
        )
        .expect("routing ok");
        assert_eq!(routed, None, "executable ops stay on the standard surface");
    }

    #[test]
    fn recorded_last_decision_routes_into_family_transition() {
        let copycat = desc(
            "h",
            0,
            119,
            "CopyMoveAttr",
            Base::CallMove,
            Effect::Unresolved,
            Hook::Unresolved,
        );
        let decision = classify_custom_move(&copycat).expect("classifies");
        let mut state = empty_state();
        state = record(&state, 9, 44, MoveUseModeV2::Normal);
        let request = RecordedLastCopyRequest {
            caller: caller(),
            caller_generation: 1,
            invoking_move: move_id(119),
            source: RecordedLastSource::ActorHistory {
                target: target(),
                summon_generation: 1,
                filter: LastMoveFilter::DEFAULT,
            },
            content: no_sets(),
            retaliate_target: None,
            invoking_slot: None,
            caller_moveset: &[],
        };
        let routed = route_to_family_transition(
            &decision.route,
            &state,
            &request,
            &[],
            &AuditedChoice { index: 0 },
        )
        .expect("routing ok")
        .expect("copycat resolves");
        match routed.outcome {
            CopyCallOutcome::Cast(plan) => assert_eq!(plan.called_move, move_id(44)),
            other => panic!("expected cast, got {other:?}"),
        }
    }
}
