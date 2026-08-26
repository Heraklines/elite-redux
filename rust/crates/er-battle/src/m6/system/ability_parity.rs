//! M6D system proof: complete active/passive ability parity.
//!
//! This adapter closes the loop between three production surfaces for every
//! `ACTIVE_ABILITY`/`PASSIVE_ABILITY`-sourced behavior unit in the frozen
//! semantic catalog:
//!
//! 1. **Exact catalog identity closure** ([`resolve_ability_closure`]) — every
//!    catalog ability unit resolves into exactly one execution lane: a mapped
//!    Mechanics IR V2 routine program, an intrinsic content definition, a
//!    closed custom-dispatch lane (`DispatchClass`), or a closed bespoke
//!    family. Any unit left outside these lanes, any duplicate identity, or
//!    any cluster/classification disagreement fails closed; the constructed
//!    evidence therefore carries zero residuals by construction.
//! 2. **Ordered execution semantics** — the frozen V2 total order key drives
//!    active-before-passive slot ordering across the four runtime slots
//!    ([`slot_order_evidence`]); canonical suppression overlays gate the
//!    routine executor while remaining reported, never dropped
//!    ([`suppression_gate_evidence`]); overlapping suppressors stack under
//!    total precedence with unsuppressible rejection
//!    ([`overlap_suppression_evidence`]); native immunity yields to the
//!    claiming slot's own suppression before attacker bypass precedence
//!    ([`immunity_bypass_matrix`]).
//! 3. **Deterministic admission and dispatch parity** — ability execution
//!    admits zero seeded RNG draws and rejects chance conditions fail-closed
//!    ([`rng_admission_evidence`]); false conditions stage no mutations
//!    ([`false_condition_exclusion_evidence`]); the production prepared-content
//!    dispatcher is compared against the direct-reference executor over the
//!    full closed query/trigger surface, ordered evidence included
//!    ([`prepared_dispatch_parity`]); and the whole lane resolution is checked
//!    against the frozen oracle witness plan with exact first-divergence
//!    reporting ([`first_witness_divergence`]).
//!
//! Every function here is pure and deterministic: inputs are borrowed, outputs
//! are freshly constructed evidence, and identical inputs always produce
//! identical results.

use std::collections::BTreeSet;

use er_content::m6_catalog::{CatalogBehaviorUnit, CatalogResolution};
use er_content::pack::m6_prepared::PreparedBattleContentV3;
use er_mechanics::condition_v2::{
    ConditionArenaV2, ConditionNodeId, ConditionNodeV2, ExactRatioV2,
};
use er_mechanics::program_v2::MechanicsProgramV2;
use er_mechanics::v2::{AbilitySourceRank, MechanicHookV2, MechanicQueryV2};
use er_state::bespoke_v2::suppression_immunity::{
    AbilitySlot, DispatchClass, SuppressionImmunityStateV2, SuppressionOrigin,
    classify_behavior_unit,
};
use er_types::battle_ids::{AbilityId, PokemonId};
use er_types::m6::{BespokeMechanicId, RngDomainV1, RngReasonV2};
use er_types::mechanics::MechanicsProgramId;
use er_types::{AbilitySourceKindV1, BehaviorSourceId, BehaviorUnitId, SafeU53};
use thiserror::Error;

use crate::m6::ability_executor::{
    AbilityExecutorError, AbilityOwnerState, conditions_admit, ordered_ability_bindings,
};
use crate::m6::bespoke::suppression_immunity::{
    AbilityBypassInput, AbilitySuppressibility, ImmunityAllowReason, ImmunityClaim,
    ImmunityDecision, ImmunitySubject, SlotSuppressionRequest, SuppressionTransitionError,
    apply_slot_suppression, evaluate_immunity,
};
use crate::m6::routine_executor::{
    MechanicsContextV2, QueryValueV2, execute_hook_v2, execute_hook_v2_direct_reference,
    execute_query_v2, execute_query_v2_direct_reference,
};

/// Schema version of every evidence record produced by this module.
pub const ABILITY_PARITY_SCHEMA_VERSION: u32 = 1;

/// The oracle hook string under which intrinsic definitions load.
pub const CONTENT_LOAD_HOOK: &str = "CONTENT_LOAD";

