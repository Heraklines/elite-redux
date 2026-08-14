//! Authority-relative command and replacement admission for M3 Battle mode.
//!
//! This module is deliberately a pure game boundary.  It validates a typed
//! proposal against the exact command/replacement window and the immutable
//! menu graph, then returns a cloned state or a typed admission result
//! for the caller to stage.  It never owns an Authority V2 entry, a delivery
//! lease, a resolver call, or an external effect.

use std::collections::BTreeMap;

use er_battle::legality::{
    CommandLegalityError, normalize_command_set_trusted, validate_command_proposal_trusted,
    validate_preserved_offer_trusted, validate_replacement_proposal_trusted,
    validate_replacement_selection_trusted, validate_state_content, validate_state_content_trusted,
};
use er_battle::{BattleReplacementTransition, BattleTransition};
use er_content::pack::ContentPack;
use er_state::battle::BattleState;
use er_state::format::{FormatTopologyError, owner_seat_for};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandError, BattleCommandFingerprint,
    BattleCommandProposalV1, BattleReplacementProposalFingerprint, BattleReplacementProposalV1,
    BattleTargetSelection, CommandAdmissionSource, CommandFrontierStatus, CommandSet,
    ReplacementProposalFingerprintEntry, ReplacementSelection, ScriptedEnemyPolicyV1,
};
use er_types::battle_control::{
    BattleControl, BattleControlPlan, BattleControlPlanError, BattleMenu, SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{BattleSide, FaintOccurrenceId, FieldSlot, MenuInstanceId, PokemonId};
use er_types::{MenuOptionId, OperationId, SafeU53, SeatId};
use thiserror::Error;

use crate::internal_event::{AuthorityLocalTurnProof, TurnDigestEvidence};

#[derive(Clone, Copy)]
enum ContentValidationMode {
    Full,
    Trusted,
}

fn validate_transaction_content(
    state: &GameState,
    content: &ContentPack,
    mode: ContentValidationMode,
) -> Result<(), AuthorityCommandError> {
    match mode {
        ContentValidationMode::Full => validate_state_content(state, content),
        ContentValidationMode::Trusted => validate_state_content_trusted(state, content),
    }
    .map_err(legality)
}

/// The source of a human proposal is derived from the authority-relative
/// owner seat.  The authority's own proposal still enters this same reducer;
/// this enum exists only as an auditable result value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HumanAdmissionSource {
    AuthorityLocalInternal,
    AuthorityRemoteProposal,
}

impl HumanAdmissionSource {
    const fn as_command_source(self) -> CommandAdmissionSource {
        match self {
            Self::AuthorityLocalInternal => CommandAdmissionSource::AuthorityLocalInternal,
            Self::AuthorityRemoteProposal => CommandAdmissionSource::AuthorityRemoteProposal,
        }
    }
}

