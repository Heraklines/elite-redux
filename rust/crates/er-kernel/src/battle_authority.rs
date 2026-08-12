//! Private authority-side Battle transaction adapter.
//!
//! The adapter owns the ordering of the frozen M3 authority TURN and
//! REPLACEMENT paths.  It operates on a caller-provided clone of the complete
//! kernel transaction and returns another staged value; no protocol action,
//! presentation request, timer, revision, or control is published until the
//! enclosing integration-owned transaction has validated the whole stage.
//!
//! `er-game::material` and the enclosing `KernelTransaction` are intentionally
//! integration seams.  They are not recreated here: the common material
//! appliers remain the one production application path for authority and
//! replica, while this module only composes them with the authority log.

use std::collections::BTreeSet;

use er_battle::{BattleNextDecision, BattleReplacementTransition, BattleTransition};
use er_canonical::{canonical_bytes, canonicalize, content_digest};
use er_content::pack::ContentPack;
use er_game::authority_commands::{
    AuthorityCommandError, CommandAdmissionResult, CommandFrontierCompletion,
    PreparedAuthorityReplacement, PreparedAuthorityTurn, ReplacementAdmissionResult,
    admit_command_proposal_with_context, admit_replacement_proposal_with_context,
    admit_scripted_enemy_frontier, complete_command_frontier, internal_no_legal_replacement,
    project_scripted_policy_for_material,
};
use er_game::material::{
    BattleMaterialApplyContext, BattleMaterialApplyError, BattleReplacementMaterialV1,
    BattleTurnMaterialV1, MaterialApplyResult, apply_replacement_material, apply_turn_material,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLog, CommitOutcome, KernelScheduler, PreparedCommit,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommandProposalV1, BattleReplacementProposalV1, ScriptedEnemyPolicyV1,
    replacement_operation_id,
};
use er_types::battle_control::{BattleControl, BattleControlPlan, SeatMenuInstanceAllocator};
use er_types::battle_ids::{AuthorityEpoch, FaintOccurrenceId, FieldSlot, MenuInstanceId};
use er_types::battle_model::{BattleOutcome, FaintSource};
use er_types::battle_ui::{BattlePresentationEvent, PresentationPlanDigest};
use er_types::{
    AuthorityEntryKind, CommandControlTarget, CommandFrontierControl, FrameContext, Material,
    NextControl, OperationId, ReplacementControl, ReplacementControlAddress, SafeU53, SeatId,
    TerminalControl,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use thiserror::Error;

const TURN_MATERIAL_SCHEMA_VERSION: u32 = 1;
const REPLACEMENT_MATERIAL_SCHEMA_VERSION: u32 = 1;

/// Inputs copied from the enclosing staged kernel transaction.
///
/// The integration owner supplies the already-cloned game/control/protocol
/// owners.  A request never carries a semantic command or a protocol entry;
/// it carries only typed game proposals and a closed resolver/projection
/// bundle from `GameRuntime`.  `scripted_policy` is the current cursor used to
/// admit a still-pending current frontier, if any.  This adapter never
/// mutates or commits that input cursor; it carries only the separately derived
/// exact policy-after in the prepared/published stage.  The common GameRuntime
/// material-install method must validate the fresh admitted scripted frontier
/// and commit that cursor once for both authority and replica.
#[derive(Clone)]
pub(crate) struct AuthorityTransactionInput {
    pub state: GameState,
    pub control: BattleControlPlan,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
    pub scripted_policy: ScriptedEnemyPolicyV1,
    pub authority_epoch: AuthorityEpoch,
    pub local_seat: SeatId,
    pub authority_context: FrameContext,
    pub authority_log: AuthorityLog,
    pub scheduler: KernelScheduler,
}

/// Typed command-frontier decision supplied by the internal game reducer.
///
/// `prepared` is the closed hand-off from `GameRuntime`: it contains the
/// authority resolver candidate after the one game-owned next-frontier
/// projection and the exact logical plan for that candidate.  Its admission
/// context must contain runtime-generated immutable remote leaf replays and
/// the canonical allocator vector after proposal admission.  Loose semantic
/// control values, protocol metadata, and mutable fingerprint stores are
/// intentionally not request fields.
#[derive(Clone)]
pub(crate) struct AuthorityTurnRequest {
    pub human_proposals: Vec<BattleCommandProposalV1>,
    pub prepared: PreparedAuthorityTurn,
}

/// Typed replacement decision supplied by the internal game reducer.  The
/// no-candidate variant cannot be constructed from a public proposal input.
/// The prepared bundle has the same runtime-generated remote replay and
/// post-admission allocator requirements as TURN.  Its fingerprint field is a
/// read-only GameRuntime snapshot; the runtime commits any newly accepted
/// proposal to its own cloned fingerprint state.
#[derive(Clone)]
pub(crate) enum AuthorityReplacementDecision {
    Proposal(BattleReplacementProposalV1),
    NoLegalReplacement { occurrence: FaintOccurrenceId },
}

#[derive(Clone)]
pub(crate) struct AuthorityReplacementRequest {
    pub decision: AuthorityReplacementDecision,
    pub prepared: PreparedAuthorityReplacement,
}

/// Failure categories map one-for-one to the frozen
/// `AtomicTransitionError` table in the integration-owned kernel layer.
#[derive(Debug, Error)]
pub(crate) enum AuthorityTransactionError {
    #[error("authority command/replacement admission failed: {0}")]
    Admission(#[from] AuthorityCommandError),
    #[error("authority battle resolver failed: {0}")]
    BattleResolve(#[source] er_battle::error::BattleResolveError),
    #[error("authority material codec failed: {reason}")]
    MaterialCodec { reason: String },
    #[error("authority common material applier failed: {0}")]
    MaterialApply(#[source] BattleMaterialApplyError),
    #[error("authority material and resolver candidate diverged: {field}")]
    CandidateMismatch { field: &'static str },
    #[error("authority log stage failed: {0}")]
    AuthorityLog(#[source] er_protocol::authority_log::AuthorityLogError),
    #[error("authority scheduler allocation failed: {0}")]
    Scheduler(#[source] er_protocol::SchedulerError),
    #[error("authority material digest computation failed: {reason}")]
    MaterialDigest { reason: String },
    #[error("authority control projection is invalid: {reason}")]
    ControlProjection { reason: String },
    #[error("authority transaction enclosing validation failed: {reason}")]
    EnclosingValidation { reason: String },
    // Kept for the frozen error table; exact replacement duplicates are
    // handled as read-only admission evidence and never emit this variant.
    #[error("exact authority replacement stage is already admitted: {operation_id}")]
    Duplicate { operation_id: OperationId },
}

/// All deterministic values prepared before log publication.  The type is
/// opaque to callers except for the typed staged views below; in particular,
/// no `AuthorityLogAction` is returned as an external effect at this point.
pub(crate) struct AuthorityPreparedTransaction {
    state: GameState,
    control: BattleControlPlan,
    menu_allocators: Vec<SeatMenuInstanceAllocator>,
    presentation: Vec<BattlePresentationEvent>,
    material: PreparedMaterial,
    material_wire: Material,
    operation_id: OperationId,
    kind: AuthorityEntryKind,
    scripted_policy_after: ScriptedEnemyPolicyV1,
    log: AuthorityLog,
    scheduler: KernelScheduler,
    prepared: PreparedCommit,
}

pub(crate) enum PreparedMaterial {
    Turn(BattleTurnMaterialV1),
    Replacement(BattleReplacementMaterialV1),
}

impl AuthorityPreparedTransaction {
    pub(crate) fn state(&self) -> &GameState {
        &self.state
    }

    pub(crate) fn control(&self) -> &BattleControlPlan {
        &self.control
    }

    pub(crate) fn menu_allocators(&self) -> &[SeatMenuInstanceAllocator] {
        &self.menu_allocators
    }

    pub(crate) fn material_wire(&self) -> &Material {
        &self.material_wire
    }

    pub(crate) fn operation_id(&self) -> &OperationId {
        &self.operation_id
    }

    pub(crate) fn prepared_entry(&self) -> &er_types::AuthorityEntry {
        &self.prepared.entry
    }

    pub(crate) fn material(&self) -> &PreparedMaterial {
        &self.material
    }

    pub(crate) fn kind(&self) -> AuthorityEntryKind {
        self.kind
    }

    pub(crate) fn presentation(&self) -> &[BattlePresentationEvent] {
        &self.presentation
    }

    pub(crate) fn next_control(&self) -> &NextControl {
        &self.prepared.entry.next_control
    }

    /// The exact scripted cursor that the common material installer must
    /// commit with this staged state.  The adapter derives this from the
    /// serialized next frontier but never mutates the runtime-owned cursor.
    pub(crate) fn scripted_policy_after(&self) -> &ScriptedEnemyPolicyV1 {
        &self.scripted_policy_after
    }

    /// Publish only after the enclosing integration-owned transaction has
    /// compared every staged subsystem and validated cross-owner identity.
    pub(crate) fn publish_after_validation<V: EnclosingKernelValidation>(
        self,
        validator: &V,
    ) -> Result<AuthorityPublishedTransaction, AuthorityTransactionError> {
        validator.validate_authority_stage(&self)?;
        let AuthorityPreparedTransaction {
            state,
            control,
            menu_allocators,
            presentation,
            material,
            material_wire: _,
            operation_id,
            kind,
            scripted_policy_after,
            mut log,
            mut scheduler,
            prepared,
        } = self;
        let commit = log
            .publish_prepared(prepared.token, &mut scheduler)
            .map_err(map_authority_log_error)?;
        let published = AuthorityPublishedTransaction {
            state,
            control,
            menu_allocators,
            presentation,
            material,
            operation_id,
            kind,
            scripted_policy_after,
            log,
            scheduler,
            commit,
        };
        validate_published_authority_stage(&published)?;
        validator.validate_authority_publication(&published)?;
        Ok(published)
    }
}

/// The only legal publication hook.  The integration-owned
/// `KernelTransaction` implements this trait and must validate staged game,
/// protocol, scheduler, input, UI, presentation barriers, and effects before
/// this adapter can call `AuthorityLog::publish_prepared`; its publication
/// hook runs again on the cloned post-publication stage before any commit
/// actions escape.
pub(crate) trait EnclosingKernelValidation {
    fn validate_authority_stage(
        &self,
        staged: &AuthorityPreparedTransaction,
    ) -> Result<(), AuthorityTransactionError>;

    /// Validate the cloned log/scheduler publication before the published
    /// transaction—and therefore its commit/effect actions—can escape to the
    /// enclosing transaction.  The adapter enforces its baseline publication
    /// identity and peerless-local checks before calling this hook; the
    /// default retains compatibility with the current integration owner.
    fn validate_authority_publication(
        &self,
        _published: &AuthorityPublishedTransaction,
    ) -> Result<(), AuthorityTransactionError> {
        Ok(())
    }
}

pub(crate) struct AuthorityPublishedTransaction {
    pub(crate) state: GameState,
    pub(crate) control: BattleControlPlan,
    pub(crate) menu_allocators: Vec<SeatMenuInstanceAllocator>,
    pub(crate) presentation: Vec<BattlePresentationEvent>,
    pub(crate) material: PreparedMaterial,
    pub(crate) operation_id: OperationId,
    pub(crate) kind: AuthorityEntryKind,
    pub(crate) scripted_policy_after: ScriptedEnemyPolicyV1,
    pub(crate) log: AuthorityLog,
    pub(crate) scheduler: KernelScheduler,
    pub(crate) commit: CommitOutcome,
}

fn validate_published_authority_stage(
    published: &AuthorityPublishedTransaction,
) -> Result<(), AuthorityTransactionError> {
    if published.commit.entry.operation_id != published.operation_id
        || published.commit.entry.kind != published.kind
    {
        return Err(AuthorityTransactionError::EnclosingValidation {
            reason: "published commit identity diverged from the staged authority operation"
                .to_owned(),
        });
    }
    published
        .scripted_policy_after
        .validate()
        .map_err(|source| {
            AuthorityTransactionError::Admission(AuthorityCommandError::ScriptedPolicy(source))
        })?;

    // `AuthorityLog::new_local` intentionally has no remote delivery action.
    // A local publication is nevertheless complete when the log reports its
    // empty peer quorum as satisfied; do not manufacture a synthetic peer or
    // reject a valid peerless commit merely because the action list has no
    // Deliver entry.
    let has_peer_delivery = published
        .commit
        .actions
        .iter()
        .any(|action| matches!(action, er_protocol::AuthorityLogAction::Deliver { .. }));
    if !has_peer_delivery
        && !published
            .log
            .peer_stage_quorum(&published.operation_id, er_types::AckStage::Admitted)
    {
        return Err(AuthorityTransactionError::EnclosingValidation {
            reason:
                "authority publication has no peer delivery but its local quorum is not satisfied"
                    .to_owned(),
        });
    }
    Ok(())
}

/// Prepare a complete authority TURN on the already-cloned transaction.
pub(crate) fn prepare_authority_turn(
    input: AuthorityTransactionInput,
    request: AuthorityTurnRequest,
    content: &ContentPack,
) -> Result<AuthorityPreparedTransaction, AuthorityTransactionError> {
    let AuthorityTransactionInput {
        state,
        control,
        menu_allocators,
        scripted_policy,
        authority_epoch,
        local_seat,
        authority_context,
        authority_log,
        scheduler,
    } = input;
    let AuthorityTurnRequest {
        human_proposals,
        prepared:
            PreparedAuthorityTurn {
                transition: candidate,
                control_plan: next_control,
                admission: prepared_admission,
            },
    } = request;
    // Stage all human owners in canonical operation order.  Authority-local
    // proposals deliberately use the same game admission reducer as relayed
    // proposals; only the transport path differs outside this module.
    let mut proposals = human_proposals;
    proposals.sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
    let mut staged_state = state;
    let mut admitted_proposals = Vec::new();
    for proposal in &proposals {
        match admit_command_proposal_with_context(
            &staged_state,
            &control,
            Some(&prepared_admission),
            proposal,
            content,
        )? {
            CommandAdmissionResult::Admitted { state, .. } => {
                staged_state = state;
                admitted_proposals.push(proposal.clone());
            }
            CommandAdmissionResult::Duplicate { .. } => {}
        }
    }

    // GameRuntime may already have admitted the scripted entries in its
    // current frontier while producing `prepared`.  Only run the admission
    // reducer when a pending enemy entry remains; an already-retained or
    // already-admitted entry must not consume the policy cursor twice.
    let (staged_state, staged_policy) =
        admit_scripted_if_pending(&staged_state, &scripted_policy, content)?;
    let completion = complete_command_frontier(&staged_state, content)?;
    let CommandFrontierCompletion::Complete {
        state: complete_state,
        commands: completed_commands,
    } = completion
    else {
        return Err(AuthorityTransactionError::ControlProjection {
            reason: "authority resolution requested before exact command frontier completion"
                .to_owned(),
        });
    };

    // Keep the resolver's command evidence tied to the exact completed
    // frontier.  The completion helper returns a canonical set, while the
    // completed state carries the authoritative frontier and tombstones; both
    // must agree before the candidate can become material.
    completed_commands
        .validate_canonical_order()
        .map_err(AuthorityCommandError::Command)
        .map_err(AuthorityTransactionError::Admission)?;
    let completed_battle = complete_state.battle.as_ref().ok_or_else(|| {
        AuthorityTransactionError::ControlProjection {
            reason: "completed command frontier has no active battle".to_owned(),
        }
    })?;
    completed_battle
        .command_state
        .validate()
        .map_err(AuthorityCommandError::Command)
        .map_err(AuthorityTransactionError::Admission)?;
    let completed_state_commands = completed_battle
        .command_state
        .admitted_command_set()
        .map_err(AuthorityCommandError::Command)
        .map_err(AuthorityTransactionError::Admission)?;
    if completed_state_commands != completed_commands
        || candidate.accepted_commands != completed_state_commands
    {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "accepted_commands",
        });
    }

    // The full before-state equality below includes the canonical frontier
    // and tombstones, not only the mechanical digest.
    if candidate.before_state != complete_state {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "before_state",
        });
    }
    let battle = completed_battle;
    let operation_id = er_types::battle_command::turn_result_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
    )
    .map_err(AuthorityCommandError::Command)
    .map_err(AuthorityTransactionError::Admission)?;
    let scripted_policy_after = validate_prepared_projection(
        &candidate.after_state,
        candidate.next_decision,
        &next_control,
        &staged_policy,
        content,
    )?;

    let allocators = advance_allocators_for_proposals(&menu_allocators, &admitted_proposals)?;
    if prepared_admission.allocator_before() != allocators.as_slice() {
        return Err(AuthorityTransactionError::Admission(
            AuthorityCommandError::AdmissionAllocatorMismatch,
        ));
    }
    validate_control_allocator_projection(&next_control, &allocators)?;
    let material = build_turn_material(
        &candidate,
        &operation_id,
        &next_control,
        &allocators,
        content,
    )?;
    let (decoded, payload) = encode_decode_material(&material)?;
    let material_wire = Material {
        digest: turn_material_digest(&payload)?,
        payload,
    };
    let applied = apply_turn_material(
        &BattleMaterialApplyContext {
            current_state: complete_state.clone(),
            local_seat,
            menu_allocators: allocators.clone(),
        },
        &decoded,
        content,
    )
    .map_err(AuthorityTransactionError::MaterialApply)?;
    if next_control != applied.next_control {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "next_control",
        });
    }
    require_turn_equivalence(&candidate, &decoded, &applied)?;
    let protocol_next_control = protocol_next_control_from_plan(
        candidate.next_decision,
        &applied.next_control,
        authority_epoch,
    )?;

    let mut log = authority_log;
    let prepared = log
        .prepare_commit(AuthorityEntryDraft {
            context: authority_context,
            operation_id: operation_id.clone(),
            kind: AuthorityEntryKind::TurnCommit,
            material: material_wire.clone(),
            next_control: protocol_next_control,
            subsumes: Vec::new(),
        })
        .map_err(map_authority_log_error)?;

    Ok(AuthorityPreparedTransaction {
        state: applied.after_state.clone(),
        control: applied.next_control.clone(),
        menu_allocators: applied.menu_allocators.clone(),
        presentation: applied.presentation.clone(),
        material: PreparedMaterial::Turn(decoded),
        material_wire,
        operation_id,
        kind: AuthorityEntryKind::TurnCommit,
        scripted_policy_after,
        log,
        scheduler,
        prepared,
    })
}