/// Closed query surface compared between the prepared and reference executors.
const PARITY_QUERIES: [MechanicQueryV2; 17] = [
    MechanicQueryV2::MoveType,
    MechanicQueryV2::MoveCategory,
    MechanicQueryV2::MoveTargetShape,
    MechanicQueryV2::ActionPriority,
    MechanicQueryV2::EffectiveSpeed,
    MechanicQueryV2::Accuracy,
    MechanicQueryV2::CriticalRate,
    MechanicQueryV2::MovePower,
    MechanicQueryV2::OffensiveStat,
    MechanicQueryV2::DefensiveStat,
    MechanicQueryV2::TypeEffectiveness,
    MechanicQueryV2::Damage,
    MechanicQueryV2::HitCount,
    MechanicQueryV2::StatusEligibility,
    MechanicQueryV2::VolatileEligibility,
    MechanicQueryV2::SwitchEligibility,
    MechanicQueryV2::ItemEligibility,
];

/// Closed trigger surface compared between the prepared and reference
/// executors. Query-stage hooks are exercised through [`PARITY_QUERIES`].
const PARITY_HOOKS: [MechanicHookV2; 24] = [
    MechanicHookV2::BattleLoad,
    MechanicHookV2::BattleStart,
    MechanicHookV2::BeforeSummon,
    MechanicHookV2::AfterSummon,
    MechanicHookV2::BeforeActionOrder,
    MechanicHookV2::BeforeAction,
    MechanicHookV2::BeforeMove,
    MechanicHookV2::BeforeHit,
    MechanicHookV2::AfterHit,
    MechanicHookV2::AfterMove,
    MechanicHookV2::AfterDamage,
    MechanicHookV2::BeforeStatus,
    MechanicHookV2::AfterStatus,
    MechanicHookV2::BeforeSwitchOut,
    MechanicHookV2::AfterSwitchOut,
    MechanicHookV2::BeforeSwitchIn,
    MechanicHookV2::WeatherChanged,
    MechanicHookV2::WeatherLapse,
    MechanicHookV2::TerrainChanged,
    MechanicHookV2::TurnEnd,
    MechanicHookV2::ScheduledEvent,
    MechanicHookV2::BeforeFaint,
    MechanicHookV2::AfterFaint,
    MechanicHookV2::Victory,
];

/// Typed failures of the ability parity adapters. Every unsupported identity
/// or contract disagreement fails closed with a precise cause.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AbilityParityError {
    #[error("duplicate behavior unit identity {0:?}")]
    DuplicateUnit(BehaviorUnitId),
    #[error("resolved-operand unit {0:?} has no owning routine program")]
    RoutineProgramMissing(BehaviorUnitId),
    #[error("resolved-operand unit {0:?} is claimed by multiple routine programs")]
    AmbiguousRoutineProgram(BehaviorUnitId),
    #[error("intrinsic unit {0:?} is unexpectedly owned by a routine program")]
    UnexpectedRoutineOwnership(BehaviorUnitId),
    #[error("bespoke-gap unit with provenance {0} is assigned to no closed cluster")]
    UnclassifiedBespokeGap(String),
    #[error("bespoke-gap unit {0:?} is assigned to multiple clusters")]
    MultiClusterAssignment(BehaviorUnitId),
    #[error("custom-dispatch classification rejected provenance {0}")]
    DispatchClassification(String),
    #[error("owner index {index} has no parallel pokemon identity")]
    OwnerPokemonMissing { index: usize },
    #[error("runtime-extra slot {0:?} has no canonical suppression slot")]
    RuntimeExtraUnsupported(AbilitySourceKindV1),
    #[error(
        "owner {index} suppression flag {actual} contradicts the canonical state (expected {expected})"
    )]
    SuppressionFlagMismatch {
        index: usize,
        expected: bool,
        actual: bool,
    },
    #[error("slot order violated: source rank {later} follows {earlier}")]
    SlotOrderViolation { earlier: u32, later: u32 },
    #[error("rng site owner {0} is ability-sourced; abilities admit no seeded draws")]
    AbilityOwnedRngSite(String),
    #[error("routine program {0:?} declares seeded rng draws")]
    ProgramRngDraws(MechanicsProgramId),
    #[error("chance condition was admitted by the ability executor")]
    ChanceConditionAdmitted,
    #[error("unconditional condition was rejected by the ability executor")]
    UnconditionalConditionRejected,
    #[error("claim with provenance {0} does not classify into the immunity-gate lane")]
    NotAnImmunityClaim(String),
    #[error("immunity matrix row {row}: expected {expected:?}, observed {observed:?}")]
    ImmunityMatrixMismatch {
        row: usize,
        expected: ImmunityDecision,
        observed: ImmunityDecision,
    },
    #[error("conditioned program set still stages bindings under a false condition")]
    FalseConditionLeak,
    #[error("baseline program set stages nothing; exclusion evidence is meaningless")]
    EmptyBaseline,
    #[error("suppression transition failed: {0}")]
    SuppressionTransition(String),
    #[error("ability executor rejected evaluation: {0}")]
    Executor(String),
    #[error("prepared dispatch diverged at context {context_index} on {surface}")]
    PreparedDivergence {
        context_index: usize,
        surface: String,
    },
}

