//! The production local-battle lifecycle adapter.
//!
//! Local play is an authority transaction with an internal command source. It
//! does not have a second battle engine, a compatibility-resolution path, or a
//! semantic campaign surface. The kernel owns the outer clone-and-swap and
//! FIFO; this module translates the private local request into the typed
//! runtime/material stages already used by authority play.
//!
//! [`LocalBattleRuntimeAdapter`] is deliberately crate-private. It wraps the
//! integration-owned [`GameRuntime`] and delegates every authoritative step to
//! the canonical runtime reducer, typed material codec, and common material
//! applier. Callers cannot supply an alternate resolver, material format, or
//! battle-start configuration.

use er_battle::resolver::{BattleNextDecision, compute_presentation_plan_digest};
use er_battle::{BattleReplacementTransition, BattleTransition};
use er_state::digest::{
    MechanicalDigestError, MechanicalStateDigest, compute_mechanical_state_digest,
};
use er_state::snapshot::GameState;
use er_state::validation::StateValidationError;
use er_types::OperationId;
use er_types::battle_command::{
    BattleCommandProposalV1, BattleReplacementProposalV1, ReplacementSelection,
};
use er_types::battle_control::{
    BattleControlPlan, BattleControlPlanError, SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{AuthorityEpoch, FaintOccurrenceId};
use er_types::battle_model::{BattleOutcome, ReplacementProgress};
use er_types::battle_ui::{BattlePresentationEvent, PresentationPlanDigest};
use thiserror::Error;

use crate::internal_event::{GameIntent, InternalEvent, PreparedBattleResolution};
use crate::material::{
    BATTLE_MATERIAL_SCHEMA_VERSION, BattleMaterialApplyContext, BattleMaterialApplyError,
    BattleMaterialCodecError, BattleReplacementMaterialV1, BattleTurnMaterialV1,
    apply_replacement_material_trusted as apply_replacement_material,
    apply_turn_material_trusted as apply_turn_material, decode_replacement_material,
    decode_turn_material, encode_replacement_material, encode_turn_material,
};
use crate::runtime::{CommandAdmission, GameReduction, GameRuntime, GameRuntimeError};

// The canonical configuration lives in `runtime`; these aliases are only
// needed by the source-including local-battle contract test, so the production
// crate does not retain unused crate-private reexports.
#[cfg(test)]
#[allow(unused_imports)]
pub(crate) use crate::runtime::{BATTLE_START_SCHEMA_VERSION, BattleGameConfig, BattleStartV1};

/// The private phase visible to the local game reducer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LocalBattleFrontier {
    /// At least one human or scripted-enemy command is still missing.
    Command,
    /// The stored faint occurrence is the only valid replacement frontier.
    Replacement { occurrence: FaintOccurrenceId },
    /// No further battle command/replacement may be admitted.
    Complete(BattleOutcome),
}

/// Internal requests emitted by the private `Ui`/`Game` reducer.
///
/// `NoLegalReplacement` is not an externally constructible replacement
/// selection. The internal request is accepted only after `GameRuntime` has
/// scheduled the deterministic no-legal event from its stored frontier.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum LocalBattleRequest {
    Command(BattleCommandProposalV1),
    /// Retained for the complete production request surface when this source
    /// is included directly by the M3 local-battle contract test.
    #[allow(dead_code)]
    Replacement(BattleReplacementProposalV1),
    /// Retained for the internal no-legal-replacement path in the same
    /// source-including contract-test target.
    #[allow(dead_code)]
    InternalNoLegalReplacement {
        occurrence: FaintOccurrenceId,
    },
}

/// The material kind used by the common typed codec/applier path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LocalMaterialKind {
    Turn,
    Replacement,
}