/// Fail-closed errors at the game-owned authority admission boundary.
#[derive(Debug, Error)]
pub enum AuthorityCommandError {
    #[error("authority admission state/content validation failed: {0}")]
    Legality(#[source] CommandLegalityError),
    #[error("typed command or replacement proposal is invalid: {0}")]
    Command(#[from] BattleCommandError),
    #[error("authority control plan is invalid: {0}")]
    ControlPlan(#[source] BattleControlPlanError),
    #[error("battle format topology is invalid: {0}")]
    Topology(#[source] FormatTopologyError),
    #[error("battle control plan coordinates do not match the active battle")]
    ControlCoordinatesMismatch,
    #[error("seat {seat} has no control entry in the authority plan")]
    MissingSeatControl { seat: SeatId },
    #[error("seat {seat} is not currently actionable")]
    ControlNotActionable { seat: SeatId },
    #[error("decision operation does not match the current control")]
    DecisionOperationMismatch,
    #[error("proposal owner seat is not the fixed owner of its field slot")]
    OwnerSeatMismatch { expected: SeatId, actual: SeatId },
    #[error("proposal menu instance does not match the current menu")]
    MenuInstanceMismatch {
        expected: MenuInstanceId,
        actual: MenuInstanceId,
    },
    #[error("proposal control_id does not match the current menu")]
    ControlIdMismatch { expected: String, actual: String },
    #[error("proposal command does not match the active typed menu control: {reason}")]
    CommandControlMismatch { reason: &'static str },
    #[error("proposal replacement does not match the active typed menu control: {reason}")]
    ReplacementControlMismatch { reason: &'static str },
    #[error("proposal operation {operation_id} is not in the current command frontier")]
    MissingCommandFrontier { operation_id: OperationId },
    #[error("proposal operation {operation_id} conflicts with an existing fingerprint")]
    ProposalConflict { operation_id: OperationId },
    #[error("the scripted enemy policy is invalid: {0}")]
    ScriptedPolicy(#[source] BattleCommandError),
    #[error("the scripted enemy policy has no command at cursor {cursor}")]
    ScriptCursorExhausted { cursor: SafeU53 },
    #[error("the projected command frontier contains a scripted enemy entry that is not admitted")]
    ScriptedProjectionNotAdmitted,
    #[error("the projected scripted policy did not advance exactly once per stored enemy entry")]
    ScriptPolicyAdvanceMismatch,
    #[error(
        "script cursor {cursor} names slot {actual:?}, but the command frontier has no pending enemy slot"
    )]
    ScriptCommandMismatch { cursor: SafeU53, actual: FieldSlot },
    #[error("scripted enemy command coordinates do not match the active battle frontier")]
    ScriptCommandStale,
    #[error("the command frontier contains an invalid preserved offer: {0}")]
    PreservedOffer(#[source] CommandLegalityError),
    #[error("the command frontier is empty or does not contain a complete living actor set")]
    EmptyOrInvalidFrontier,
    #[error("GameRuntime replacement fingerprint evidence is invalid: {reason}")]
    InvalidReplacementFingerprintEvidence { reason: &'static str },
    #[error("replacement occurrence {occurrence} is not the stored current replacement head")]
    ReplacementHeadMismatch { occurrence: FaintOccurrenceId },
    #[error("no-legal-replacement is an internal decision and cannot be admitted as a proposal")]
    ExternalNoLegalReplacement,
    #[error("menu option {option_id} is not visible and enabled in the current menu")]
    MenuOptionUnavailable { option_id: String },
    #[error("menu option identity could not be constructed")]
    MenuOptionIdentity,
    #[error("command tombstone conflicts with a live or different fingerprint")]
    TombstoneConflict,
    #[error("remote proposal has no GameRuntime-produced immutable menu replay")]
    MissingRemoteMenuReplay,
    #[error("remote menu replay is not rooted at the authority-installed control")]
    MenuReplayRootMismatch,
    #[error("remote menu replay does not match the typed proposal path")]
    MenuReplayIdentityMismatch,
    #[error("prepared authority admission allocator does not match the staged authority allocator")]
    AdmissionAllocatorMismatch,
}

fn legality(error: CommandLegalityError) -> AuthorityCommandError {
    AuthorityCommandError::Legality(error)
}

/// Result of admitting one human command proposal into the cloned game state.
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum CommandAdmissionResult {
    Admitted {
        state: GameState,
        command: AcceptedBattleCommand,
        source: HumanAdmissionSource,
    },
    /// An exact duplicate is an idempotent observation.  It never reopens a
    /// menu, allocates a menu ID, consumes PP/RNG, or changes state.
    Duplicate {
        operation_id: OperationId,
        fingerprint: BattleCommandFingerprint,
    },
}

/// Result of deterministic scripted-enemy collection.  The policy is copied
/// and advanced only for commands actually admitted into the returned state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScriptedEnemyAdmission {
    pub state: GameState,
    pub policy: ScriptedEnemyPolicyV1,
    pub admitted: Vec<AcceptedBattleCommand>,
}

/// The immutable leaf control replayed by the one `er-game` menu builders for
/// a remote proposal.  Its fields are intentionally private: only
/// `GameRuntime` can construct the bundle, while the authority reducer can
/// inspect the typed result and validate it against the installed root.
#[derive(Clone, Debug)]
pub struct PreparedAuthorityMenuPath {
    operation_id: OperationId,
    control: BattleControl,
}

impl PreparedAuthorityMenuPath {
    /// Construct a builder result for the internal GameRuntime seam.  This is
    /// not a public semantic command/control injection point; the enclosing
    /// authority request remains kernel-private and validates the path again.
    pub(crate) fn from_game_runtime(operation_id: OperationId, control: BattleControl) -> Self {
        Self {
            operation_id,
            control,
        }
    }
}

/// Typed admission context produced by `GameRuntime` after replaying remote
/// menu navigation from the authority-installed root.  Local navigation is
/// already present in the installed local control plan and therefore needs no
/// replay entry.  `allocator_before` is the canonical menu-allocator vector
/// *after every proposal in this admission batch has been admitted*.  The
/// adapter passes that exact vector as material `menu_allocators_before` and
/// rejects a bundle prepared from a lagging runtime snapshot.
#[derive(Clone, Debug)]
pub struct PreparedAuthorityAdmission {
    pub(crate) allocator_before: Vec<SeatMenuInstanceAllocator>,
    pub(crate) remote_paths: BTreeMap<OperationId, PreparedAuthorityMenuPath>,
}

impl PreparedAuthorityAdmission {
    pub(crate) fn from_game_runtime(
        allocator_before: Vec<SeatMenuInstanceAllocator>,
        remote_paths: BTreeMap<OperationId, PreparedAuthorityMenuPath>,
    ) -> Self {
        Self {
            allocator_before,
            remote_paths,
        }
    }

    pub fn allocator_before(&self) -> &[SeatMenuInstanceAllocator] {
        &self.allocator_before
    }
}

/// Read-only replacement-operation fingerprint evidence prepared by
/// `GameRuntime`.  Its private storage prevents the kernel adapter from
/// becoming a second mutable fingerprint owner; the runtime remains the only
/// code that records a newly accepted replacement operation.  The enclosing
/// cloned runtime must append an admitted proposal's fingerprint to its own
/// state before the same atomic swap that installs the material result.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedReplacementFingerprintEvidence {
    entries: Vec<ReplacementProposalFingerprintEntry>,
}

impl PreparedReplacementFingerprintEvidence {
    pub(crate) fn from_game_runtime(
        entries: Vec<ReplacementProposalFingerprintEntry>,
    ) -> Result<Self, AuthorityCommandError> {
        validate_replacement_fingerprint_evidence(&entries)?;
        Ok(Self { entries })
    }

    pub fn entries(&self) -> &[ReplacementProposalFingerprintEntry] {
        &self.entries
    }
}

/// The closed authority hand-off from `GameRuntime` to the kernel adapter.
///
/// `GameRuntime` constructs this value only after the authority-side resolver
/// candidate has been projected through the one game-owned control projector.
/// The projected transition therefore carries the next command collection in
/// `after_state` when its decision is `CommandFrontier`; the kernel adapter
/// never accepts a loose control plan or a protocol `NextControl` value.
#[doc(hidden)]
#[derive(Clone, Debug)]
pub struct PreparedAuthorityTurn {
    digest_evidence: TurnDigestEvidence,
    control_plan: BattleControlPlan,
    admission: PreparedAuthorityAdmission,
}

impl PreparedAuthorityTurn {
    pub(crate) fn from_game_runtime(
        digest_evidence: TurnDigestEvidence,
        control_plan: BattleControlPlan,
        admission: PreparedAuthorityAdmission,
    ) -> Self {
        Self {
            digest_evidence,
            control_plan,
            admission,
        }
    }

    #[doc(hidden)]
    pub fn transition(&self) -> &BattleTransition {
        self.digest_evidence.transition()
    }

    #[doc(hidden)]
    pub fn control_plan(&self) -> &BattleControlPlan {
        &self.control_plan
    }

    #[doc(hidden)]
    pub fn admission(&self) -> &PreparedAuthorityAdmission {
        &self.admission
    }

    pub(crate) fn digest_evidence(&self) -> &TurnDigestEvidence {
        &self.digest_evidence
    }

    /// Bind the already-prepared resolver/control evidence into the opaque
    /// authority-local proof consumed by the material binder.  The material
    /// module calls this only after canonical decoded fields have been
    /// compared; no proof constructor is available to er-kernel callers.
    pub(crate) fn bind_authority_local_turn<'a>(
        &'a self,
        menu_allocators_before: &'a [SeatMenuInstanceAllocator],
        material_operation_id: &'a OperationId,
    ) -> AuthorityLocalTurnProof<'a> {
        self.digest_evidence().bind_authority_local_turn(
            &self.control_plan,
            menu_allocators_before,
            material_operation_id,
        )
    }
}

/// The replacement counterpart to [`PreparedAuthorityTurn`].
///
/// The transition is already projected by the same game-owned surface as a
/// TURN transition.  In particular, a replacement that returns to command
/// collection must carry the actionable next `CommandCollectionState` rather
/// than an empty resolver boundary state.
#[derive(Clone, Debug)]
pub struct PreparedAuthorityReplacement {
    pub transition: BattleReplacementTransition,
    pub control_plan: BattleControlPlan,
    pub admission: PreparedAuthorityAdmission,
    /// Read-only evidence copied from GameRuntime's one replacement
    /// fingerprint store.  The adapter validates it but never appends to or
    /// returns replacement fingerprint evidence; GameRuntime owns that commit.
    pub replacement_fingerprints: PreparedReplacementFingerprintEvidence,
}

/// Result of checking whether the exact command frontier is ready to resolve.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandFrontierCompletion {
    Incomplete {
        state: GameState,
    },
    Complete {
        state: GameState,
        commands: CommandSet,
    },
}

impl CommandFrontierCompletion {
    pub const fn is_complete(&self) -> bool {
        matches!(self, Self::Complete { .. })
    }

    pub fn state(&self) -> &GameState {
        match self {
            Self::Incomplete { state } | Self::Complete { state, .. } => state,
        }
    }

    pub fn commands(&self) -> Option<&CommandSet> {
        match self {
            Self::Incomplete { .. } => None,
            Self::Complete { commands, .. } => Some(commands),
        }
    }
}

/// Opaque proof that an admitted command frontier passed the trusted legality
/// boundary without requiring a cloned game state.
#[doc(hidden)]
#[derive(Debug)]
pub struct ValidatedAdmittedCommandFrontier<'a> {
    state: &'a GameState,
    commands: CommandSet,
}

impl<'a> ValidatedAdmittedCommandFrontier<'a> {
    /// Consume the proof and return the validated state and canonical commands.
    #[doc(hidden)]
    pub fn into_parts(self) -> (&'a GameState, CommandSet) {
        (self.state, self.commands)
    }
}

/// Result of admitting one external replacement proposal.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReplacementAdmissionResult {
    Admitted {
        proposal: BattleReplacementProposalV1,
    },
    Duplicate {
        operation_id: OperationId,
        fingerprint: BattleReplacementProposalFingerprint,
    },
}