/// Which mirrored ability slot family a source identity belongs to.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbilityPolarity {
    Active,
    Passive,
}

/// Resolves the ability-slot family of a behavior source, or `None` when the
/// source belongs to another closed surface.
pub const fn ability_polarity(source: &BehaviorSourceId) -> Option<AbilityPolarity> {
    match source {
        BehaviorSourceId::ActiveAbility { .. } => Some(AbilityPolarity::Active),
        BehaviorSourceId::PassiveAbility { .. } => Some(AbilityPolarity::Passive),
        _ => None,
    }
}

/// Maps a runtime ability slot onto the canonical four-slot addressing used by
/// suppression overlays and the custom dispatcher. Runtime extras have no
/// canonical slot and fail closed at their use sites.
pub const fn canonical_slot(slot: AbilitySourceKindV1) -> Option<AbilitySlot> {
    match slot {
        AbilitySourceKindV1::Active => Some(AbilitySlot::Active),
        AbilitySourceKindV1::PassiveSlot0 => Some(AbilitySlot::Passive0),
        AbilitySourceKindV1::PassiveSlot1 => Some(AbilitySlot::Passive1),
        AbilitySourceKindV1::PassiveSlot2 => Some(AbilitySlot::Passive2),
        AbilitySourceKindV1::RuntimeExtra => None,
    }
}

/// One closed bespoke cluster assignment supplied by the caller.
#[derive(Clone, Copy, Debug)]
pub struct BespokeClusterInput<'a> {
    pub mechanic: BespokeMechanicId,
    pub behavior_units: &'a [BehaviorUnitId],
}

/// The single execution lane a catalog ability unit resolves into.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbilityExecutionLane {
    /// Executes through the compiled Mechanics IR V2 routine path.
    RoutineProgram { program_id: MechanicsProgramId },
    /// An intrinsic content definition; loaded once at content load and never
    /// dispatched at battle time.
    IntrinsicDefinition,
    /// Routed through the closed custom-ability dispatcher lane.
    CustomDispatch(DispatchClass),
    /// Owned by a closed bespoke family outside the custom dispatcher.
    FamilyBespoke(BespokeMechanicId),
}

/// Complete, residual-free lane resolution over the ability closure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AbilityClosureEvidence {
    pub schema_version: u32,
    pub active_units: usize,
    pub passive_units: usize,
    pub routine_program_units: usize,
    pub intrinsic_units: usize,
    pub custom_dispatch_units: usize,
    pub family_bespoke_units: usize,
    lanes: Vec<(BehaviorUnitId, AbilityExecutionLane)>,
}

impl AbilityClosureEvidence {
    /// Total ability units covered by the closure.
    pub fn total_units(&self) -> usize {
        self.active_units + self.passive_units
    }

    /// Resolved lanes, sorted ascending by behavior-unit identity. Every
    /// entry is unique; the sum of lane populations equals [`Self::total_units`].
    pub fn lanes(&self) -> &[(BehaviorUnitId, AbilityExecutionLane)] {
        &self.lanes
    }

    /// The resolved lane of one unit, if it belongs to the closure.
    pub fn lane_of(&self, unit: &BehaviorUnitId) -> Option<AbilityExecutionLane> {
        self.lanes
            .binary_search_by(|probe| probe.0.cmp(unit))
            .ok()
            .map(|index| self.lanes[index].1)
    }
}