/// Prepare a complete authority REPLACEMENT transaction.  The request carries
/// the one authority resolver candidate and game-owned projection bundle;
/// replicas use the common material applier and never call this function.
pub(crate) fn prepare_authority_replacement(
    input: AuthorityTransactionInput,
    request: AuthorityReplacementRequest,
    content: &ContentPack,
) -> Result<AuthorityPreparedTransaction, AuthorityTransactionError> {
    let AuthorityTransactionInput {
        state,
        control,
        menu_allocators,
        scripted_policy,
        authority_epoch: _,
        local_seat,
        authority_context,
        authority_log,
        scheduler,
    } = input;
    let AuthorityReplacementRequest {
        decision,
        prepared:
            PreparedAuthorityReplacement {
                transition: candidate,
                control_plan: next_control,
                admission: prepared_admission,
                replacement_fingerprints,
            },
    } = request;
    let (selection, occurrence, proposals) = match decision {
        AuthorityReplacementDecision::Proposal(proposal) => {
            let admission = admit_replacement_proposal_with_context(
                &state,
                &control,
                Some(&prepared_admission),
                replacement_fingerprints.entries(),
                &proposal,
                content,
            )?;
            match admission {
                ReplacementAdmissionResult::Admitted { proposal } => {
                    (proposal.selection, proposal.occurrence, vec![proposal])
                }
                ReplacementAdmissionResult::Duplicate { .. } => {
                    // GameRuntime is the sole mutable fingerprint owner and
                    // records the accepted replacement before emitting its
                    // prepared resolver candidate. Seeing that exact
                    // fingerprint here is therefore the expected read-only
                    // proof, not a request to resolve a duplicate input.
                    (proposal.selection, proposal.occurrence, vec![proposal])
                }
            }
        }
        AuthorityReplacementDecision::NoLegalReplacement { occurrence } => {
            let internal = internal_no_legal_replacement(&state, occurrence, content)?;
            (internal.selection, occurrence, Vec::new())
        }
    };

    let battle =
        state
            .battle
            .as_ref()
            .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                reason: "REPLACEMENT preparation has no active battle".to_owned(),
            })?;
    let stored = battle
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence)
        .ok_or_else(|| AuthorityTransactionError::ControlProjection {
            reason: "REPLACEMENT preparation lost its stored occurrence".to_owned(),
        })?;
    let operation_id = er_types::battle_command::replacement_operation_id(
        stored.source.epoch,
        battle.battle_id,
        stored.source.wave,
        stored.source.resolved_turn,
        stored.source.turn_occurrence,
        stored.slot,
        stored
            .owner_seat
            .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                reason: "REPLACEMENT occurrence has no player owner".to_owned(),
            })?,
    )
    .map_err(AuthorityCommandError::Command)
    .map_err(AuthorityTransactionError::Admission)?;
    if proposals.is_empty() {
        validate_internal_replacement_control(&control, stored, &operation_id)?;
    }
    if candidate.before_state != state {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "before_state",
        });
    }
    if candidate.occurrence.id != occurrence {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "occurrence",
        });
    }
    if candidate.selection != selection {
        return Err(AuthorityTransactionError::CandidateMismatch { field: "selection" });
    }
    let scripted_policy_after = validate_prepared_projection(
        &candidate.after_state,
        candidate.next_decision,
        &next_control,
        &scripted_policy,
        content,
    )?;

    let allocators = advance_allocators_for_replacement_proposals(&menu_allocators, &proposals)?;
    if prepared_admission.allocator_before() != allocators.as_slice() {
        return Err(AuthorityTransactionError::Admission(
            AuthorityCommandError::AdmissionAllocatorMismatch,
        ));
    }
    validate_control_allocator_projection(&next_control, &allocators)?;
    let material = build_replacement_material(
        &candidate,
        &operation_id,
        &next_control,
        &allocators,
        content,
    )?;
    let (decoded, payload) = encode_decode_material(&material)?;
    let material_wire = Material {
        digest: replacement_material_digest(&payload)?,
        payload,
    };
    let applied = apply_replacement_material(
        &BattleMaterialApplyContext {
            current_state: state.clone(),
            local_seat,
            menu_allocators: allocators.clone(),
        },
        &decoded,
        content,
    )
    .map_err(AuthorityTransactionError::MaterialApply)?;
    if next_control != applied.next_control {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "next_control",
        });
    }
    require_replacement_equivalence(&candidate, &decoded, &applied)?;
    let protocol_next_control = protocol_next_control_from_plan(
        candidate.next_decision,
        &applied.next_control,
        stored.source.epoch,
    )?;

    let mut log = authority_log;
    let prepared = log
        .prepare_commit(AuthorityEntryDraft {
            context: authority_context,
            operation_id: operation_id.clone(),
            kind: AuthorityEntryKind::ReplacementCommit,
            material: material_wire.clone(),
            next_control: protocol_next_control,
            subsumes: Vec::new(),
        })
        .map_err(map_authority_log_error)?;

    Ok(AuthorityPreparedTransaction {
        state: applied.after_state.clone(),
        control: applied.next_control.clone(),
        menu_allocators: applied.menu_allocators.clone(),
        presentation: applied.presentation.clone(),
        material: PreparedMaterial::Replacement(decoded),
        material_wire,
        operation_id,
        kind: AuthorityEntryKind::ReplacementCommit,
        scripted_policy_after,
        log,
        scheduler,
        prepared,
    })
}