/// Validate the immutable replacement-fingerprint evidence supplied by
/// `GameRuntime`.  The returned evidence is never mutated here; the runtime
/// remains the sole owner that records a newly admitted operation.
fn validate_replacement_fingerprint_evidence(
    evidence: &[ReplacementProposalFingerprintEntry],
) -> Result<(), AuthorityCommandError> {
    for pair in evidence.windows(2) {
        if pair[0].operation_id >= pair[1].operation_id {
            return Err(
                AuthorityCommandError::InvalidReplacementFingerprintEvidence {
                    reason: "entries must be unique and sorted by operation identity",
                },
            );
        }
    }
    for entry in evidence {
        entry.validate()?;
    }
    Ok(())
}

/// The only result produced for the internal automatic no-candidate path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InternalNoLegalReplacement {
    pub occurrence: FaintOccurrenceId,
    pub selection: ReplacementSelection,
}

/// Admit a human command proposal against the exact current control and offer.
///
/// The authority-local and authority-remote paths intentionally share this
/// function.  The source is derived from the fixed authority seat; no caller
/// can relabel a partner proposal as local or introduce a second reducer.
pub fn admit_command_proposal(
    state: &GameState,
    control: &BattleControlPlan,
    proposal: &BattleCommandProposalV1,
    content: &ContentPack,
) -> Result<CommandAdmissionResult, AuthorityCommandError> {
    admit_command_proposal_with_context(state, control, None, proposal, content)
}

/// Admit a command with the GameRuntime menu-replay context used by the
/// authority transaction.  The installed plan is still the source of the
/// authority/root identity; only a non-authority seat may use a prepared leaf
/// replay.  Local and remote proposals then pass through the same reducer.
pub fn admit_command_proposal_with_context(
    state: &GameState,
    control: &BattleControlPlan,
    prepared: Option<&PreparedAuthorityAdmission>,
    proposal: &BattleCommandProposalV1,
    content: &ContentPack,
) -> Result<CommandAdmissionResult, AuthorityCommandError> {
    admit_command_proposal_with_context_inner(
        state,
        control,
        prepared,
        proposal,
        content,
        ContentValidationMode::Full,
    )
}

/// Admit a command inside an enclosing transaction whose immutable content
/// pack was validated at construction or restore.
#[doc(hidden)]
pub fn admit_command_proposal_with_context_trusted(
    state: &GameState,
    control: &BattleControlPlan,
    prepared: Option<&PreparedAuthorityAdmission>,
    proposal: &BattleCommandProposalV1,
    content: &ContentPack,
) -> Result<CommandAdmissionResult, AuthorityCommandError> {
    admit_command_proposal_with_context_inner(
        state,
        control,
        prepared,
        proposal,
        content,
        ContentValidationMode::Trusted,
    )
}

fn admit_command_proposal_with_context_inner(
    state: &GameState,
    control: &BattleControlPlan,
    prepared: Option<&PreparedAuthorityAdmission>,
    proposal: &BattleCommandProposalV1,
    content: &ContentPack,
    validation: ContentValidationMode,
) -> Result<CommandAdmissionResult, AuthorityCommandError> {
    proposal.validate()?;
    let accepted = AcceptedBattleCommand::human(proposal.clone());
    let fingerprint = proposal.fingerprint();
    let battle = active_battle(state)?;

    // Duplicate/conflict identity is checked before local menu lookup.  A
    // resent proposal remains idempotent after the authority has advanced to
    // another menu or cleared the live frontier into a tombstone.
    if let Some(existing) = battle
        .command_state
        .frontier
        .iter()
        .find(|entry| entry.operation_id == proposal.operation_id)
    {
        return match &existing.status {
            CommandFrontierStatus::Pending => admit_new_command(
                state,
                control,
                prepared,
                proposal,
                accepted,
                content,
                battle.authority_seat,
                validation,
            ),
            CommandFrontierStatus::Retained { command, .. }
            | CommandFrontierStatus::Admitted { command, .. } => {
                if command.fingerprint() == &fingerprint {
                    Ok(CommandAdmissionResult::Duplicate {
                        operation_id: proposal.operation_id.clone(),
                        fingerprint,
                    })
                } else {
                    Err(AuthorityCommandError::ProposalConflict {
                        operation_id: proposal.operation_id.clone(),
                    })
                }
            }
        };
    }

    if let Some(tombstone) = battle
        .command_state
        .tombstones
        .iter()
        .find(|entry| entry.operation_id == proposal.operation_id)
    {
        if tombstone.fingerprint == fingerprint {
            return Ok(CommandAdmissionResult::Duplicate {
                operation_id: proposal.operation_id.clone(),
                fingerprint,
            });
        }
        return Err(AuthorityCommandError::ProposalConflict {
            operation_id: proposal.operation_id.clone(),
        });
    }

    Err(AuthorityCommandError::MissingCommandFrontier {
        operation_id: proposal.operation_id.clone(),
    })
}