/// Resolves every `ACTIVE_ABILITY`/`PASSIVE_ABILITY` catalog unit into exactly
/// one execution lane.
///
/// Fails closed on: duplicate identities, resolved-operand units without
/// exactly one owning routine program, intrinsic units claimed by a routine
/// program, bespoke-gap units missing from (or spanning multiple) closed
/// clusters, and custom-dispatch units whose provenance the frozen
/// classification table rejects. On success the evidence is complete: zero
/// units remain unclassified.
pub fn resolve_ability_closure(
    catalog_units: &[CatalogBehaviorUnit],
    programs: &[MechanicsProgramV2],
    clusters: &[BespokeClusterInput<'_>],
) -> Result<AbilityClosureEvidence, AbilityParityError> {
    let mut seen: BTreeSet<&BehaviorUnitId> = BTreeSet::new();
    let mut lanes: Vec<(BehaviorUnitId, AbilityExecutionLane)> = Vec::new();
    let mut active_units = 0usize;
    let mut passive_units = 0usize;
    let mut routine_program_units = 0usize;
    let mut intrinsic_units = 0usize;
    let mut custom_dispatch_units = 0usize;
    let mut family_bespoke_units = 0usize;

    for unit in catalog_units {
        let Some(_polarity) = ability_polarity(&unit.id.source) else {
            continue;
        };
        if !seen.insert(&unit.id) {
            return Err(AbilityParityError::DuplicateUnit(unit.id.clone()));
        }
        let lane = match unit.semantic.resolution {
            CatalogResolution::ResolvedOperands => {
                let owners: Vec<&MechanicsProgramV2> = programs
                    .iter()
                    .filter(|program| program.behavior_units.iter().any(|owned| owned == &unit.id))
                    .collect();
                if owners.is_empty() {
                    return Err(AbilityParityError::RoutineProgramMissing(unit.id.clone()));
                }
                if owners.len() > 1 {
                    return Err(AbilityParityError::AmbiguousRoutineProgram(unit.id.clone()));
                }
                AbilityExecutionLane::RoutineProgram {
                    program_id: owners[0].id,
                }
            }
            CatalogResolution::ResolvedIntrinsic => {
                if programs
                    .iter()
                    .any(|program| program.behavior_units.iter().any(|owned| owned == &unit.id))
                {
                    return Err(AbilityParityError::UnexpectedRoutineOwnership(
                        unit.id.clone(),
                    ));
                }
                AbilityExecutionLane::IntrinsicDefinition
            }
            CatalogResolution::BespokeGap => {
                let assigned: Vec<BespokeMechanicId> = clusters
                    .iter()
                    .filter(|cluster| cluster.behavior_units.contains(&unit.id))
                    .map(|cluster| cluster.mechanic)
                    .collect();
                if assigned.is_empty() {
                    return Err(AbilityParityError::UnclassifiedBespokeGap(
                        unit.id.provenance_hash.as_str().to_owned(),
                    ));
                }
                if assigned.len() > 1 {
                    return Err(AbilityParityError::MultiClusterAssignment(unit.id.clone()));
                }
                if assigned[0] == BespokeMechanicId::CustomDispatch {
                    let class =
                        classify_behavior_unit(unit.id.provenance_hash.as_str()).map_err(|_| {
                            AbilityParityError::DispatchClassification(
                                unit.id.provenance_hash.as_str().to_owned(),
                            )
                        })?;
                    AbilityExecutionLane::CustomDispatch(class)
                } else {
                    AbilityExecutionLane::FamilyBespoke(assigned[0])
                }
            }
        };
        match _polarity {
            AbilityPolarity::Active => active_units += 1,
            AbilityPolarity::Passive => passive_units += 1,
        }
        match lane {
            AbilityExecutionLane::RoutineProgram { .. } => routine_program_units += 1,
            AbilityExecutionLane::IntrinsicDefinition => intrinsic_units += 1,
            AbilityExecutionLane::CustomDispatch(_) => custom_dispatch_units += 1,
            AbilityExecutionLane::FamilyBespoke(_) => family_bespoke_units += 1,
        }
        lanes.push((unit.id.clone(), lane));
    }

    lanes.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(AbilityClosureEvidence {
        schema_version: ABILITY_PARITY_SCHEMA_VERSION,
        active_units,
        passive_units,
        routine_program_units,
        intrinsic_units,
        custom_dispatch_units,
        family_bespoke_units,
        lanes,
    })
}

/// One executed binding visit in frozen order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SlotExecutionStep {
    pub owner_index: usize,
    pub slot: AbilitySourceKindV1,
    pub side_rank: u8,
    pub field_position: u8,
    pub program_id: MechanicsProgramId,
    pub behavior_unit_ordinal: u32,
    pub source_rank: u32,
}

/// Executes one hook invocation over the supplied owners and returns the
/// visited bindings in frozen execution order, verifying the active-before-
/// passive slot-rank monotonicity explicitly against
/// [`AbilitySourceRank`].
pub fn slot_order_evidence(
    programs: &[MechanicsProgramV2],
    owners: &[AbilityOwnerState],
    hook: MechanicHookV2,
) -> Result<Vec<SlotExecutionStep>, AbilityParityError> {
    let bindings = ordered_ability_bindings(programs, owners, hook)
        .map_err(|error| AbilityParityError::Executor(error.to_string()))?;
    let mut steps = Vec::with_capacity(bindings.len());
    let mut previous_rank: Option<u32> = None;
    for binding in &bindings {
        let owner = &owners[binding.owner_index];
        let source_rank = AbilitySourceRank::from(owner.slot) as u32;
        if let Some(earlier) = previous_rank
            && source_rank < earlier
        {
            return Err(AbilityParityError::SlotOrderViolation {
                earlier,
                later: source_rank,
            });
        }
        previous_rank = Some(source_rank);
        steps.push(SlotExecutionStep {
            owner_index: binding.owner_index,
            slot: owner.slot,
            side_rank: owner.side_rank,
            field_position: owner.field_position,
            program_id: binding.program.id,
            behavior_unit_ordinal: binding.binding.behavior_unit.ordinal.get(),
            source_rank,
        });
    }
    Ok(steps)
}