/// Evidence returned by the concrete runtime adapter after it has completed
/// one staged resolver -> canonical material -> common applier operation.
///
/// The candidate and applied halves are intentionally retained until this
/// adapter checks exact equality. The runtime keeps the value only in its
/// staged transaction; no field here is a mutable game handle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LocalBattleMaterialResult {
    pub kind: LocalMaterialKind,
    pub operation_id: OperationId,
    pub before_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub candidate_after_state: GameState,
    pub candidate_after_digest: MechanicalStateDigest,
    pub applied_after_state: GameState,
    pub applied_after_digest: MechanicalStateDigest,
    pub candidate_outcome: BattleOutcome,
    pub applied_outcome: BattleOutcome,
    pub candidate_next_decision: BattleNextDecision,
    pub applied_next_decision: BattleNextDecision,
    pub candidate_control: BattleControlPlan,
    pub applied_control: BattleControlPlan,
    pub candidate_presentation: Vec<BattlePresentationEvent>,
    pub applied_presentation: Vec<BattlePresentationEvent>,
    pub candidate_presentation_digest: PresentationPlanDigest,
    pub applied_presentation_digest: PresentationPlanDigest,
}

impl LocalBattleMaterialResult {
    /// Prove resolver-candidate == material-applied equality before the
    /// enclosing kernel transaction can publish any effect.
    pub(crate) fn validate(&self) -> Result<(), LocalMaterialValidationError> {
        self.before_state
            .validate()
            .map_err(LocalMaterialValidationError::BeforeState)?;
        self.candidate_after_state
            .validate()
            .map_err(LocalMaterialValidationError::CandidateAfterState)?;
        self.applied_after_state
            .validate()
            .map_err(LocalMaterialValidationError::AppliedAfterState)?;

        let before_digest = compute_mechanical_state_digest(&self.before_state)
            .map_err(LocalMaterialValidationError::BeforeDigest)?;
        if before_digest != self.before_digest {
            return Err(LocalMaterialValidationError::BeforeDigestMismatch);
        }

        if self.candidate_after_state != self.applied_after_state {
            return Err(LocalMaterialValidationError::CandidateAppliedStateMismatch);
        }
        if self.candidate_after_digest != self.applied_after_digest {
            return Err(LocalMaterialValidationError::CandidateAppliedDigestMismatch);
        }
        let after_digest = compute_mechanical_state_digest(&self.candidate_after_state)
            .map_err(LocalMaterialValidationError::CandidateAfterDigest)?;
        if after_digest != self.candidate_after_digest {
            return Err(LocalMaterialValidationError::AfterDigestMismatch);
        }

        if self.candidate_outcome != self.applied_outcome {
            return Err(LocalMaterialValidationError::OutcomeMismatch);
        }
        if self.candidate_next_decision != self.applied_next_decision {
            return Err(LocalMaterialValidationError::NextDecisionMismatch);
        }
        if self.candidate_control != self.applied_control {
            return Err(LocalMaterialValidationError::ControlProjectionMismatch);
        }
        self.candidate_control
            .validate()
            .map_err(LocalMaterialValidationError::ControlInvalid)?;
        if self.candidate_presentation != self.applied_presentation {
            return Err(LocalMaterialValidationError::PresentationMismatch);
        }
        if self.candidate_presentation_digest != self.applied_presentation_digest {
            return Err(LocalMaterialValidationError::PresentationDigestMismatch);
        }
        Ok(())
    }
}