#[allow(clippy::too_many_arguments)]
fn admit_new_command(
    state: &GameState,
    control: &BattleControlPlan,
    prepared: Option<&PreparedAuthorityAdmission>,
    proposal: &BattleCommandProposalV1,
    accepted: AcceptedBattleCommand,
    content: &ContentPack,
    authority_seat: SeatId,
    validation: ContentValidationMode,
) -> Result<CommandAdmissionResult, AuthorityCommandError> {
    validate_transaction_content(state, content, validation)?;
    let battle = active_battle(state)?;
    validate_command_control_plan(control, battle)?;

    let expected_owner = owner_seat_for(&battle.format, proposal.field_slot)
        .map_err(AuthorityCommandError::Topology)?
        .ok_or(AuthorityCommandError::CommandControlMismatch {
            reason: "a human proposal must address a player field slot",
        })?;
    if expected_owner != proposal.owner_seat {
        return Err(AuthorityCommandError::OwnerSeatMismatch {
            expected: expected_owner,
            actual: proposal.owner_seat,
        });
    }

    let source = if proposal.owner_seat == authority_seat {
        HumanAdmissionSource::AuthorityLocalInternal
    } else {
        HumanAdmissionSource::AuthorityRemoteProposal
    };
    validate_command_control(control, prepared, authority_seat, proposal)?;
    validate_command_proposal_trusted(state, proposal, content).map_err(legality)?;

    let mut next = state.clone();
    let next_battle = next
        .battle
        .as_mut()
        .ok_or(AuthorityCommandError::ControlCoordinatesMismatch)?;
    let Some(entry) = next_battle
        .command_state
        .frontier
        .iter_mut()
        .find(|entry| entry.operation_id == proposal.operation_id)
    else {
        return Err(AuthorityCommandError::MissingCommandFrontier {
            operation_id: proposal.operation_id.clone(),
        });
    };
    if !matches!(&entry.status, CommandFrontierStatus::Pending) {
        return Err(AuthorityCommandError::ProposalConflict {
            operation_id: proposal.operation_id.clone(),
        });
    }
    entry.status = CommandFrontierStatus::Retained {
        command: accepted.clone(),
        source: source.as_command_source(),
    };
    next_battle.command_state.validate()?;
    validate_state_content_trusted(&next, content).map_err(legality)?;

    Ok(CommandAdmissionResult::Admitted {
        state: next,
        command: accepted,
        source,
    })
}