/// Cross-path gating evidence: what the routine executor runs, what it must
/// exclude, and what the canonical suppression state says governs each owner.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuppressionGateEvidence {
    /// Bindings that execute, in frozen order.
    pub executed: Vec<SlotExecutionStep>,
    /// Owner indices excluded from execution because their flag marks them
    /// suppressed.
    pub excluded_owner_indices: Vec<usize>,
    /// Governing suppression origin per owner index (`None` = acting freely).
    pub governing_origins: Vec<Option<SuppressionOrigin>>,
}

/// Proves suppression gating end to end for one hook invocation.
///
/// Every owner's executor-facing `suppressed` flag is cross-checked against
/// the canonical overlay state composed with the closed unsuppressible-slot
/// exceptions: a slot acts suppressed only when a live overlay governs it and
/// its ability does not carry the unsuppressible kind. Excluded owners stay
/// reported with their governing origin instead of silently vanishing.
pub fn suppression_gate_evidence(
    programs: &[MechanicsProgramV2],
    owners: &[AbilityOwnerState],
    suppression: &SuppressionImmunityStateV2,
    owner_pokemon: &[PokemonId],
    unsuppressible_slots: &[(PokemonId, AbilitySlot)],
    hook: MechanicHookV2,
) -> Result<SuppressionGateEvidence, AbilityParityError> {
    if owner_pokemon.len() != owners.len() {
        return Err(AbilityParityError::OwnerPokemonMissing {
            index: owners.len(),
        });
    }
    let mut excluded_owner_indices = Vec::new();
    let mut governing_origins = Vec::with_capacity(owners.len());
    for (index, owner) in owners.iter().enumerate() {
        let slot = canonical_slot(owner.slot)
            .ok_or(AbilityParityError::RuntimeExtraUnsupported(owner.slot))?;
        let pokemon = owner_pokemon[index];
        let live = suppression.slot_is_suppressed(pokemon, slot);
        let unsuppressible = unsuppressible_slots.contains(&(pokemon, slot));
        let expected_flag = live && !unsuppressible;
        if owner.suppressed != expected_flag {
            return Err(AbilityParityError::SuppressionFlagMismatch {
                index,
                expected: expected_flag,
                actual: owner.suppressed,
            });
        }
        if owner.suppressed {
            excluded_owner_indices.push(index);
        }
        governing_origins.push(suppression.governing_origin(pokemon, slot).cloned());
    }
    let executed = slot_order_evidence(programs, owners, hook)?;
    Ok(SuppressionGateEvidence {
        executed,
        excluded_owner_indices,
        governing_origins,
    })
}

/// Outcome of one overlapping-suppression request applied in order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OverlapSuppressionOutcome {
    Applied {
        /// Highest-precedence origin governing the slot after the transition.
        governing_origin_after: SuppressionOrigin,
        /// Number of stacked overlays on any slot afterwards.
        stacked_entries_after: usize,
    },
    RejectedUnsuppressible {
        owner: PokemonId,
        slot: AbilitySlot,
        ability: AbilityId,
    },
}

/// Applies overlapping suppression requests sequentially onto a fresh
/// canonical state, recording stacking, precedence, refresh, and
/// unsuppressible rejection outcomes. State errors fail closed.
pub fn overlap_suppression_evidence(
    requests: &[SlotSuppressionRequest],
) -> Result<Vec<OverlapSuppressionOutcome>, AbilityParityError> {
    let mut state = SuppressionImmunityStateV2::new();
    let mut outcomes = Vec::with_capacity(requests.len());
    for request in requests {
        match apply_slot_suppression(&state, request) {
            Ok(transition) => {
                state = transition.state;
                outcomes.push(OverlapSuppressionOutcome::Applied {
                    governing_origin_after: transition.evidence.governing_origin_after.clone(),
                    stacked_entries_after: state.slot_suppressions.len(),
                });
            }
            Err(SuppressionTransitionError::UnsuppressibleAbility {
                owner,
                slot,
                ability,
            }) => {
                outcomes.push(OverlapSuppressionOutcome::RejectedUnsuppressible {
                    owner,
                    slot,
                    ability,
                });
            }
            Err(error) => {
                return Err(AbilityParityError::SuppressionTransition(error.to_string()));
            }
        }
    }
    Ok(outcomes)
}