/// Failures in the equality and state proof at the material boundary. These
/// are fatal to the staged transaction; no fallback is valid.
#[derive(Debug, Error)]
pub(crate) enum LocalMaterialValidationError {
    #[error("material before state is invalid: {0}")]
    BeforeState(#[source] StateValidationError),
    #[error("resolver candidate after state is invalid: {0}")]
    CandidateAfterState(#[source] StateValidationError),
    #[error("material-applied after state is invalid: {0}")]
    AppliedAfterState(#[source] StateValidationError),
    #[error("material before digest cannot be computed: {0}")]
    BeforeDigest(#[source] MechanicalDigestError),
    #[error("resolver candidate after digest cannot be computed: {0}")]
    CandidateAfterDigest(#[source] MechanicalDigestError),
    #[error("material before digest does not describe before_state")]
    BeforeDigestMismatch,
    #[error("resolver candidate after_state differs from material-applied after_state")]
    CandidateAppliedStateMismatch,
    #[error("resolver candidate after_digest differs from material-applied after_digest")]
    CandidateAppliedDigestMismatch,
    #[error("material after digest does not describe the common after_state")]
    AfterDigestMismatch,
    #[error("resolver and material-applied outcomes differ")]
    OutcomeMismatch,
    #[error("resolver and material-applied next decisions differ")]
    NextDecisionMismatch,
    #[error("resolver and material-applied control projections differ")]
    ControlProjectionMismatch,
    #[error("material-applied control projection is invalid: {0}")]
    ControlInvalid(#[source] BattleControlPlanError),
    #[error("resolver and material-applied presentation plans differ")]
    PresentationMismatch,
    #[error("resolver and material-applied presentation digests differ")]
    PresentationDigestMismatch,
}

/// Progress returned to the private game reducer after one local request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum LocalBattleProgress {
    Waiting {
        frontier: LocalBattleFrontier,
    },
    MaterialInstalled(Box<LocalBattleMaterialResult>),
    /// The runtime's canonical admission ledger already contains this exact
    /// proposal. The runtime intentionally does not retain old material, so a
    /// duplicate is a no-op rather than a second resolver/material pass.
    AlreadyCommitted {
        operation_id: OperationId,
    },
}

/// Failures raised while reducing one private local-battle request.
#[derive(Debug, Error)]
pub(crate) enum LocalBattleError {
    #[error("local runtime rejected the request: {0}")]
    Runtime(#[source] LocalBattleRuntimeError),
    #[error("a command request arrived outside the command frontier: {actual:?}")]
    CommandOutsideFrontier { actual: LocalBattleFrontier },
    #[error(
        "a replacement request arrived outside its stored occurrence frontier: expected {expected:?}, actual {actual:?}"
    )]
    ReplacementOutsideFrontier {
        expected: FaintOccurrenceId,
        actual: LocalBattleFrontier,
    },
    #[error(
        "a replacement request names occurrence {requested:?}, but the stored frontier is {frontier:?}"
    )]
    InternalReplacementOutsideFrontier {
        requested: FaintOccurrenceId,
        frontier: LocalBattleFrontier,
    },
    #[error("a human replacement request attempted to submit NO_LEGAL_REPLACEMENT")]
    ExternalNoLegalReplacement,
    #[error("runtime reported an incomplete command frontier after reporting it complete")]
    FrontierAdmissionContradiction,
    #[error("the local material proof failed: {0}")]
    Material(#[source] LocalMaterialValidationError),
}

/// Failures inside the one concrete `GameRuntime` adapter.
#[derive(Debug, Error)]
pub(crate) enum LocalBattleRuntimeError {
    #[error("game runtime rejected local authority work: {0}")]
    Runtime(#[from] GameRuntimeError),
    #[error("canonical local material codec rejected the payload: {0}")]
    MaterialCodec(#[from] BattleMaterialCodecError),
    #[error("common local material applier rejected the payload: {0}")]
    MaterialApply(#[from] BattleMaterialApplyError),
    #[error("local presentation digest construction failed: {0}")]
    PresentationDigest(#[from] er_battle::PresentationPlanDigestComputationError),
    #[error("the runtime did not produce a PreparedBattleResolution")]
    MissingPreparedResolution,
    #[error("the runtime produced more than one PreparedBattleResolution")]
    MultiplePreparedResolutions,
    #[error("the runtime reduction did not carry an admission result")]
    MissingAdmission,
    #[error("the runtime reduction returned an unexpected admission shape")]
    UnexpectedAdmission,
    #[error("the internal no-legal replacement event did not carry its scheduled intent")]
    InternalEventMismatch,
    #[error("the material applier returned menu allocators different from next_control")]
    AppliedAllocatorMismatch,
    #[error("the runtime state does not equal the prepared transition before_state")]
    RuntimeBeforeStateMismatch,
    #[error("the canonical material round trip changed the typed value")]
    MaterialRoundTripMismatch,
}

struct PreparedLocalMaterial {
    result: LocalBattleMaterialResult,
    resolution: PreparedBattleResolution,
}

/// The only local lifecycle adapter. It owns no resolver or material policy;
/// its sole job is to stage a `GameRuntime` clone through the same typed
/// authority/material boundary used by the co-op path.
pub(crate) struct LocalBattleRuntimeAdapter<'a> {
    runtime: &'a mut GameRuntime,
    authority_epoch: AuthorityEpoch,
}

impl<'a> LocalBattleRuntimeAdapter<'a> {
    pub(crate) fn new(runtime: &'a mut GameRuntime, authority_epoch: AuthorityEpoch) -> Self {
        Self {
            runtime,
            authority_epoch,
        }
    }

    /// Reduce one local request atomically. A waiting command commits only the
    /// runtime's admitted frontier; a complete command/replacement commits
    /// only after canonical material application and candidate equality pass.
    pub(crate) fn reduce(
        &mut self,
        request: LocalBattleRequest,
    ) -> Result<LocalBattleProgress, LocalBattleError> {
        let mut staged = self.runtime.clone();
        let progress = reduce_staged_request(&mut staged, self.authority_epoch, request)?;
        *self.runtime = staged;
        Ok(progress)
    }
}

/// Convenience wrapper for the kernel integration seam. The outer kernel
/// transaction remains responsible for cloning/swapping the complete runtime;
/// this wrapper provides the local lane's inner atomic stage.
pub(crate) fn reduce_local_request(
    runtime: &mut GameRuntime,
    request: LocalBattleRequest,
    authority_epoch: AuthorityEpoch,
) -> Result<LocalBattleProgress, LocalBattleError> {
    LocalBattleRuntimeAdapter::new(runtime, authority_epoch).reduce(request)
}

fn reduce_staged_request(
    runtime: &mut GameRuntime,
    authority_epoch: AuthorityEpoch,
    request: LocalBattleRequest,
) -> Result<LocalBattleProgress, LocalBattleError> {
    let frontier = runtime_frontier(runtime)
        .map_err(LocalBattleRuntimeError::from)
        .map_err(LocalBattleError::Runtime)?;
    match request {
        LocalBattleRequest::Command(proposal) => {
            if frontier != LocalBattleFrontier::Command {
                return Err(LocalBattleError::CommandOutsideFrontier { actual: frontier });
            }
            let reduction = runtime
                .reduce(GameIntent::CommandProposal {
                    proposal,
                    authority_epoch,
                })
                .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            match command_admission(&reduction)? {
                CommandAdmission::Accepted {
                    frontier_complete: false,
                    ..
                } => Ok(LocalBattleProgress::Waiting {
                    frontier: runtime_frontier(runtime)
                        .map_err(|error| LocalBattleError::Runtime(error.into()))?,
                }),
                CommandAdmission::Accepted {
                    frontier_complete: true,
                    ..
                } => {
                    let resolution = prepared_resolution(reduction)?;
                    let prepared = prepare_material(runtime, &resolution)?;
                    finish_material(runtime, prepared)
                }
                CommandAdmission::IdempotentDuplicate { operation_id } => {
                    Ok(LocalBattleProgress::AlreadyCommitted { operation_id })
                }
            }
        }
        LocalBattleRequest::Replacement(proposal) => {
            if proposal.selection == ReplacementSelection::NoLegalReplacement {
                return Err(LocalBattleError::ExternalNoLegalReplacement);
            }
            let expected = proposal.occurrence;
            if !matches!(
                frontier,
                LocalBattleFrontier::Replacement { occurrence } if occurrence == expected
            ) {
                return Err(LocalBattleError::ReplacementOutsideFrontier {
                    expected,
                    actual: frontier,
                });
            }
            let reduction = runtime
                .reduce(GameIntent::ReplacementProposal {
                    proposal,
                    authority_epoch,
                })
                .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            match command_admission(&reduction)? {
                CommandAdmission::Accepted {
                    frontier_complete: true,
                    ..
                } => {
                    let resolution = prepared_resolution(reduction)?;
                    let prepared = prepare_material(runtime, &resolution)?;
                    finish_material(runtime, prepared)
                }
                CommandAdmission::Accepted {
                    frontier_complete: false,
                    ..
                } => Err(LocalBattleError::FrontierAdmissionContradiction),
                CommandAdmission::IdempotentDuplicate { operation_id } => {
                    Ok(LocalBattleProgress::AlreadyCommitted { operation_id })
                }
            }
        }
        LocalBattleRequest::InternalNoLegalReplacement { occurrence } => {
            if !matches!(
                frontier,
                LocalBattleFrontier::Replacement { occurrence: current } if current == occurrence
            ) {
                return Err(LocalBattleError::InternalReplacementOutsideFrontier {
                    requested: occurrence,
                    frontier,
                });
            }
            // Probe the runtime-produced internal event on a throwaway clone.
            // The live staged runtime must retain its pending marker until the
            // corresponding GameIntent consumes it in `GameRuntime::reduce`.
            let mut scheduled = runtime.clone();
            let event = scheduled
                .take_pending_no_legal_replacement()
                .map_err(|error| LocalBattleError::Runtime(error.into()))?
                .ok_or(LocalBattleError::Runtime(
                    LocalBattleRuntimeError::InternalEventMismatch,
                ))?;
            let InternalEvent::Game(_) = event else {
                return Err(LocalBattleError::Runtime(
                    LocalBattleRuntimeError::InternalEventMismatch,
                ));
            };
            let authority_epoch = runtime
                .state()
                .battle
                .as_ref()
                .and_then(|battle| {
                    battle
                        .faint_queue
                        .iter()
                        .find(|faint| faint.id == occurrence)
                })
                .map(|faint| faint.source.epoch)
                .ok_or(LocalBattleError::Runtime(
                    LocalBattleRuntimeError::InternalEventMismatch,
                ))?;
            let intent = GameIntent::NoLegalReplacement {
                occurrence,
                authority_epoch,
            };
            let reduction = runtime
                .reduce(intent)
                .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            if reduction.admission.is_some() {
                return Err(LocalBattleError::Runtime(
                    LocalBattleRuntimeError::UnexpectedAdmission,
                ));
            }
            let resolution = prepared_resolution(reduction)?;
            let prepared = prepare_material(runtime, &resolution)?;
            finish_material(runtime, prepared)
        }
    }
}

fn command_admission(reduction: &GameReduction) -> Result<CommandAdmission, LocalBattleError> {
    reduction.admission.clone().ok_or(LocalBattleError::Runtime(
        LocalBattleRuntimeError::MissingAdmission,
    ))
}

fn prepared_resolution(
    reduction: GameReduction,
) -> Result<PreparedBattleResolution, LocalBattleError> {
    let mut resolution = None;
    for event in reduction.events {
        if let InternalEvent::BattleResolved(payload) = event {
            if resolution.is_some() {
                return Err(LocalBattleError::Runtime(
                    LocalBattleRuntimeError::MultiplePreparedResolutions,
                ));
            }
            resolution = Some(payload.resolution);
        }
    }
    resolution.ok_or(LocalBattleError::Runtime(
        LocalBattleRuntimeError::MissingPreparedResolution,
    ))
}

fn runtime_frontier(runtime: &GameRuntime) -> Result<LocalBattleFrontier, GameRuntimeError> {
    let battle = runtime
        .state()
        .battle
        .as_ref()
        .ok_or(GameRuntimeError::NoActiveBattle)?;
    if battle.outcome != BattleOutcome::Ongoing {
        return Ok(LocalBattleFrontier::Complete(battle.outcome));
    }
    if let Some(faint) = battle
        .faint_queue
        .iter()
        .find(|faint| faint.replacement != ReplacementProgress::Applied)
    {
        return Ok(LocalBattleFrontier::Replacement {
            occurrence: faint.id,
        });
    }
    Ok(LocalBattleFrontier::Command)
}

fn prepare_material(
    runtime: &GameRuntime,
    resolution: &PreparedBattleResolution,
) -> Result<PreparedLocalMaterial, LocalBattleError> {
    let allocator_before = runtime.control().menu_allocators.clone();
    if runtime.state() != transition_before_state(resolution) {
        return Err(LocalBattleError::Runtime(
            LocalBattleRuntimeError::RuntimeBeforeStateMismatch,
        ));
    }
    match resolution {
        PreparedBattleResolution::Turn {
            digest_evidence,
            material_operation_id,
            next_control,
        } => {
            let transition = digest_evidence.transition();
            let material = build_turn_material(
                runtime,
                transition,
                material_operation_id,
                next_control,
                &allocator_before,
            )?;
            let encoded = encode_turn_material(&material)
                .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            let decoded = decode_turn_material(&encoded)
                .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            if decoded != material {
                return Err(LocalBattleError::Runtime(
                    LocalBattleRuntimeError::MaterialRoundTripMismatch,
                ));
            }
            let applied = apply_turn_material(
                &BattleMaterialApplyContext {
                    current_state: runtime.state().clone(),
                    local_seat: runtime.local_seat(),
                    menu_allocators: allocator_before.clone(),
                },
                &decoded,
                runtime.content(),
            )
            .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            finish_prepared_material(
                LocalMaterialKind::Turn,
                transition.before_state.clone(),
                transition.before_digest.clone(),
                transition.after_state.clone(),
                transition.after_digest.clone(),
                transition.outcome,
                transition.next_decision,
                transition.presentation.clone(),
                decoded.presentation_digest.clone(),
                next_control.clone(),
                applied,
                material_operation_id.clone(),
                resolution.clone(),
            )
        }
        PreparedBattleResolution::Replacement {
            transition,
            material_operation_id,
            next_control,
        } => {
            let material = build_replacement_material(
                runtime,
                transition,
                material_operation_id,
                next_control,
                &allocator_before,
            )?;
            let encoded = encode_replacement_material(&material)
                .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            let decoded = decode_replacement_material(&encoded)
                .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            if decoded != material {
                return Err(LocalBattleError::Runtime(
                    LocalBattleRuntimeError::MaterialRoundTripMismatch,
                ));
            }
            let applied = apply_replacement_material(
                &BattleMaterialApplyContext {
                    current_state: runtime.state().clone(),
                    local_seat: runtime.local_seat(),
                    menu_allocators: allocator_before.clone(),
                },
                &decoded,
                runtime.content(),
            )
            .map_err(|error| LocalBattleError::Runtime(error.into()))?;
            finish_prepared_material(
                LocalMaterialKind::Replacement,
                transition.before_state.clone(),
                transition.before_digest.clone(),
                transition.after_state.clone(),
                transition.after_digest.clone(),
                transition.outcome,
                transition.next_decision,
                transition.presentation.clone(),
                decoded.presentation_digest.clone(),
                next_control.clone(),
                applied,
                material_operation_id.clone(),
                resolution.clone(),
            )
        }
    }
}

fn transition_before_state(resolution: &PreparedBattleResolution) -> &GameState {
    match resolution {
        PreparedBattleResolution::Turn {
            digest_evidence, ..
        } => &digest_evidence.transition().before_state,
        PreparedBattleResolution::Replacement { transition, .. } => &transition.before_state,
    }
}

#[allow(clippy::too_many_arguments)]
fn finish_prepared_material(
    kind: LocalMaterialKind,
    before_state: GameState,
    before_digest: MechanicalStateDigest,
    candidate_after_state: GameState,
    candidate_after_digest: MechanicalStateDigest,
    candidate_outcome: BattleOutcome,
    candidate_next_decision: BattleNextDecision,
    candidate_presentation: Vec<BattlePresentationEvent>,
    candidate_presentation_digest: PresentationPlanDigest,
    candidate_control: BattleControlPlan,
    applied: crate::material::MaterialApplyResult,
    operation_id: OperationId,
    resolution: PreparedBattleResolution,
) -> Result<PreparedLocalMaterial, LocalBattleError> {
    if applied.menu_allocators != applied.next_control.menu_allocators {
        return Err(LocalBattleError::Runtime(
            LocalBattleRuntimeError::AppliedAllocatorMismatch,
        ));
    }
    Ok(PreparedLocalMaterial {
        result: LocalBattleMaterialResult {
            kind,
            operation_id,
            before_state,
            before_digest,
            candidate_after_state,
            candidate_after_digest,
            applied_after_state: applied.after_state.clone(),
            applied_after_digest: applied.after_digest.clone(),
            candidate_outcome,
            applied_outcome: applied.outcome,
            candidate_next_decision,
            applied_next_decision: applied.next_decision,
            candidate_control,
            applied_control: applied.next_control.clone(),
            candidate_presentation,
            applied_presentation: applied.presentation.clone(),
            candidate_presentation_digest,
            applied_presentation_digest: applied.presentation_digest.clone(),
        },
        resolution,
    })
}

fn finish_material(
    runtime: &mut GameRuntime,
    prepared: PreparedLocalMaterial,
) -> Result<LocalBattleProgress, LocalBattleError> {
    prepared
        .result
        .validate()
        .map_err(LocalBattleError::Material)?;
    runtime
        .install_resolution(&prepared.resolution)
        .map_err(|error| LocalBattleError::Runtime(error.into()))?;
    Ok(LocalBattleProgress::MaterialInstalled(Box::new(
        prepared.result,
    )))
}

fn build_turn_material(
    runtime: &GameRuntime,
    transition: &BattleTransition,
    operation_id: &OperationId,
    next_control: &BattleControlPlan,
    allocator_before: &[SeatMenuInstanceAllocator],
) -> Result<BattleTurnMaterialV1, LocalBattleError> {
    let before_battle =
        transition
            .before_state
            .battle
            .as_ref()
            .ok_or(LocalBattleError::Runtime(LocalBattleRuntimeError::Runtime(
                GameRuntimeError::NoActiveBattle,
            )))?;
    let after_battle = transition
        .after_state
        .battle
        .as_ref()
        .ok_or(LocalBattleError::Runtime(LocalBattleRuntimeError::Runtime(
            GameRuntimeError::NoActiveBattle,
        )))?;
    let presentation_digest = compute_presentation_plan_digest(&transition.presentation)
        .map_err(|error| LocalBattleError::Runtime(error.into()))?;
    Ok(BattleTurnMaterialV1 {
        schema_version: BATTLE_MATERIAL_SCHEMA_VERSION,
        oracle_game_sha: runtime.content().oracle_game_sha.clone(),
        content_hash: runtime.content().hash.clone(),
        operation_id: operation_id.clone(),
        battle_id: before_battle.battle_id,
        wave: before_battle.wave,
        resolved_turn: before_battle.turn,
        before_digest: transition.before_digest.clone(),
        after_digest: transition.after_digest.clone(),
        commands: transition.accepted_commands.clone(),
        action_order: transition.action_order.clone(),
        mutations: transition.mutations.clone(),
        presentation: transition.presentation.clone(),
        presentation_digest,
        rng_before: before_battle.battle_rng.clone(),
        rng_after: after_battle.battle_rng.clone(),
        rng_audit: transition.rng_audit.clone(),
        before_state: transition.before_state.clone(),
        after_state: transition.after_state.clone(),
        outcome: transition.outcome,
        next_decision: transition.next_decision,
        menu_allocators_before: allocator_before.to_vec(),
        next_control: next_control.clone(),
    })
}

fn build_replacement_material(
    runtime: &GameRuntime,
    transition: &BattleReplacementTransition,
    operation_id: &OperationId,
    next_control: &BattleControlPlan,
    allocator_before: &[SeatMenuInstanceAllocator],
) -> Result<BattleReplacementMaterialV1, LocalBattleError> {
    let before_battle =
        transition
            .before_state
            .battle
            .as_ref()
            .ok_or(LocalBattleError::Runtime(LocalBattleRuntimeError::Runtime(
                GameRuntimeError::NoActiveBattle,
            )))?;
    let presentation_digest = compute_presentation_plan_digest(&transition.presentation)
        .map_err(|error| LocalBattleError::Runtime(error.into()))?;
    Ok(BattleReplacementMaterialV1 {
        schema_version: BATTLE_MATERIAL_SCHEMA_VERSION,
        oracle_game_sha: runtime.content().oracle_game_sha.clone(),
        content_hash: runtime.content().hash.clone(),
        operation_id: operation_id.clone(),
        battle_id: before_battle.battle_id,
        wave: before_battle.wave,
        resolved_turn: transition.occurrence.source.resolved_turn,
        occurrence: transition.occurrence,
        selection: transition.selection,
        before_digest: transition.before_digest.clone(),
        after_digest: transition.after_digest.clone(),
        mutations: transition.mutations.clone(),
        presentation: transition.presentation.clone(),
        presentation_digest,
        before_state: transition.before_state.clone(),
        after_state: transition.after_state.clone(),
        outcome: transition.outcome,
        next_decision: transition.next_decision,
        menu_allocators_before: allocator_before.to_vec(),
        next_control: next_control.clone(),
    })
}