/// Collect all currently pending scripted-enemy entries from the typed policy.
///
/// The cursor is authoritative for script order.  A command whose cursor,
/// operation, actor, slot, or typed command differs from the pending frontier
/// fails closed; no AI callback, fallback move, or resolver call is possible.
pub fn admit_scripted_enemy_frontier(
    state: &GameState,
    policy: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<ScriptedEnemyAdmission, AuthorityCommandError> {
    admit_scripted_enemy_frontier_inner(state, policy, content, ContentValidationMode::Full)
}

/// Admit scripted commands inside an enclosing transaction whose immutable
/// content pack was validated at construction or restore.
#[doc(hidden)]
pub fn admit_scripted_enemy_frontier_trusted(
    state: &GameState,
    policy: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<ScriptedEnemyAdmission, AuthorityCommandError> {
    admit_scripted_enemy_frontier_inner(state, policy, content, ContentValidationMode::Trusted)
}

fn admit_scripted_enemy_frontier_inner(
    state: &GameState,
    policy: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
    validation: ContentValidationMode,
) -> Result<ScriptedEnemyAdmission, AuthorityCommandError> {
    policy
        .validate()
        .map_err(AuthorityCommandError::ScriptedPolicy)?;
    validate_transaction_content(state, content, validation)?;

    let mut next_state = state.clone();
    let mut next_policy = policy.clone();
    let mut admitted = Vec::new();

    loop {
        let pending_slot = {
            let battle = active_battle(&next_state)?;
            battle
                .command_state
                .frontier
                .iter()
                .find(|entry| {
                    entry.field_slot.side == BattleSide::Enemy
                        && matches!(&entry.status, CommandFrontierStatus::Pending)
                })
                .map(|entry| entry.field_slot)
        };
        let Some(pending_slot) = pending_slot else {
            break;
        };

        let Some(scripted) = next_policy.next_command().cloned() else {
            return Err(AuthorityCommandError::ScriptCursorExhausted {
                cursor: next_policy.cursor,
            });
        };
        if scripted.field_slot != pending_slot {
            return Err(AuthorityCommandError::ScriptCommandMismatch {
                cursor: next_policy.cursor,
                actual: scripted.field_slot,
            });
        }

        let battle = active_battle(&next_state)?;
        if scripted.battle_id != battle.battle_id
            || scripted.wave != battle.wave
            || scripted.turn != battle.turn
            || scripted.script_cursor != next_policy.cursor
        {
            return Err(AuthorityCommandError::ScriptCommandStale);
        }
        let entry = battle
            .command_state
            .frontier
            .iter()
            .find(|entry| entry.field_slot == scripted.field_slot)
            .ok_or(AuthorityCommandError::ScriptCommandStale)?;
        if entry.actor != scripted.actor || entry.operation_id != scripted.operation_id {
            return Err(AuthorityCommandError::ScriptCommandStale);
        }
        validate_preserved_offer_trusted(&next_state, entry, content)
            .map_err(AuthorityCommandError::PreservedOffer)?;

        let accepted = AcceptedBattleCommand::scripted_enemy(scripted.clone());
        let next_battle = next_state
            .battle
            .as_mut()
            .ok_or(AuthorityCommandError::ScriptCommandStale)?;
        let entry = next_battle
            .command_state
            .frontier
            .iter_mut()
            .find(|entry| entry.field_slot == scripted.field_slot)
            .ok_or(AuthorityCommandError::ScriptCommandStale)?;
        entry.status = CommandFrontierStatus::Retained {
            command: accepted.clone(),
            source: CommandAdmissionSource::ScriptedEnemy,
        };
        next_battle.command_state.validate()?;
        admitted.push(accepted);

        let next_cursor = next_policy
            .cursor
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or(AuthorityCommandError::ScriptCommandStale)?;
        next_policy.cursor = next_cursor;
    }

    next_policy
        .validate()
        .map_err(AuthorityCommandError::ScriptedPolicy)?;
    validate_state_content_trusted(&next_state, content).map_err(legality)?;
    Ok(ScriptedEnemyAdmission {
        state: next_state,
        policy: next_policy,
        admitted,
    })
}

/// Project the policy cursor for a material-installed command frontier.  This
/// is the one role-neutral helper used by both authority and replica
/// `GameRuntime` material-install paths.  It advances a clone exactly once
/// for enemy entries already stored as `Admitted`; it never mutates or
/// publishes the caller's policy.
///
/// This is deliberately separate from [`admit_scripted_enemy_frontier`].  A
/// runtime projector may already have stored the next enemy entries as
/// admitted while preparing a resolver transition; running the admission
/// reducer over them again would consume the script cursor twice.  The helper
/// therefore observes the prepared frontier, checks every typed command and
/// preserved offer, and returns the one expected cursor advance.  The common
/// `GameRuntime` material-install method must call this helper once for both
/// authority and replica, then commit the returned policy cursor together
/// with the common applied material state.  The authority adapter uses it only
/// as validation and never assigns or publishes that cursor.
pub fn project_scripted_policy_for_material(
    state: &GameState,
    policy_before: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<ScriptedEnemyPolicyV1, AuthorityCommandError> {
    project_scripted_policy_for_material_inner(
        state,
        policy_before,
        content,
        ContentValidationMode::Full,
    )
}

/// Project the scripted cursor inside an enclosing transaction whose
/// immutable content pack was validated at construction or restore.
#[doc(hidden)]
pub fn project_scripted_policy_for_material_trusted(
    state: &GameState,
    policy_before: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<ScriptedEnemyPolicyV1, AuthorityCommandError> {
    project_scripted_policy_for_material_inner(
        state,
        policy_before,
        content,
        ContentValidationMode::Trusted,
    )
}

fn project_scripted_policy_for_material_inner(
    state: &GameState,
    policy_before: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
    validation: ContentValidationMode,
) -> Result<ScriptedEnemyPolicyV1, AuthorityCommandError> {
    policy_before
        .validate()
        .map_err(AuthorityCommandError::ScriptedPolicy)?;
    validate_transaction_content(state, content, validation)?;

    let battle = active_battle(state)?;
    let mut expected_policy = policy_before.clone();
    for entry in &battle.command_state.frontier {
        if entry.field_slot.side != BattleSide::Enemy {
            continue;
        }
        let CommandFrontierStatus::Admitted {
            command:
                AcceptedBattleCommand::ScriptedEnemy {
                    command: admitted, ..
                },
            source: CommandAdmissionSource::ScriptedEnemy,
        } = &entry.status
        else {
            return Err(AuthorityCommandError::ScriptedProjectionNotAdmitted);
        };
        let scripted = expected_policy.next_command().cloned().ok_or(
            AuthorityCommandError::ScriptCursorExhausted {
                cursor: expected_policy.cursor,
            },
        )?;
        if scripted.field_slot != entry.field_slot
            || scripted.actor != entry.actor
            || scripted.operation_id != entry.operation_id
            || scripted != *admitted
        {
            return Err(AuthorityCommandError::ScriptCommandStale);
        }
        validate_preserved_offer_trusted(state, entry, content)
            .map_err(AuthorityCommandError::PreservedOffer)?;
        let next_cursor = expected_policy
            .cursor
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or(AuthorityCommandError::ScriptCommandStale)?;
        expected_policy.cursor = next_cursor;
    }

    expected_policy
        .validate()
        .map_err(AuthorityCommandError::ScriptedPolicy)?;
    Ok(expected_policy)
}

/// Validate an already prepared policy projection without committing it.
/// `GameRuntime` calls [`project_scripted_policy_for_material`] once at the
/// common material-install boundary and owns the resulting cursor swap.
pub fn validate_projected_scripted_frontier(
    state: &GameState,
    policy_before: &ScriptedEnemyPolicyV1,
    policy_after: &ScriptedEnemyPolicyV1,
    content: &ContentPack,
) -> Result<(), AuthorityCommandError> {
    let expected = project_scripted_policy_for_material(state, policy_before, content)?;
    if expected != *policy_after {
        return Err(AuthorityCommandError::ScriptPolicyAdvanceMismatch);
    }
    Ok(())
}

/// Promote retained proposals only when the complete frontier is present.
/// Every admitted command and preserved offer is revalidated immediately
/// before the result is handed to the resolver adapter.
pub fn complete_command_frontier(
    state: &GameState,
    content: &ContentPack,
) -> Result<CommandFrontierCompletion, AuthorityCommandError> {
    complete_command_frontier_inner(state, content, ContentValidationMode::Full)
}

/// Complete a command frontier inside an enclosing transaction whose
/// immutable content pack was validated at construction or restore.
#[doc(hidden)]
pub fn complete_command_frontier_trusted(
    state: &GameState,
    content: &ContentPack,
) -> Result<CommandFrontierCompletion, AuthorityCommandError> {
    complete_command_frontier_inner(state, content, ContentValidationMode::Trusted)
}

/// Validate an already admitted frontier inside a trusted transaction.
#[doc(hidden)]
pub fn validate_admitted_command_frontier_trusted<'a>(
    state: &'a GameState,
    content: &ContentPack,
) -> Result<Option<ValidatedAdmittedCommandFrontier<'a>>, AuthorityCommandError> {
    validate_transaction_content(state, content, ContentValidationMode::Trusted)?;
    let battle = active_battle(state)?;
    if battle.command_state.frontier.is_empty() {
        return Err(AuthorityCommandError::EmptyOrInvalidFrontier);
    }
    for entry in &battle.command_state.frontier {
        validate_preserved_offer_trusted(state, entry, content)
            .map_err(AuthorityCommandError::PreservedOffer)?;
    }
    if battle
        .command_state
        .frontier
        .iter()
        .any(|entry| !matches!(&entry.status, CommandFrontierStatus::Admitted { .. }))
    {
        return Ok(None);
    }

    battle.command_state.validate()?;
    let commands = battle.command_state.admitted_command_set()?;
    normalize_command_set_trusted(state, &commands, content).map_err(legality)?;
    validate_state_content_trusted(state, content).map_err(legality)?;
    Ok(Some(ValidatedAdmittedCommandFrontier { state, commands }))
}

fn complete_command_frontier_inner(
    state: &GameState,
    content: &ContentPack,
    validation: ContentValidationMode,
) -> Result<CommandFrontierCompletion, AuthorityCommandError> {
    validate_transaction_content(state, content, validation)?;
    let battle = active_battle(state)?;
    if battle.command_state.frontier.is_empty() {
        return Err(AuthorityCommandError::EmptyOrInvalidFrontier);
    }
    for entry in &battle.command_state.frontier {
        validate_preserved_offer_trusted(state, entry, content)
            .map_err(AuthorityCommandError::PreservedOffer)?;
    }
    if battle
        .command_state
        .frontier
        .iter()
        .any(|entry| matches!(&entry.status, CommandFrontierStatus::Pending))
    {
        return Ok(CommandFrontierCompletion::Incomplete {
            state: state.clone(),
        });
    }

    let mut next = state.clone();
    let next_battle = next
        .battle
        .as_mut()
        .ok_or(AuthorityCommandError::EmptyOrInvalidFrontier)?;
    for entry in &mut next_battle.command_state.frontier {
        let CommandFrontierStatus::Retained { command, source } = &entry.status else {
            continue;
        };
        entry.status = CommandFrontierStatus::Admitted {
            command: command.clone(),
            source: *source,
        };
    }
    next_battle.command_state.validate()?;
    let commands = next_battle.command_state.admitted_command_set()?;
    // This is the game-owned last legality gate.  It proves exact living
    // actor coverage, current offers, target/switch legality, and duplicate
    // switch destinations before any resolver is called.
    normalize_command_set_trusted(&next, &commands, content).map_err(legality)?;
    validate_state_content_trusted(&next, content).map_err(legality)?;
    Ok(CommandFrontierCompletion::Complete {
        state: next,
        commands,
    })
}

/// Admit one external replacement proposal using the one GameRuntime-owned
/// read-only fingerprint snapshot for local and remote human owners.
/// `NoLegalReplacement` is rejected before any control or state mutation and
/// has a separate internal constructor below.
pub fn admit_replacement_proposal(
    state: &GameState,
    control: &BattleControlPlan,
    fingerprints: &[ReplacementProposalFingerprintEntry],
    proposal: &BattleReplacementProposalV1,
    content: &ContentPack,
) -> Result<ReplacementAdmissionResult, AuthorityCommandError> {
    admit_replacement_proposal_with_context(state, control, None, fingerprints, proposal, content)
}

/// Replacement admission counterpart with GameRuntime's typed remote menu
/// replay.  A remote `PartyOptionSelect` is validated against the replayed
/// replacement parent/option chain rather than against a caller-authored leaf
/// in the authority's current plan.
pub fn admit_replacement_proposal_with_context(
    state: &GameState,
    control: &BattleControlPlan,
    prepared: Option<&PreparedAuthorityAdmission>,
    fingerprints: &[ReplacementProposalFingerprintEntry],
    proposal: &BattleReplacementProposalV1,
    content: &ContentPack,
) -> Result<ReplacementAdmissionResult, AuthorityCommandError> {
    proposal.validate().map_err(|error| {
        if matches!(proposal.selection, ReplacementSelection::NoLegalReplacement) {
            AuthorityCommandError::ExternalNoLegalReplacement
        } else {
            AuthorityCommandError::Command(error)
        }
    })?;
    if matches!(proposal.selection, ReplacementSelection::NoLegalReplacement) {
        return Err(AuthorityCommandError::ExternalNoLegalReplacement);
    }
    validate_replacement_fingerprint_evidence(fingerprints)?;
    let fingerprint = proposal.fingerprint();
    if let Some(existing) = fingerprints
        .iter()
        .find(|entry| entry.operation_id == proposal.operation_id)
    {
        if existing.fingerprint == fingerprint {
            return Ok(ReplacementAdmissionResult::Duplicate {
                operation_id: proposal.operation_id.clone(),
                fingerprint,
            });
        }
        return Err(AuthorityCommandError::ProposalConflict {
            operation_id: proposal.operation_id.clone(),
        });
    }

    validate_state_content(state, content).map_err(legality)?;
    let battle = active_battle(state)?;
    validate_replacement_control_plan(control, battle, proposal.occurrence)?;
    validate_replacement_control(control, prepared, battle.authority_seat, proposal, battle)?;
    validate_replacement_proposal_trusted(state, proposal, content).map_err(legality)?;

    Ok(ReplacementAdmissionResult::Admitted {
        proposal: proposal.clone(),
    })
}

/// Construct the only valid automatic replacement decision.  It calls the
/// ordinary typed legality function with an explicit `NoLegalReplacement`
/// value, proving that no same-owner candidate exists.  It does not touch a
/// proposal fingerprint evidence and cannot be reached through external
/// proposal input.
pub fn internal_no_legal_replacement(
    state: &GameState,
    occurrence: FaintOccurrenceId,
    content: &ContentPack,
) -> Result<InternalNoLegalReplacement, AuthorityCommandError> {
    validate_state_content(state, content).map_err(legality)?;
    let selection = ReplacementSelection::NoLegalReplacement;
    validate_replacement_selection_trusted(state, occurrence, &selection, content)
        .map_err(legality)?;
    Ok(InternalNoLegalReplacement {
        occurrence,
        selection,
    })
}

/// Preserve accepted command fingerprints after the resolver has cleared the
/// live frontier.  This helper is pure and is normally invoked by the staged
/// runtime/material path; a live identity can never coexist with its
/// tombstone.
pub fn retain_command_tombstones(
    state: &GameState,
    commands: &CommandSet,
    content: &ContentPack,
) -> Result<GameState, AuthorityCommandError> {
    validate_state_content(state, content).map_err(legality)?;
    commands.validate()?;
    let mut next = state.clone();
    let battle = next
        .battle
        .as_mut()
        .ok_or(AuthorityCommandError::EmptyOrInvalidFrontier)?;
    for command in &commands.entries {
        let operation_id = command.operation_id().clone();
        let fingerprint = command.fingerprint().clone();
        if battle
            .command_state
            .frontier
            .iter()
            .any(|entry| entry.operation_id == operation_id)
        {
            return Err(AuthorityCommandError::TombstoneConflict);
        }
        if let Some(existing) = battle
            .command_state
            .tombstones
            .iter()
            .find(|entry| entry.operation_id == operation_id)
        {
            if existing.fingerprint != fingerprint {
                return Err(AuthorityCommandError::TombstoneConflict);
            }
            continue;
        }
        battle.command_state.tombstones.push(
            er_types::battle_command::CommandFingerprintEntry::new(operation_id, fingerprint)?,
        );
    }
    battle
        .command_state
        .tombstones
        .sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
    battle.command_state.validate()?;
    validate_state_content_trusted(&next, content).map_err(legality)?;
    Ok(next)
}

fn active_battle(state: &GameState) -> Result<&BattleState, AuthorityCommandError> {
    state
        .battle
        .as_ref()
        .ok_or_else(|| legality(CommandLegalityError::MissingBattle))
}

fn validate_command_control_plan(
    control: &BattleControlPlan,
    battle: &BattleState,
) -> Result<(), AuthorityCommandError> {
    control
        .validate()
        .map_err(AuthorityCommandError::ControlPlan)?;
    if control.battle_id != battle.battle_id
        || control.wave != battle.wave
        || control.turn != battle.turn
    {
        return Err(AuthorityCommandError::ControlCoordinatesMismatch);
    }
    Ok(())
}

fn validate_replacement_control_plan(
    control: &BattleControlPlan,
    battle: &BattleState,
    occurrence: FaintOccurrenceId,
) -> Result<(), AuthorityCommandError> {
    control
        .validate()
        .map_err(AuthorityCommandError::ControlPlan)?;
    let source = battle
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence)
        .ok_or(AuthorityCommandError::ReplacementHeadMismatch { occurrence })?
        .source;
    if control.battle_id != battle.battle_id
        || control.wave != source.wave
        || control.turn != source.resolved_turn
    {
        return Err(AuthorityCommandError::ControlCoordinatesMismatch);
    }
    Ok(())
}

fn validate_control_identity<'a>(
    control: &'a BattleControlPlan,
    prepared: Option<&'a PreparedAuthorityAdmission>,
    authority_seat: SeatId,
    owner_seat: SeatId,
    operation_id: &OperationId,
    menu_instance_id: MenuInstanceId,
    control_id: &str,
) -> Result<&'a BattleControl, AuthorityCommandError> {
    let seat = control
        .seat(owner_seat)
        .ok_or(AuthorityCommandError::MissingSeatControl { seat: owner_seat })?;
    if seat.decision_operation_id.as_ref() != Some(operation_id) {
        return Err(AuthorityCommandError::DecisionOperationMismatch);
    }
    let (active, decision_operation_id) = match prepared {
        Some(prepared) if owner_seat != authority_seat => {
            let replay = prepared
                .remote_paths
                .get(operation_id)
                .ok_or(AuthorityCommandError::MissingRemoteMenuReplay)?;
            if &replay.operation_id != operation_id {
                return Err(AuthorityCommandError::MenuReplayIdentityMismatch);
            }
            (&replay.control, Some(operation_id))
        }
        _ => (&seat.control, seat.decision_operation_id.as_ref()),
    };
    if decision_operation_id != Some(operation_id) {
        return Err(AuthorityCommandError::DecisionOperationMismatch);
    }
    if !active.is_actionable() || active.owner_seat() != Some(owner_seat) {
        return Err(AuthorityCommandError::ControlNotActionable { seat: owner_seat });
    }
    if prepared.is_some() && owner_seat != authority_seat {
        validate_replayed_path(&seat.control, active, owner_seat)?;
    }
    let menu = current_menu(active)
        .ok_or(AuthorityCommandError::ControlNotActionable { seat: owner_seat })?;
    if menu.instance_id != menu_instance_id {
        return Err(AuthorityCommandError::MenuInstanceMismatch {
            expected: menu.instance_id,
            actual: menu_instance_id,
        });
    }
    if menu.control_id != control_id {
        return Err(AuthorityCommandError::ControlIdMismatch {
            expected: menu.control_id.clone(),
            actual: control_id.to_owned(),
        });
    }
    Ok(active)
}