/// One evaluated cell of the immunity/bypass precedence matrix.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ImmunityMatrixRow {
    pub claiming_slot_suppressed: bool,
    pub bypass: AbilityBypassInput,
    pub decision: ImmunityDecision,
}

/// Evaluates the closed four-cell immunity precedence matrix for one
/// immunity-gate claim.
///
/// Fixed precedence: the defender's own suppressed slot inertness outranks
/// attacker bypass, which outranks native denial. The claim must classify
/// into the [`DispatchClass::ImmunityGate`] lane or the call fails closed.
pub fn immunity_bypass_matrix(
    claim: &ImmunityClaim<'_>,
    subject: ImmunitySubject,
    claim_ability: AbilityId,
) -> Result<[ImmunityMatrixRow; 4], AbilityParityError> {
    let class = classify_behavior_unit(claim.provenance_hash)
        .map_err(|_| AbilityParityError::NotAnImmunityClaim(claim.provenance_hash.to_owned()))?;
    if class != DispatchClass::ImmunityGate {
        return Err(AbilityParityError::NotAnImmunityClaim(
            claim.provenance_hash.to_owned(),
        ));
    }
    let clean = SuppressionImmunityStateV2::new();
    let request = SlotSuppressionRequest {
        owner: claim.owner,
        slot: claim.slot,
        origin: SuppressionOrigin::GlobalIgnore,
        remaining_turns: None,
        suppressibility: AbilitySuppressibility::Suppressible,
        current_ability: claim_ability,
    };
    let suppressed_state = apply_slot_suppression(&clean, &request)
        .map_err(|error| AbilityParityError::SuppressionTransition(error.to_string()))?
        .state;
    let combinations = [
        (false, AbilityBypassInput::None, ImmunityDecision::Denied),
        (
            false,
            AbilityBypassInput::IgnoreAbilities,
            ImmunityDecision::Allowed {
                reason: ImmunityAllowReason::BypassPrecedence,
            },
        ),
        (
            true,
            AbilityBypassInput::None,
            ImmunityDecision::Allowed {
                reason: ImmunityAllowReason::ClaimingSlotSuppressed,
            },
        ),
        (
            true,
            AbilityBypassInput::IgnoreAbilities,
            ImmunityDecision::Allowed {
                reason: ImmunityAllowReason::ClaimingSlotSuppressed,
            },
        ),
    ];
    let mut rows = [ImmunityMatrixRow {
        claiming_slot_suppressed: false,
        bypass: AbilityBypassInput::None,
        decision: ImmunityDecision::Denied,
    }; 4];
    for (row, (suppressed_flag, bypass, expected)) in combinations.iter().enumerate() {
        let state = if *suppressed_flag {
            &suppressed_state
        } else {
            &clean
        };
        let observed = evaluate_immunity(state, claim, subject, *bypass)
            .map_err(|error| AbilityParityError::SuppressionTransition(error.to_string()))?;
        if observed != *expected {
            return Err(AbilityParityError::ImmunityMatrixMismatch {
                row,
                expected: *expected,
                observed,
            });
        }
        rows[row] = ImmunityMatrixRow {
            claiming_slot_suppressed: *suppressed_flag,
            bypass: *bypass,
            decision: observed,
        };
    }
    Ok(rows)
}

/// Evidence that false conditions exclude bindings without staging mutations.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FalseConditionEvidence {
    pub baseline_admitted_steps: usize,
    pub conditioned_admitted_steps: usize,
}

/// Compares one hook invocation over the baseline program set against a
/// conditioned twin whose bindings are re-rooted onto admitting-false
/// condition nodes. The conditioned set must stage nothing while the baseline
/// admits work; anything else fails closed. Both executors are pure, so the
/// comparison itself never mutates either program set.
pub fn false_condition_exclusion_evidence(
    baseline_programs: &[MechanicsProgramV2],
    conditioned_programs: &[MechanicsProgramV2],
    owners: &[AbilityOwnerState],
    hook: MechanicHookV2,
) -> Result<FalseConditionEvidence, AbilityParityError> {
    let baseline = slot_order_evidence(baseline_programs, owners, hook)?;
    let conditioned = slot_order_evidence(conditioned_programs, owners, hook)?;
    if baseline.is_empty() {
        return Err(AbilityParityError::EmptyBaseline);
    }
    if !conditioned.is_empty() {
        return Err(AbilityParityError::FalseConditionLeak);
    }
    Ok(FalseConditionEvidence {
        baseline_admitted_steps: baseline.len(),
        conditioned_admitted_steps: conditioned.len(),
    })
}