fn map_authority_log_error(
    source: er_protocol::authority_log::AuthorityLogError,
) -> AuthorityTransactionError {
    match source {
        er_protocol::authority_log::AuthorityLogError::Scheduler(error) => {
            AuthorityTransactionError::Scheduler(error)
        }
        other => AuthorityTransactionError::AuthorityLog(other),
    }
}

fn admit_scripted_if_pending(
    state: &GameState,
    policy: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<(GameState, ScriptedEnemyPolicyV1), AuthorityTransactionError> {
    // This is a temporary admission view needed only when the transaction's
    // input frontier still has pending enemy entries.  A prepared GameRuntime
    // frontier already carrying admitted enemies takes the no-op branch, so
    // the common material-install policy projector cannot be double-consumed.
    // Neither return value is installed or published by this adapter.
    let battle =
        state
            .battle
            .as_ref()
            .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                reason: "scripted command admission has no active battle".to_owned(),
            })?;
    let has_pending_enemy = battle.command_state.frontier.iter().any(|entry| {
        entry.field_slot.side == er_types::battle_ids::BattleSide::Enemy
            && matches!(
                &entry.status,
                er_types::battle_command::CommandFrontierStatus::Pending
            )
    });
    if !has_pending_enemy {
        return Ok((state.clone(), policy.clone()));
    }
    let admitted = admit_scripted_enemy_frontier(state, policy, content)?;
    Ok((admitted.state, admitted.policy))
}