fn validate_replayed_path(
    installed_root: &BattleControl,
    replayed_leaf: &BattleControl,
    owner_seat: SeatId,
) -> Result<(), AuthorityCommandError> {
    replayed_leaf
        .validate()
        .map_err(|_| AuthorityCommandError::MenuReplayIdentityMismatch)?;
    if replayed_leaf.owner_seat() != Some(owner_seat) {
        return Err(AuthorityCommandError::MenuReplayIdentityMismatch);
    }
    let root_matches = match replayed_leaf {
        BattleControl::MoveSelect(value) => {
            matches!(value.cancel_to.as_ref(), BattleControl::CommandRoot(root) if {
                matches!(installed_root, BattleControl::CommandRoot(expected) if root == expected)
            })
        }
        BattleControl::TargetSelect(value) => {
            let BattleControl::MoveSelect(move_control) = value.cancel_to.as_ref() else {
                return Err(AuthorityCommandError::MenuReplayRootMismatch);
            };
            matches!(move_control.cancel_to.as_ref(), BattleControl::CommandRoot(root) if {
                matches!(installed_root, BattleControl::CommandRoot(expected) if root == expected)
            })
        }
        BattleControl::PartyOptionSelect(value) => match value.cancel_to.as_ref() {
            BattleControl::PartySelect(party) => matches!(
                party.cancel_to.as_ref(),
                BattleControl::CommandRoot(root) if {
                    matches!(installed_root, BattleControl::CommandRoot(expected) if root == expected)
                }
            ),
            BattleControl::ReplacementSelect(replacement) => matches!(
                installed_root,
                BattleControl::ReplacementSelect(expected) if replacement == expected
            ),
            _ => false,
        },
        BattleControl::ReplacementSelect(value) => matches!(
            installed_root,
            BattleControl::ReplacementSelect(expected) if value == expected
        ),
        BattleControl::CommandRoot(_)
        | BattleControl::PartySelect(_)
        | BattleControl::Waiting(_)
        | BattleControl::Complete(_) => false,
    };
    if root_matches {
        Ok(())
    } else {
        Err(AuthorityCommandError::MenuReplayRootMismatch)
    }
}