/// Evidence that ability execution admits zero seeded RNG draws.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RngAdmissionEvidence {
    pub audited_site_owners: usize,
    pub audited_routine_programs: usize,
    pub ability_owned_sites: usize,
    pub routine_rng_bindings: usize,
    pub chance_probes_rejected: usize,
    pub unconditional_probe_admitted: bool,
}

/// Audits RNG admission for the ability surface:
///
/// - no catalog RNG site may be owned by an ability-sourced unit;
/// - no ability-sourced routine program may declare seeded draw bindings;
/// - the generic chance condition must be rejected fail-closed by the ability
///   condition evaluator (so mapped ability routines can never draw), while
///   unconditional conditions still admit.
pub fn rng_admission_evidence(
    site_owners: &[BehaviorUnitId],
    programs: &[MechanicsProgramV2],
) -> Result<RngAdmissionEvidence, AbilityParityError> {
    for owner in site_owners {
        if ability_polarity(&owner.source).is_some() {
            return Err(AbilityParityError::AbilityOwnedRngSite(
                owner.provenance_hash.as_str().to_owned(),
            ));
        }
    }
    let ability_owned_sites = 0usize;
    let mut routine_rng_bindings = 0usize;
    let mut audited_routine_programs = 0usize;
    for program in programs {
        if ability_polarity(&program.source).is_some() {
            audited_routine_programs += 1;
            if !program.rng_sites.is_empty() {
                return Err(AbilityParityError::ProgramRngDraws(program.id));
            }
            routine_rng_bindings += program.rng_sites.len();
        }
    }

    let owner = probe_owner();
    let chance_arena = ConditionArenaV2(vec![ConditionNodeV2::Chance {
        site_ordinal: 0,
        reason: RngReasonV2::AbilityChance,
        domain: RngDomainV1::BattleMechanical,
        numerator: 1,
        denominator: 2,
    }]);
    let chance_rejected = matches!(
        conditions_admit(&chance_arena, Some(ConditionNodeId(0)), &owner),
        Err(AbilityExecutorError::UnsupportedCondition)
    );
    if !chance_rejected {
        return Err(AbilityParityError::ChanceConditionAdmitted);
    }
    let always_arena = ConditionArenaV2(vec![ConditionNodeV2::Always]);
    let unconditional_admitted = conditions_admit(&always_arena, Some(ConditionNodeId(0)), &owner)
        .map_err(|error| AbilityParityError::Executor(error.to_string()))?;
    if !unconditional_admitted {
        return Err(AbilityParityError::UnconditionalConditionRejected);
    }

    Ok(RngAdmissionEvidence {
        audited_site_owners: site_owners.len(),
        audited_routine_programs,
        ability_owned_sites,
        routine_rng_bindings,
        chance_probes_rejected: 1,
        unconditional_probe_admitted: unconditional_admitted,
    })
}

/// Counts from one full prepared-vs-direct dispatch comparison sweep.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PreparedDispatchReport {
    pub contexts: usize,
    pub compared_queries: usize,
    pub compared_hooks: usize,
    pub staged_operations: usize,
}

/// Runs the complete closed query/trigger surface through both production
/// executors — the prepared-content indexed dispatcher and the temporary
/// direct-reference scanner — for every supplied runtime context, comparing
/// the entire ordered transition evidence (every operation, its binding
/// ordinals, condition match, and before/after values), never just a digest.
pub fn prepared_dispatch_parity(
    programs: &[MechanicsProgramV2],
    prepared: &PreparedBattleContentV3,
    contexts: &[MechanicsContextV2<'_>],
) -> Result<PreparedDispatchReport, AbilityParityError> {
    let mut report = PreparedDispatchReport {
        contexts: contexts.len(),
        compared_queries: 0,
        compared_hooks: 0,
        staged_operations: 0,
    };
    for (context_index, context) in contexts.iter().enumerate() {
        for query in PARITY_QUERIES {
            let initial = query_initial(query);
            let direct = execute_query_v2_direct_reference(programs, context, query, initial)
                .map_err(|error| AbilityParityError::Executor(error.to_string()))?;
            let indexed_initial = query_initial(query);
            let indexed = execute_query_v2(prepared, context, query, indexed_initial)
                .map_err(|error| AbilityParityError::Executor(error.to_string()))?;
            if direct != indexed {
                return Err(AbilityParityError::PreparedDivergence {
                    context_index,
                    surface: format!("query::{query:?}"),
                });
            }
            report.compared_queries += 1;
            report.staged_operations += direct.evidence.len();
        }
        for hook in PARITY_HOOKS {
            let direct = execute_hook_v2_direct_reference(programs, context, hook)
                .map_err(|error| AbilityParityError::Executor(error.to_string()))?;
            let indexed = execute_hook_v2(prepared, context, hook)
                .map_err(|error| AbilityParityError::Executor(error.to_string()))?;
            if direct != indexed {
                return Err(AbilityParityError::PreparedDivergence {
                    context_index,
                    surface: format!("hook::{hook:?}"),
                });
            }
            report.compared_hooks += 1;
            report.staged_operations += direct.operations.len();
        }
    }
    Ok(report)
}

/// One oracle witness expectation over the ability closure.
#[derive(Clone, Copy, Debug)]
pub struct OracleWitnessInput<'a> {
    pub unit: &'a BehaviorUnitId,
    pub expected_source: &'a BehaviorSourceId,
    pub expected_hook: &'a str,
    /// The witness asserts `SOURCE_REACHED`: the unit must resolve into a
    /// participating lane.
    pub asserts_source_reached: bool,
}