/// Validate the already-projected resolver candidate before it becomes
/// material.  The candidate and control plan are a single GameRuntime-owned
/// bundle: a command frontier decision is not accepted with an empty or
/// un-actionable `after_state`, and protocol metadata is not part of this
/// input.  The returned policy is the exact cursor-after for the serialized
/// candidate frontier.
fn validate_prepared_projection(
    after_state: &GameState,
    next_decision: BattleNextDecision,
    control_plan: &BattleControlPlan,
    policy_before: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<ScriptedEnemyPolicyV1, AuthorityTransactionError> {
    policy_before.validate().map_err(|source| {
        AuthorityTransactionError::Admission(AuthorityCommandError::ScriptedPolicy(source))
    })?;
    control_plan.validate().map_err(|source| {
        AuthorityTransactionError::Admission(AuthorityCommandError::ControlPlan(source))
    })?;
    let battle = after_state.battle.as_ref().ok_or_else(|| {
        AuthorityTransactionError::ControlProjection {
            reason: "prepared resolver candidate has no after battle".to_owned(),
        }
    })?;
    let expected_turn = match next_decision {
        BattleNextDecision::Replacement { occurrence } => battle
            .faint_queue
            .iter()
            .find(|candidate| candidate.id == occurrence)
            .map(|candidate| candidate.source.resolved_turn)
            .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                reason: "prepared replacement candidate lost its occurrence".to_owned(),
            })?,
        BattleNextDecision::CommandFrontier | BattleNextDecision::Complete(_) => battle.turn,
    };
    if control_plan.battle_id != battle.battle_id
        || control_plan.wave != battle.wave
        || control_plan.turn != expected_turn
    {
        return Err(AuthorityTransactionError::ControlProjection {
            reason: "prepared control plan coordinates do not match after_state".to_owned(),
        });
    }

    match next_decision {
        BattleNextDecision::CommandFrontier => {
            validate_command_frontier_projection(battle, control_plan)?;
            // This is validation-only.  The common GameRuntime material
            // installer calls the same role-neutral projector and owns the
            // policy cursor commit for both authority and replica.  Carrying
            // this exact clone through the prepared transaction prevents the
            // adapter from silently dropping the advancement while avoiding a
            // second mutating admission path.
            project_scripted_policy_for_material(after_state, policy_before, content)
                .map_err(AuthorityTransactionError::Admission)
        }
        BattleNextDecision::Replacement { occurrence } => {
            let stored = battle
                .faint_queue
                .iter()
                .find(|candidate| candidate.id == occurrence)
                .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                    reason: "prepared replacement candidate lost its occurrence".to_owned(),
                })?;
            let owner =
                stored
                    .owner_seat
                    .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                        reason: "prepared replacement occurrence has no player owner".to_owned(),
                    })?;
            let operation_id = replacement_operation_id(
                stored.source.epoch,
                battle.battle_id,
                stored.source.wave,
                stored.source.resolved_turn,
                stored.source.turn_occurrence,
                stored.slot,
                owner,
            )
            .map_err(AuthorityCommandError::Command)
            .map_err(AuthorityTransactionError::Admission)?;
            validate_internal_replacement_control(control_plan, stored, &operation_id)?;
            Ok(policy_before.clone())
        }
        BattleNextDecision::Complete(outcome) => {
            if control_plan.seats.iter().any(|seat| {
                !matches!(&seat.control, BattleControl::Complete(actual) if *actual == outcome)
                    || seat.decision_operation_id.is_some()
            }) {
                return Err(AuthorityTransactionError::ControlProjection {
                    reason: "complete resolver candidate has a non-complete seat control"
                        .to_owned(),
                });
            }
            Ok(policy_before.clone())
        }
    }
}