fn validate_command_control(
    control: &BattleControlPlan,
    prepared: Option<&PreparedAuthorityAdmission>,
    authority_seat: SeatId,
    proposal: &BattleCommandProposalV1,
) -> Result<(), AuthorityCommandError> {
    let active = validate_control_identity(
        control,
        prepared,
        authority_seat,
        proposal.owner_seat,
        &proposal.operation_id,
        proposal.menu_instance_id,
        &proposal.control_id,
    )?;
    match active {
        BattleControl::MoveSelect(value) => {
            let BattleCommand::Fight {
                actor,
                move_slot,
                targets,
            } = &proposal.command
            else {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "MoveSelect accepts only Fight",
                });
            };
            if *actor != value.actor || *actor != proposal.actor || move_slot.get() >= 4 {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "actor or move slot differs from MoveSelect",
                });
            }
            if proposal.field_slot != value.field_slot {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "field slot differs from MoveSelect",
                });
            }
            if !matches!(targets, BattleTargetSelection::Implicit) {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "a selected target requires TargetSelect",
                });
            }
            let option_id = move_option_id(*actor, *move_slot)?;
            require_menu_option(&value.menu, option_id)
        }
        BattleControl::TargetSelect(value) => {
            let BattleCommand::Fight {
                actor,
                move_slot,
                targets: BattleTargetSelection::Selected(targets),
            } = &proposal.command
            else {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "TargetSelect requires a selected Fight target set",
                });
            };
            if *actor != value.actor || *actor != proposal.actor || *move_slot != value.move_slot {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "actor or move slot differs from TargetSelect",
                });
            }
            if proposal.field_slot != value.field_slot {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "field slot differs from TargetSelect",
                });
            }
            let canonical_targets = targets.clone();
            if value.multiple {
                if canonical_targets != value.candidate_targets {
                    return Err(AuthorityCommandError::CommandControlMismatch {
                        reason: "multiple-target selection is not the complete candidate set",
                    });
                }
            } else if canonical_targets.len() != 1
                || !value.candidate_targets.contains(&canonical_targets[0])
            {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "single-target selection is not a current candidate",
                });
            }
            for target in canonical_targets {
                require_menu_option(&value.menu, target_option_id(target)?)?;
            }
            Ok(())
        }
        BattleControl::PartyOptionSelect(value)
            if matches!(value.cancel_to.as_ref(), BattleControl::PartySelect(_)) =>
        {
            let BattleCommand::Switch { actor, party_slot } = &proposal.command else {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "PartyOptionSelect accepts only Switch",
                });
            };
            if *actor != value.actor
                || *actor != proposal.actor
                || *party_slot != value.selected_party_slot
            {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "actor or party slot differs from PartyOptionSelect",
                });
            }
            if proposal.field_slot != value.field_slot {
                return Err(AuthorityCommandError::CommandControlMismatch {
                    reason: "field slot differs from PartyOptionSelect",
                });
            }
            require_menu_option(
                &value.menu,
                MenuOptionId::new("party-option/send-out")
                    .map_err(|_| AuthorityCommandError::MenuOptionIdentity)?,
            )
        }
        BattleControl::CommandRoot(_) => Err(AuthorityCommandError::CommandControlMismatch {
            reason: "CommandRoot opens a typed child picker before submission",
        }),
        BattleControl::PartySelect(_) => Err(AuthorityCommandError::CommandControlMismatch {
            reason: "PartySelect opens PartyOptionSelect before submission",
        }),
        BattleControl::PartyOptionSelect(_) => Err(AuthorityCommandError::CommandControlMismatch {
            reason: "replacement PartyOptionSelect cannot submit a command",
        }),
        BattleControl::ReplacementSelect(_)
        | BattleControl::Waiting(_)
        | BattleControl::Complete(_) => Err(AuthorityCommandError::CommandControlMismatch {
            reason: "control is not a command picker",
        }),
    }
}