/// First divergence between the oracle witness plan and the resolved closure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WitnessDivergence {
    SourceNotReached {
        index: usize,
        unit: BehaviorUnitId,
    },
    SourceIdentityMismatch {
        index: usize,
        expected: BehaviorSourceId,
        actual: BehaviorSourceId,
    },
    HookLaneInconsistent {
        index: usize,
        hook: String,
        lane: AbilityExecutionLane,
    },
}

/// Walks the witness stream in oracle order and reports the first divergence
/// with exact identity and cause, or `None` when every witness agrees:
/// identity membership in the closure, mirrored source identity, and
/// hook/lane consistency (intrinsic definitions load exactly at
/// `CONTENT_LOAD`; every battle-time hook must belong to a dispatched lane).
pub fn first_witness_divergence(
    witnesses: &[OracleWitnessInput<'_>],
    closure: &AbilityClosureEvidence,
) -> Option<WitnessDivergence> {
    for (index, witness) in witnesses.iter().enumerate() {
        let lane = closure.lane_of(witness.unit);
        if witness.asserts_source_reached && lane.is_none() {
            return Some(WitnessDivergence::SourceNotReached {
                index,
                unit: witness.unit.clone(),
            });
        }
        let Some(lane) = lane else {
            continue;
        };
        if witness.unit.source != *witness.expected_source {
            return Some(WitnessDivergence::SourceIdentityMismatch {
                index,
                expected: witness.expected_source.clone(),
                actual: witness.unit.source.clone(),
            });
        }
        let intrinsic = lane == AbilityExecutionLane::IntrinsicDefinition;
        let content_load = witness.expected_hook == CONTENT_LOAD_HOOK;
        if intrinsic != content_load {
            return Some(WitnessDivergence::HookLaneInconsistent {
                index,
                hook: witness.expected_hook.to_owned(),
                lane,
            });
        }
    }
    None
}

fn probe_owner() -> AbilityOwnerState {
    // Probe identities are synthetic but well-formed: a valid active-source
    // owner exercising only the condition-evaluation surface.
    let numeric_id = SafeU53::new(1).unwrap_or(SafeU53::ZERO);
    AbilityOwnerState {
        source: BehaviorSourceId::ActiveAbility { numeric_id },
        slot: AbilitySourceKindV1::Active,
        suppressed: false,
        side_rank: 0,
        field_position: 0,
    }
}

fn query_initial(query: MechanicQueryV2) -> QueryValueV2 {
    match query {
        MechanicQueryV2::MoveType => QueryValueV2::TypeId(1),
        MechanicQueryV2::MoveCategory => QueryValueV2::CategoryId(1),
        MechanicQueryV2::MoveTargetShape => QueryValueV2::TargetId(1),
        MechanicQueryV2::TypeEffectiveness => QueryValueV2::Ratio(ExactRatioV2 {
            numerator: 1,
            denominator: 1,
        }),
        MechanicQueryV2::StatusEligibility
        | MechanicQueryV2::VolatileEligibility
        | MechanicQueryV2::SwitchEligibility
        | MechanicQueryV2::ItemEligibility => QueryValueV2::Boolean(true),
        MechanicQueryV2::ActionPriority
        | MechanicQueryV2::EffectiveSpeed
        | MechanicQueryV2::Accuracy
        | MechanicQueryV2::CriticalRate
        | MechanicQueryV2::MovePower
        | MechanicQueryV2::OffensiveStat
        | MechanicQueryV2::DefensiveStat
        | MechanicQueryV2::Damage
        | MechanicQueryV2::HitCount => QueryValueV2::Signed(7),
    }
}