fn validate_command_frontier_projection(
    battle: &er_state::battle::BattleState,
    control_plan: &BattleControlPlan,
) -> Result<(), AuthorityTransactionError> {
    if battle.command_state.frontier.is_empty() {
        return Err(AuthorityTransactionError::ControlProjection {
            reason: "command-frontier candidate has no next CommandCollectionState entries"
                .to_owned(),
        });
    }
    for seat in &control_plan.seats {
        let Some((actor, field_slot)) = command_control_coordinates(&seat.control) else {
            return Err(AuthorityTransactionError::ControlProjection {
                reason: "command-frontier plan contains a non-command seat control".to_owned(),
            });
        };
        let Some(operation_id) = seat.decision_operation_id.as_ref() else {
            return Err(AuthorityTransactionError::ControlProjection {
                reason: "command-frontier plan has no decision operation".to_owned(),
            });
        };
        let Some(entry) = battle.command_state.frontier.iter().find(|entry| {
            entry.owner_seat == Some(seat.seat)
                && entry.actor == actor
                && entry.field_slot == field_slot
        }) else {
            return Err(AuthorityTransactionError::ControlProjection {
                reason: "command-frontier plan is not bound to the next command collection"
                    .to_owned(),
            });
        };
        if entry.operation_id != *operation_id
            || !matches!(
                &entry.status,
                er_types::battle_command::CommandFrontierStatus::Pending
            )
        {
            return Err(AuthorityTransactionError::ControlProjection {
                reason: "next command collection contains a stale or already-admitted human entry"
                    .to_owned(),
            });
        }
    }
    if battle
        .command_state
        .frontier
        .iter()
        .filter(|entry| entry.field_slot.side == er_types::battle_ids::BattleSide::Player)
        .any(|entry| {
            let Some(owner) = entry.owner_seat else {
                return true;
            };
            !control_plan.seats.iter().any(|seat| {
                seat.seat == owner
                    && command_control_coordinates(&seat.control).is_some_and(
                        |(actor, field_slot)| {
                            actor == entry.actor
                                && field_slot == entry.field_slot
                                && seat.decision_operation_id.as_ref() == Some(&entry.operation_id)
                        },
                    )
            })
        })
    {
        return Err(AuthorityTransactionError::ControlProjection {
            reason: "next command collection contains an unprojected human entry".to_owned(),
        });
    }
    Ok(())
}

fn command_control_coordinates(
    control: &BattleControl,
) -> Option<(er_types::battle_ids::PokemonId, FieldSlot)> {
    match control {
        BattleControl::CommandRoot(value) => Some((value.actor, value.field_slot)),
        BattleControl::MoveSelect(value) => Some((value.actor, value.field_slot)),
        BattleControl::TargetSelect(value) => Some((value.actor, value.field_slot)),
        BattleControl::PartySelect(value) => Some((value.actor, value.field_slot)),
        BattleControl::PartyOptionSelect(value) => Some((value.actor, value.field_slot)),
        BattleControl::ReplacementSelect(_)
        | BattleControl::Waiting(_)
        | BattleControl::Complete(_) => None,
    }
}

fn validate_control_allocator_projection(
    control_plan: &BattleControlPlan,
    menu_allocators_before: &[SeatMenuInstanceAllocator],
) -> Result<(), AuthorityTransactionError> {
    let mut expected = menu_allocators_before.to_vec();
    expected.sort_by_key(|allocator| allocator.seat);
    let mut seen = BTreeSet::new();
    for seat in &control_plan.seats {
        collect_control_menu_instances(&seat.control, &mut seen, &mut expected)?;
    }
    expected.sort_by_key(|allocator| allocator.seat);
    if expected != control_plan.menu_allocators {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "next_control.menu_allocators",
        });
    }
    Ok(())
}

fn collect_control_menu_instances(
    control: &BattleControl,
    seen: &mut BTreeSet<(SeatId, MenuInstanceId)>,
    allocators: &mut [SeatMenuInstanceAllocator],
) -> Result<(), AuthorityTransactionError> {
    let menu = match control {
        BattleControl::CommandRoot(value) => Some(&value.menu),
        BattleControl::MoveSelect(value) => Some(&value.menu),
        BattleControl::TargetSelect(value) => Some(&value.menu),
        BattleControl::PartySelect(value) => Some(&value.menu),
        BattleControl::PartyOptionSelect(value) => Some(&value.menu),
        BattleControl::ReplacementSelect(value) => Some(&value.menu),
        BattleControl::Waiting(_) | BattleControl::Complete(_) => None,
    };
    if let Some(menu) = menu {
        if !seen.insert((menu.owner_seat, menu.instance_id)) {
            return Err(AuthorityTransactionError::ControlProjection {
                reason: "next control repeats a seat-scoped menu instance".to_owned(),
            });
        }
        let allocator = allocators
            .iter_mut()
            .find(|allocator| allocator.seat == menu.owner_seat)
            .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                reason: "next control menu owner has no allocator".to_owned(),
            })?;
        let required = menu
            .instance_id
            .get()
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                reason: "next control menu allocator exhausted".to_owned(),
            })?;
        if required > allocator.next_menu_instance_id.get() {
            allocator.next_menu_instance_id = er_types::battle_ids::MenuInstanceId::new(required);
        }
    }
    match control {
        BattleControl::MoveSelect(value) => {
            collect_control_menu_instances(&value.cancel_to, seen, allocators)?;
        }
        BattleControl::TargetSelect(value) => {
            collect_control_menu_instances(&value.cancel_to, seen, allocators)?;
        }
        BattleControl::PartySelect(value) => {
            collect_control_menu_instances(&value.cancel_to, seen, allocators)?;
        }
        BattleControl::PartyOptionSelect(value) => {
            collect_control_menu_instances(&value.cancel_to, seen, allocators)?;
        }
        BattleControl::CommandRoot(_)
        | BattleControl::ReplacementSelect(_)
        | BattleControl::Waiting(_)
        | BattleControl::Complete(_) => {}
    }
    Ok(())
}