fn validate_replacement_control(
    control: &BattleControlPlan,
    prepared: Option<&PreparedAuthorityAdmission>,
    authority_seat: SeatId,
    proposal: &BattleReplacementProposalV1,
    battle: &BattleState,
) -> Result<(), AuthorityCommandError> {
    let active = validate_control_identity(
        control,
        prepared,
        authority_seat,
        proposal.owner_seat,
        &proposal.operation_id,
        proposal.menu_instance_id,
        &proposal.control_id,
    )?;
    let (menu, occurrence, source, actor, field_slot, owner_seat, active_party_slot) = match active
    {
        BattleControl::ReplacementSelect(value) => (
            &value.menu,
            value.occurrence,
            value.source,
            value.actor,
            value.field_slot,
            value.owner_seat,
            None,
        ),
        BattleControl::PartyOptionSelect(value) => {
            let BattleControl::ReplacementSelect(parent) = value.cancel_to.as_ref() else {
                return Err(AuthorityCommandError::ReplacementControlMismatch {
                    reason: "replacement PartyOptionSelect has a non-replacement parent",
                });
            };
            (
                &value.menu,
                parent.occurrence,
                parent.source,
                parent.actor,
                parent.field_slot,
                parent.owner_seat,
                Some(value.selected_party_slot),
            )
        }
        _ => {
            return Err(AuthorityCommandError::ReplacementControlMismatch {
                reason: "replacement selection must use ReplacementSelect or its PartyOptionSelect",
            });
        }
    };
    let stored = battle
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == proposal.occurrence)
        .ok_or(AuthorityCommandError::ReplacementHeadMismatch {
            occurrence: proposal.occurrence,
        })?;
    if stored.replacement != er_types::battle_model::ReplacementProgress::Pending
        || occurrence != stored.id
        || source != stored.source
        || actor != stored.pokemon
        || field_slot != stored.slot
        || Some(owner_seat) != stored.owner_seat
        || proposal.field_slot != stored.slot
    {
        return Err(AuthorityCommandError::ReplacementControlMismatch {
            reason: "control is not bound to the stored faint occurrence",
        });
    }
    if let ReplacementSelection::Selected {
        party_slot: selected_party_slot,
        pokemon,
    } = proposal.selection
    {
        if active_party_slot.is_some_and(|parent_slot| parent_slot != selected_party_slot) {
            return Err(AuthorityCommandError::ReplacementControlMismatch {
                reason: "selection does not match the active party option",
            });
        }
        let selected_option = if active_party_slot.is_some() {
            MenuOptionId::new("party-option/send-out")
                .map_err(|_| AuthorityCommandError::MenuOptionIdentity)?
        } else {
            replacement_party_option_id(pokemon, selected_party_slot)?
        };
        require_menu_option(menu, selected_option)?;
    } else {
        return Err(AuthorityCommandError::ExternalNoLegalReplacement);
    }
    Ok(())
}

fn current_menu(control: &BattleControl) -> Option<&BattleMenu> {
    match control {
        BattleControl::CommandRoot(value) => Some(&value.menu),
        BattleControl::MoveSelect(value) => Some(&value.menu),
        BattleControl::TargetSelect(value) => Some(&value.menu),
        BattleControl::PartySelect(value) => Some(&value.menu),
        BattleControl::PartyOptionSelect(value) => Some(&value.menu),
        BattleControl::ReplacementSelect(value) => Some(&value.menu),
        BattleControl::Waiting(_) | BattleControl::Complete(_) => None,
    }
}

fn require_menu_option(
    menu: &BattleMenu,
    option_id: MenuOptionId,
) -> Result<(), AuthorityCommandError> {
    let available = menu
        .option(option_id.clone())
        .is_some_and(|option| option.visibility.is_visible() && option.enabled);
    if available {
        Ok(())
    } else {
        Err(AuthorityCommandError::MenuOptionUnavailable {
            option_id: option_id.as_str().to_owned(),
        })
    }
}

fn move_option_id(
    actor: PokemonId,
    move_slot: er_types::battle_ids::MoveSlotIndex,
) -> Result<MenuOptionId, AuthorityCommandError> {
    MenuOptionId::new(format!("move/{actor}/slot/{}", move_slot.get()))
        .map_err(|_| AuthorityCommandError::MenuOptionIdentity)
}

fn target_option_id(target: FieldSlot) -> Result<MenuOptionId, AuthorityCommandError> {
    let side = match target.side {
        BattleSide::Player => "player",
        BattleSide::Enemy => "enemy",
    };
    MenuOptionId::new(format!("target/{side}/{}", target.position))
        .map_err(|_| AuthorityCommandError::MenuOptionIdentity)
}

fn replacement_party_option_id(
    pokemon: PokemonId,
    party_slot: er_types::battle_ids::PartyIndex,
) -> Result<MenuOptionId, AuthorityCommandError> {
    MenuOptionId::new(format!("party/{pokemon}/slot/{}", party_slot.get()))
        .map_err(|_| AuthorityCommandError::MenuOptionIdentity)
}

#[cfg(test)]
mod compile_shape_tests {
    use super::*;

    // These checks intentionally exercise only the pure result/evidence surface;
    // battle fixtures and resolver tests live in the owned M3 authority test
    // target so this module cannot accidentally become a semantic bypass.
    #[test]
    fn replacement_fingerprint_evidence_accepts_empty_snapshot() {
        assert!(validate_replacement_fingerprint_evidence(&[]).is_ok());
    }
}