pub(crate) fn protocol_next_control_from_plan(
    next_decision: BattleNextDecision,
    control_plan: &BattleControlPlan,
    authority_epoch: AuthorityEpoch,
) -> Result<NextControl, AuthorityTransactionError> {
    control_plan.validate().map_err(|source| {
        AuthorityTransactionError::Admission(AuthorityCommandError::ControlPlan(source))
    })?;
    match next_decision {
        BattleNextDecision::CommandFrontier => {
            let mut commands = control_plan
                .seats
                .iter()
                .map(|seat| {
                    let (actor, field_slot) = command_control_coordinates(&seat.control)
                        .ok_or_else(|| AuthorityTransactionError::ControlProjection {
                            reason:
                                "cannot derive protocol command target from the exact control plan"
                                    .to_owned(),
                        })?;
                    Ok(CommandControlTarget {
                        owner_seat_id: seat.seat,
                        pokemon_id: actor.get(),
                        field_index: SafeU53::new(u64::from(field_slot.position)).map_err(
                            |source| AuthorityTransactionError::ControlProjection {
                                reason: source.to_string(),
                            },
                        )?,
                    })
                })
                .collect::<Result<Vec<_>, AuthorityTransactionError>>()?;
            commands.sort_by(|left, right| {
                left.field_index
                    .cmp(&right.field_index)
                    .then_with(|| left.owner_seat_id.cmp(&right.owner_seat_id))
                    .then_with(|| left.pokemon_id.cmp(&right.pokemon_id))
            });
            if commands.is_empty() {
                return Err(AuthorityTransactionError::ControlProjection {
                    reason: "cannot derive an empty protocol command frontier".to_owned(),
                });
            }
            Ok(NextControl::CommandFrontier(CommandFrontierControl {
                epoch: authority_epoch.get(),
                wave: control_plan.wave.get(),
                turn: control_plan.turn.get(),
                commands,
            }))
        }
        BattleNextDecision::Replacement { occurrence } => {
            let mut targets = control_plan
                .seats
                .iter()
                .filter_map(|seat| {
                    replacement_control_coordinates(&seat.control).map(
                        |(id, source, field_slot, owner)| (seat, id, source, field_slot, owner),
                    )
                })
                .collect::<Vec<_>>();
            targets.sort_by(|left, right| {
                left.1
                    .cmp(&right.1)
                    .then_with(|| left.3.cmp(&right.3))
                    .then_with(|| left.4.cmp(&right.4))
            });
            let Some((current, current_occurrence, current_source, current_slot, current_owner)) =
                targets.iter().find(|target| target.1 == occurrence)
            else {
                return Err(AuthorityTransactionError::ControlProjection {
                    reason: "cannot derive protocol replacement control for the exact occurrence"
                        .to_owned(),
                });
            };
            let operation_id = current.decision_operation_id.clone().ok_or_else(|| {
                AuthorityTransactionError::ControlProjection {
                    reason: "replacement control plan has no decision operation".to_owned(),
                }
            })?;
            let remaining = targets
                .iter()
                .filter(|target| target.1 != *current_occurrence)
                .map(|target| {
                    replacement_control_address(
                        target.0, &target.1, &target.2, &target.3, &target.4,
                    )
                })
                .collect::<Result<Vec<_>, AuthorityTransactionError>>()?;
            Ok(NextControl::Replacement(ReplacementControl {
                operation_id,
                owner_seat_id: *current_owner,
                epoch: current_source.epoch.get(),
                wave: control_plan.wave.get(),
                turn: control_plan.turn.get(),
                occurrence: (*current_occurrence).into(),
                field_index: SafeU53::new(u64::from(current_slot.position)).map_err(|source| {
                    AuthorityTransactionError::ControlProjection {
                        reason: source.to_string(),
                    }
                })?,
                remaining,
            }))
        }
        BattleNextDecision::Complete(outcome) => {
            let label = match outcome {
                BattleOutcome::Victory => "victory",
                BattleOutcome::Defeat => "defeat",
                BattleOutcome::Ongoing => {
                    return Err(AuthorityTransactionError::ControlProjection {
                        reason: "ongoing outcome cannot derive terminal control".to_owned(),
                    });
                }
            };
            Ok(NextControl::Terminal(TerminalControl {
                terminal_id: format!(
                    "battle/{}/wave/{}/turn/{}/complete/{label}",
                    control_plan.battle_id, control_plan.wave, control_plan.turn
                ),
            }))
        }
    }
}

fn replacement_control_coordinates(
    control: &BattleControl,
) -> Option<(FaintOccurrenceId, FaintSource, FieldSlot, SeatId)> {
    match control {
        BattleControl::ReplacementSelect(value) => Some((
            value.occurrence,
            value.source,
            value.field_slot,
            value.owner_seat,
        )),
        BattleControl::PartyOptionSelect(value) => match value.cancel_to.as_ref() {
            BattleControl::ReplacementSelect(parent) => Some((
                parent.occurrence,
                parent.source,
                parent.field_slot,
                parent.owner_seat,
            )),
            _ => None,
        },
        BattleControl::CommandRoot(_)
        | BattleControl::MoveSelect(_)
        | BattleControl::TargetSelect(_)
        | BattleControl::PartySelect(_)
        | BattleControl::Waiting(_)
        | BattleControl::Complete(_) => None,
    }
}

fn replacement_control_address(
    seat: &er_types::battle_control::SeatBattleControl,
    occurrence: &FaintOccurrenceId,
    source: &FaintSource,
    field_slot: &FieldSlot,
    owner: &SeatId,
) -> Result<ReplacementControlAddress, AuthorityTransactionError> {
    let operation_id = seat.decision_operation_id.clone().ok_or_else(|| {
        AuthorityTransactionError::ControlProjection {
            reason: "replacement tail control has no decision operation".to_owned(),
        }
    })?;
    let field_index = SafeU53::new(u64::from(field_slot.position)).map_err(|source| {
        AuthorityTransactionError::ControlProjection {
            reason: source.to_string(),
        }
    })?;
    Ok(ReplacementControlAddress {
        operation_id,
        owner_seat_id: *owner,
        epoch: source.epoch.get(),
        wave: source.wave.get(),
        turn: source.resolved_turn.get(),
        occurrence: (*occurrence).into(),
        field_index,
    })
}

fn encode_decode_material<T>(material: &T) -> Result<(T, Value), AuthorityTransactionError>
where
    T: Serialize + DeserializeOwned + Clone,
{
    let bytes =
        canonical_bytes(material).map_err(|source| AuthorityTransactionError::MaterialCodec {
            reason: source.to_string(),
        })?;
    let payload: Value = serde_json::from_slice(&bytes).map_err(|source| {
        AuthorityTransactionError::MaterialCodec {
            reason: source.to_string(),
        }
    })?;
    let canonical_again =
        canonical_bytes(&payload).map_err(|source| AuthorityTransactionError::MaterialCodec {
            reason: source.to_string(),
        })?;
    if canonical_again != bytes {
        return Err(AuthorityTransactionError::MaterialCodec {
            reason: "material payload was not canonical after JSON round-trip".to_owned(),
        });
    }
    let decoded: T = serde_json::from_slice(&bytes).map_err(|source| {
        AuthorityTransactionError::MaterialCodec {
            reason: source.to_string(),
        }
    })?;
    let decoded_bytes =
        canonical_bytes(&decoded).map_err(|source| AuthorityTransactionError::MaterialCodec {
            reason: source.to_string(),
        })?;
    if decoded_bytes != bytes {
        return Err(AuthorityTransactionError::MaterialCodec {
            reason: "typed material decoder changed canonical bytes".to_owned(),
        });
    }
    Ok((decoded, payload))
}

fn build_turn_material(
    candidate: &BattleTransition,
    operation_id: &OperationId,
    next_control: &BattleControlPlan,
    menu_allocators: &[SeatMenuInstanceAllocator],
    content: &ContentPack,
) -> Result<BattleTurnMaterialV1, AuthorityTransactionError> {
    let before_battle = candidate.before_state.battle.as_ref().ok_or_else(|| {
        AuthorityTransactionError::ControlProjection {
            reason: "TURN candidate has no before battle".to_owned(),
        }
    })?;
    let after_battle = candidate.after_state.battle.as_ref().ok_or_else(|| {
        AuthorityTransactionError::ControlProjection {
            reason: "TURN candidate has no after battle".to_owned(),
        }
    })?;
    let presentation_digest = presentation_plan_digest(&candidate.presentation)?;
    Ok(BattleTurnMaterialV1 {
        schema_version: TURN_MATERIAL_SCHEMA_VERSION,
        oracle_game_sha: content.oracle_game_sha.clone(),
        content_hash: content.hash.clone(),
        operation_id: operation_id.clone(),
        battle_id: before_battle.battle_id,
        wave: before_battle.wave,
        resolved_turn: before_battle.turn,
        before_digest: candidate.before_digest.clone(),
        after_digest: candidate.after_digest.clone(),
        commands: candidate.accepted_commands.clone(),
        action_order: candidate.action_order.clone(),
        mutations: candidate.mutations.clone(),
        presentation: candidate.presentation.clone(),
        presentation_digest,
        rng_before: before_battle.battle_rng.clone(),
        rng_after: after_battle.battle_rng.clone(),
        rng_audit: candidate.rng_audit.clone(),
        before_state: candidate.before_state.clone(),
        after_state: candidate.after_state.clone(),
        outcome: candidate.outcome,
        next_decision: candidate.next_decision,
        menu_allocators_before: menu_allocators.to_vec(),
        next_control: next_control.clone(),
    })
}

fn build_replacement_material(
    candidate: &BattleReplacementTransition,
    operation_id: &OperationId,
    next_control: &BattleControlPlan,
    menu_allocators: &[SeatMenuInstanceAllocator],
    content: &ContentPack,
) -> Result<BattleReplacementMaterialV1, AuthorityTransactionError> {
    let before_battle = candidate.before_state.battle.as_ref().ok_or_else(|| {
        AuthorityTransactionError::ControlProjection {
            reason: "REPLACEMENT candidate has no before battle".to_owned(),
        }
    })?;
    let presentation_digest = presentation_plan_digest(&candidate.presentation)?;
    Ok(BattleReplacementMaterialV1 {
        schema_version: REPLACEMENT_MATERIAL_SCHEMA_VERSION,
        oracle_game_sha: content.oracle_game_sha.clone(),
        content_hash: content.hash.clone(),
        operation_id: operation_id.clone(),
        battle_id: before_battle.battle_id,
        wave: before_battle.wave,
        resolved_turn: candidate.occurrence.source.resolved_turn,
        occurrence: candidate.occurrence,
        selection: candidate.selection,
        before_digest: candidate.before_digest.clone(),
        after_digest: candidate.after_digest.clone(),
        mutations: candidate.mutations.clone(),
        presentation: candidate.presentation.clone(),
        presentation_digest,
        before_state: candidate.before_state.clone(),
        after_state: candidate.after_state.clone(),
        outcome: candidate.outcome,
        next_decision: candidate.next_decision,
        menu_allocators_before: menu_allocators.to_vec(),
        next_control: next_control.clone(),
    })
}

fn require_turn_equivalence(
    candidate: &BattleTransition,
    material: &BattleTurnMaterialV1,
    applied: &MaterialApplyResult,
) -> Result<(), AuthorityTransactionError> {
    if candidate.after_state != applied.after_state {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "after_state",
        });
    }
    if candidate.after_digest != applied.after_digest
        || material.after_digest != applied.after_digest
    {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "after_digest",
        });
    }
    if candidate.presentation != applied.presentation {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "presentation",
        });
    }
    let expected_presentation_digest =
        presentation_plan_digest(&candidate.presentation).map_err(|_| {
            AuthorityTransactionError::CandidateMismatch {
                field: "presentation_digest",
            }
        })?;
    if expected_presentation_digest != material.presentation_digest
        || expected_presentation_digest != applied.presentation_digest
    {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "presentation_digest",
        });
    }
    if candidate.outcome != applied.outcome {
        return Err(AuthorityTransactionError::CandidateMismatch { field: "outcome" });
    }
    if candidate.next_decision != applied.next_decision {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "next_decision",
        });
    }
    if material.next_control != applied.next_control {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "next_control",
        });
    }
    Ok(())
}

fn require_replacement_equivalence(
    candidate: &BattleReplacementTransition,
    material: &BattleReplacementMaterialV1,
    applied: &MaterialApplyResult,
) -> Result<(), AuthorityTransactionError> {
    if candidate.after_state != applied.after_state {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "after_state",
        });
    }
    if candidate.after_digest != applied.after_digest
        || material.after_digest != applied.after_digest
    {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "after_digest",
        });
    }
    if candidate.presentation != applied.presentation {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "presentation",
        });
    }
    let expected_presentation_digest =
        presentation_plan_digest(&candidate.presentation).map_err(|_| {
            AuthorityTransactionError::CandidateMismatch {
                field: "presentation_digest",
            }
        })?;
    if expected_presentation_digest != material.presentation_digest
        || expected_presentation_digest != applied.presentation_digest
    {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "presentation_digest",
        });
    }
    if candidate.outcome != applied.outcome {
        return Err(AuthorityTransactionError::CandidateMismatch { field: "outcome" });
    }
    if candidate.next_decision != applied.next_decision {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "next_decision",
        });
    }
    if material.next_control != applied.next_control {
        return Err(AuthorityTransactionError::CandidateMismatch {
            field: "next_control",
        });
    }
    Ok(())
}

fn validate_internal_replacement_control(
    control: &BattleControlPlan,
    stored: &er_types::battle_model::FaintOccurrence,
    operation_id: &OperationId,
) -> Result<(), AuthorityTransactionError> {
    control.validate().map_err(|source| {
        AuthorityTransactionError::Admission(AuthorityCommandError::ControlPlan(source))
    })?;
    let owner = stored
        .owner_seat
        .ok_or_else(|| AuthorityTransactionError::ControlProjection {
            reason: "internal replacement occurrence has no player owner".to_owned(),
        })?;
    let seat = control
        .seat(owner)
        .ok_or_else(|| AuthorityTransactionError::ControlProjection {
            reason: "internal replacement owner has no control entry".to_owned(),
        })?;
    if seat.decision_operation_id.as_ref() != Some(operation_id) {
        return Err(AuthorityTransactionError::ControlProjection {
            reason: "internal replacement control operation is stale".to_owned(),
        });
    }
    let matches_stored = match &seat.control {
        er_types::battle_control::BattleControl::ReplacementSelect(value) => {
            value.occurrence == stored.id
                && value.source == stored.source
                && value.actor == stored.pokemon
                && value.field_slot == stored.slot
                && value.owner_seat == owner
        }
        er_types::battle_control::BattleControl::PartyOptionSelect(value) => {
            match value.cancel_to.as_ref() {
                er_types::battle_control::BattleControl::ReplacementSelect(parent) => {
                    matches_stored_replacement_control(
                        parent.occurrence,
                        parent.source,
                        parent.actor,
                        parent.field_slot,
                        parent.owner_seat,
                        stored,
                        owner,
                    ) && value.field_slot == stored.slot
                }
                _ => false,
            }
        }
        _ => false,
    };
    if !matches_stored {
        return Err(AuthorityTransactionError::ControlProjection {
            reason: "internal replacement control is not bound to the stored occurrence".to_owned(),
        });
    }
    Ok(())
}

fn matches_stored_replacement_control(
    occurrence: FaintOccurrenceId,
    source: er_types::battle_model::FaintSource,
    actor: er_types::battle_ids::PokemonId,
    field_slot: er_types::battle_ids::FieldSlot,
    owner_seat: SeatId,
    stored: &er_types::battle_model::FaintOccurrence,
    owner: SeatId,
) -> bool {
    occurrence == stored.id
        && source == stored.source
        && actor == stored.pokemon
        && field_slot == stored.slot
        && owner_seat == owner
}

/// Compute the frozen presentation-plan digest at the adapter boundary.  The
/// typed event already carries blocking/skip policy, so the ordered event
/// vector is the complete plan evidence.  Keeping this helper here avoids a
/// second renderer-facing digest implementation while the game material
/// codec/applier remains the integration seam.
fn presentation_plan_digest(
    presentation: &[BattlePresentationEvent],
) -> Result<PresentationPlanDigest, AuthorityTransactionError> {
    #[derive(Serialize)]
    struct PresentationDigestPreimage<'a> {
        domain: &'static str,
        events: &'a [BattlePresentationEvent],
    }

    const DOMAIN: &str = "pokerogue-redux/m3/presentation-plan/v1";
    let raw = content_digest(&PresentationDigestPreimage {
        domain: DOMAIN,
        events: presentation,
    })
    .map_err(|source| AuthorityTransactionError::MaterialCodec {
        reason: source.to_string(),
    })?;
    PresentationPlanDigest::new(format!("blake3-v1:{raw}")).map_err(|source| {
        AuthorityTransactionError::MaterialCodec {
            reason: source.to_string(),
        }
    })
}

fn advance_allocators_for_proposals(
    current: &[SeatMenuInstanceAllocator],
    proposals: &[BattleCommandProposalV1],
) -> Result<Vec<SeatMenuInstanceAllocator>, AuthorityTransactionError> {
    let mut next = current.to_vec();
    next.sort_by_key(|allocator| allocator.seat);
    for proposal in proposals {
        advance_one_allocator(&mut next, proposal.owner_seat, proposal.menu_instance_id)?;
    }
    Ok(next)
}

fn advance_allocators_for_replacement_proposals(
    current: &[SeatMenuInstanceAllocator],
    proposals: &[BattleReplacementProposalV1],
) -> Result<Vec<SeatMenuInstanceAllocator>, AuthorityTransactionError> {
    let mut next = current.to_vec();
    next.sort_by_key(|allocator| allocator.seat);
    for proposal in proposals {
        advance_one_allocator(&mut next, proposal.owner_seat, proposal.menu_instance_id)?;
    }
    Ok(next)
}

fn advance_one_allocator(
    allocators: &mut [SeatMenuInstanceAllocator],
    seat: SeatId,
    consumed: MenuInstanceId,
) -> Result<(), AuthorityTransactionError> {
    let allocator = allocators
        .iter_mut()
        .find(|allocator| allocator.seat == seat)
        .ok_or_else(|| AuthorityTransactionError::ControlProjection {
            reason: "proposal owner has no menu allocator".to_owned(),
        })?;
    let required = consumed
        .get()
        .get()
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or_else(|| AuthorityTransactionError::ControlProjection {
            reason: "menu allocator exhausted".to_owned(),
        })?;
    if required > allocator.next_menu_instance_id.get() {
        allocator.next_menu_instance_id = er_types::battle_ids::MenuInstanceId::new(required);
    }
    Ok(())
}

fn turn_material_digest(payload: &Value) -> Result<String, AuthorityTransactionError> {
    let canonical =
        canonicalize(payload).map_err(|source| AuthorityTransactionError::MaterialDigest {
            reason: source.to_string(),
        })?;
    Ok(format!("{:016x}", fnv1a64_utf16(&canonical)))
}

fn replacement_material_digest(payload: &Value) -> Result<String, AuthorityTransactionError> {
    let canonical =
        canonicalize(payload).map_err(|source| AuthorityTransactionError::MaterialDigest {
            reason: source.to_string(),
        })?;
    Ok(format!(
        "rc1-{}-{:08x}",
        canonical.encode_utf16().count(),
        fnv1a32_utf16(&canonical)
    ))
}

fn fnv1a64_utf16(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for unit in value.encode_utf16() {
        hash ^= u64::from(unit);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn fnv1a32_utf16(value: &str) -> u32 {
    let mut hash = 0x811c9dc5_u32;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}
