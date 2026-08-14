//! Private causal events shared by the game reducer and the kernel queue.
//!
//! The queue itself is intentionally small and mechanical.  `er-kernel` owns
//! the production instance and the cross-owner transaction; this module only
//! owns the closed event vocabulary and the deterministic budget accounting
//! needed by that owner.

use std::collections::VecDeque;

use er_battle::{BattleReplacementTransition, BattleTransition};
use er_state::digest::MechanicalStateDigest;
use er_types::battle_command::{BattleCommandProposalV1, BattleReplacementProposalV1};
use er_types::battle_control::{BattleControlPlan, SeatMenuInstanceAllocator};
use er_types::battle_ids::{AuthorityEpoch, FaintOccurrenceId, MenuInstanceId};
use er_types::{
    AuthorityEntryKind, ButtonEvent, FrameContext, MenuOptionId, OperationId, Revision, SeatId,
};
use thiserror::Error;

/// Maximum number of internal events processed by one external step.
pub const INTERNAL_EVENT_BUDGET: usize = 4_096;

/// A typed identity carried through the private game reducer.
///
/// This value is public only because `er-kernel` is a separate crate that
/// composes the closed event vocabulary.  It is hidden from generated docs so
/// campaign code does not mistake the kernel integration boundary for a
/// semantic input API.
#[doc(hidden)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CausalIdentity {
    operation_id: Option<OperationId>,
    control_id: Option<String>,
}

impl CausalIdentity {
    #[doc(hidden)]
    pub fn new(operation_id: Option<OperationId>, control_id: Option<String>) -> Self {
        Self {
            operation_id,
            control_id,
        }
    }

    /// Retained for crate-local inspection; not every all-targets test target
    /// exercises both causal identity accessors.
    #[allow(dead_code)]
    pub(crate) fn operation_id(&self) -> Option<&OperationId> {
        self.operation_id.as_ref()
    }

    /// Retained for crate-local inspection; not every all-targets test target
    /// exercises both causal identity accessors.
    #[allow(dead_code)]
    pub(crate) fn control_id(&self) -> Option<&str> {
        self.control_id.as_deref()
    }
}

/// Private semantic work requested from the game reducer.
///
/// `NoLegalReplacement` is deliberately not representable as an external
/// proposal.  The game reducer creates it only after inspecting the stored
/// faint occurrence and validating the current party state.
///
/// This semantic value remains public solely for composition by the separate
/// `er-kernel` crate and is hidden from generated docs as an integration-only
/// boundary.
#[doc(hidden)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameIntent {
    CommandProposal {
        proposal: BattleCommandProposalV1,
        authority_epoch: AuthorityEpoch,
    },
    ReplacementProposal {
        proposal: BattleReplacementProposalV1,
        authority_epoch: AuthorityEpoch,
    },
    NoLegalReplacement {
        occurrence: FaintOccurrenceId,
        authority_epoch: AuthorityEpoch,
    },
}

impl GameIntent {
    /// Build the automatic no-legal-replacement intent after the game has
    /// projected a replacement frontier and found no legal candidate.
    ///
    /// This constructor is crate-private by design.  `NoLegalReplacement`
    /// is deterministic internal work, never a public semantic submission.
    pub(crate) fn no_legal_replacement(
        occurrence: FaintOccurrenceId,
        authority_epoch: AuthorityEpoch,
    ) -> Self {
        Self::NoLegalReplacement {
            occurrence,
            authority_epoch,
        }
    }
}

/// A button event after the input reducer captured the endpoint menu ID.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ButtonEventPayload {
    pub endpoint: SeatId,
    pub menu_instance_id: MenuInstanceId,
    pub event: ButtonEvent,
}

/// A typed Battle-mode UI action after the kernel UI reducer captured the
/// endpoint menu ID.
///
/// Battle mode carries only the stable identity required by the game boundary,
/// never a legacy semantic intent or a serde/JSON value.  The fields are
/// private so callers cannot construct a semantic event with a struct literal.
#[doc(hidden)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UiEventPayload {
    endpoint: SeatId,
    menu_instance_id: MenuInstanceId,
    action: BattleUiAction,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum BattleUiAction {
    Activate {
        control_id: String,
        option_id: MenuOptionId,
    },
    Cancel {
        control_id: String,
    },
}

impl UiEventPayload {
    #[doc(hidden)]
    pub fn activate(
        endpoint: SeatId,
        menu_instance_id: MenuInstanceId,
        control_id: String,
        option_id: MenuOptionId,
    ) -> Self {
        Self {
            endpoint,
            menu_instance_id,
            action: BattleUiAction::Activate {
                control_id,
                option_id,
            },
        }
    }

    #[doc(hidden)]
    pub fn cancel(endpoint: SeatId, menu_instance_id: MenuInstanceId, control_id: String) -> Self {
        Self {
            endpoint,
            menu_instance_id,
            action: BattleUiAction::Cancel { control_id },
        }
    }

    pub(crate) fn into_parts(self) -> (SeatId, MenuInstanceId, BattleUiAction) {
        (self.endpoint, self.menu_instance_id, self.action)
    }
}

/// A game reducer request with its causal identity.
///
/// This payload is public only for the separate `er-kernel` integration
/// consumer.  Private fields and a doc-hidden constructor keep semantic
/// event creation visibly behind that boundary.
#[doc(hidden)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameEventPayload {
    intent: GameIntent,
    causal: CausalIdentity,
}

impl GameEventPayload {
    pub(crate) fn new(intent: GameIntent, causal: CausalIdentity) -> Self {
        Self { intent, causal }
    }

    pub(crate) fn into_parts(self) -> (GameIntent, CausalIdentity) {
        (self.intent, self.causal)
    }
}

/// An already-admitted protocol action.  The wire frame and proposal
/// validation remain owned by the protocol crate; the game sees only this
/// typed identity at the reducer boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolAction {
    pub frame: FrameContext,
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolEventPayload {
    pub action: ProtocolAction,
}

/// Opaque proof that the game reducer retained the resolver/finalizer digests
/// before handing a TURN to the private kernel queue. It is transaction-local
/// and is never serialized into material, protocol frames, or snapshots.
#[doc(hidden)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TurnDigestEvidence {
    transition: BattleTransition,
}

/// Borrowed authority-local proof assembled only after the canonical TURN
/// material has been bound to the finalized resolver transition.  The proof
/// carries no serialized representation and cannot be constructed outside
/// this crate; its lifetime also prevents it from outliving the prepared
/// resolver/control evidence it borrows.
///
/// External crates cannot name or construct this proof:
///
/// ```compile_fail
/// let _proof: er_game::internal_event::AuthorityLocalTurnProof<'static> =
///     er_game::internal_event::AuthorityLocalTurnProof {
///         transition: todo!(),
///         control_plan: todo!(),
///         menu_allocators_before: &[],
///         material_operation_id: todo!(),
///     };
/// ```
#[doc(hidden)]
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct AuthorityLocalTurnProof<'a> {
    transition: &'a BattleTransition,
    control_plan: &'a BattleControlPlan,
    menu_allocators_before: &'a [SeatMenuInstanceAllocator],
    material_operation_id: &'a OperationId,
}

impl<'a> AuthorityLocalTurnProof<'a> {
    pub(crate) fn transition(&self) -> &BattleTransition {
        self.transition
    }

    pub(crate) fn control_plan(&self) -> &BattleControlPlan {
        self.control_plan
    }

    pub(crate) fn menu_allocators_before(&self) -> &[SeatMenuInstanceAllocator] {
        self.menu_allocators_before
    }

    pub(crate) fn material_operation_id(&self) -> &OperationId {
        self.material_operation_id
    }
}

impl TurnDigestEvidence {
    pub(crate) fn from_finalized_transition(transition: BattleTransition) -> Self {
        Self { transition }
    }

    /// Borrow the resolver, control, allocator, and transaction identity as
    /// one authority-local proof after the material binder has compared every
    /// decoded field against this finalized transition.
    pub(crate) fn bind_authority_local_turn<'a>(
        &'a self,
        control_plan: &'a BattleControlPlan,
        menu_allocators_before: &'a [SeatMenuInstanceAllocator],
        material_operation_id: &'a OperationId,
    ) -> AuthorityLocalTurnProof<'a> {
        AuthorityLocalTurnProof {
            transition: &self.transition,
            control_plan,
            menu_allocators_before,
            material_operation_id,
        }
    }

    #[doc(hidden)]
    pub fn transition(&self) -> &BattleTransition {
        &self.transition
    }
}

/// The only prepared game-resolution payload accepted by the private queue.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PreparedBattleResolution {
    Turn {
        digest_evidence: TurnDigestEvidence,
        material_operation_id: OperationId,
        next_control: BattleControlPlan,
    },
    Replacement {
        transition: BattleReplacementTransition,
        material_operation_id: OperationId,
        next_control: BattleControlPlan,
    },
}

impl PreparedBattleResolution {
    pub fn material_operation_id(&self) -> &OperationId {
        match self {
            Self::Turn {
                material_operation_id,
                ..
            }
            | Self::Replacement {
                material_operation_id,
                ..
            } => material_operation_id,
        }
    }

    pub fn next_control(&self) -> &BattleControlPlan {
        match self {
            Self::Turn { next_control, .. } | Self::Replacement { next_control, .. } => {
                next_control
            }
        }
    }

    pub fn before_digest(&self) -> &MechanicalStateDigest {
        match self {
            Self::Turn {
                digest_evidence, ..
            } => &digest_evidence.transition().before_digest,
            Self::Replacement { transition, .. } => &transition.before_digest,
        }
    }

    pub fn after_digest(&self) -> &MechanicalStateDigest {
        match self {
            Self::Turn {
                digest_evidence, ..
            } => &digest_evidence.transition().after_digest,
            Self::Replacement { transition, .. } => &transition.after_digest,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BattleResolvedPayload {
    pub resolution: PreparedBattleResolution,
}

/// Typed material bytes prepared for the authority log boundary.
///
/// The protocol owner adds frame context and publishes this value.  Keeping
/// the bytes and digest here, instead of a JSON value or callback, preserves
/// the canonical serialization boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedAuthorityEntry {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub material_bytes: Vec<u8>,
    pub material_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorityEntryReadyPayload {
    pub prepared: PreparedAuthorityEntry,
}

/// Material category used by the common material applier.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MaterialKind {
    Turn,
    Replacement,
}

/// Typed evidence returned by the common material applier.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaterialApplyResult {
    pub material_kind: MaterialKind,
    pub operation_id: OperationId,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaterialInstalledPayload {
    pub revision: Revision,
    pub result: MaterialApplyResult,
}

/// The presentation barrier is intentionally an internal typed marker.  The
/// presentation owner supplies the concrete pending-event accounting when it
/// installs the control; the game reducer never publishes renderer effects.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PresentationBarrier {
    pub operation_id: OperationId,
    pub pending_events: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlInstalledPayload {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub control: BattleControlPlan,
    pub presentation_barrier: PresentationBarrier,
}

/// The closed private event vocabulary for one kernel step.
///
/// The enum is public only so the separate `er-kernel` crate can own the FIFO
/// and compose reducer outputs.  It is hidden from generated docs because its
/// variants are internal causal work, not a campaign-facing API.
#[doc(hidden)]
// This cross-crate event vocabulary is frozen; boxing a payload would change
// the public Rust shape consumed by `er-kernel`.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InternalEvent {
    Button(ButtonEventPayload),
    Ui(UiEventPayload),
    Game(GameEventPayload),
    Protocol(ProtocolEventPayload),
    BattleResolved(BattleResolvedPayload),
    AuthorityEntryReady(AuthorityEntryReadyPayload),
    MaterialInstalled(MaterialInstalledPayload),
    ControlInstalled(ControlInstalledPayload),
}

/// Stable event-kind evidence used by traces and budget failures.
///
/// This is a read-only integration/tracing value.  It is public for the
/// separate kernel consumer and hidden from generated docs with the rest of
/// the internal event boundary.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum InternalEventKind {
    Button,
    Ui,
    Game,
    Protocol,
    BattleResolved,
    AuthorityEntryReady,
    MaterialInstalled,
    ControlInstalled,
}

impl InternalEvent {
    /// Wrap one already-typed command proposal at the trusted kernel/game
    /// composition seam. The causal identity is derived from the proposal;
    /// callers cannot supply a different operation or control identity.
    #[doc(hidden)]
    pub fn command_proposal(
        proposal: BattleCommandProposalV1,
        authority_epoch: AuthorityEpoch,
    ) -> Self {
        let causal = CausalIdentity::new(
            Some(proposal.operation_id.clone()),
            Some(proposal.control_id.clone()),
        );
        Self::Game(GameEventPayload::new(
            GameIntent::CommandProposal {
                proposal,
                authority_epoch,
            },
            causal,
        ))
    }

    /// Replacement counterpart to [`Self::command_proposal`]. Automatic
    /// no-legal replacement remains unavailable through this public seam.
    #[doc(hidden)]
    pub fn replacement_proposal(
        proposal: BattleReplacementProposalV1,
        authority_epoch: AuthorityEpoch,
    ) -> Self {
        let causal = CausalIdentity::new(
            Some(proposal.operation_id.clone()),
            Some(proposal.control_id.clone()),
        );
        Self::Game(GameEventPayload::new(
            GameIntent::ReplacementProposal {
                proposal,
                authority_epoch,
            },
            causal,
        ))
    }

    /// Construct the automatic no-legal-replacement causal event.
    ///
    /// This remains crate-private so only game/kernel logic that has already
    /// projected the replacement frontier can enqueue this semantic work.
    pub(crate) fn no_legal_replacement(
        occurrence: FaintOccurrenceId,
        authority_epoch: AuthorityEpoch,
        causal: CausalIdentity,
    ) -> Self {
        Self::Game(GameEventPayload::new(
            GameIntent::no_legal_replacement(occurrence, authority_epoch),
            causal,
        ))
    }

    pub const fn kind(&self) -> InternalEventKind {
        match self {
            Self::Button(_) => InternalEventKind::Button,
            Self::Ui(_) => InternalEventKind::Ui,
            Self::Game(_) => InternalEventKind::Game,
            Self::Protocol(_) => InternalEventKind::Protocol,
            Self::BattleResolved(_) => InternalEventKind::BattleResolved,
            Self::AuthorityEntryReady(_) => InternalEventKind::AuthorityEntryReady,
            Self::MaterialInstalled(_) => InternalEventKind::MaterialInstalled,
            Self::ControlInstalled(_) => InternalEventKind::ControlInstalled,
        }
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[doc(hidden)]
pub enum InternalEventQueueError {
    #[error(
        "internal event budget exceeded after {processed} events; remaining queue has {remaining} events"
    )]
    InternalEventBudgetExceeded {
        processed: usize,
        remaining: usize,
        remaining_kinds: Vec<InternalEventKind>,
    },
}

/// Kernel-facing FIFO bookkeeping.  It does not reduce events or own any
/// game state; callers pop one event, apply exactly one reducer, then append
/// returned events in source order.
///
/// This public type is an unavoidable cross-crate integration seam because
/// `er-kernel` owns the production queue.  It is deliberately hidden from
/// generated docs and exposes only mechanical FIFO/budget evidence.
#[doc(hidden)]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InternalEventQueue {
    events: VecDeque<InternalEvent>,
    processed: usize,
    processed_kinds: Vec<InternalEventKind>,
}

impl InternalEventQueue {
    #[doc(hidden)]
    pub fn new() -> Self {
        Self::default()
    }

    #[doc(hidden)]
    pub fn from_events(events: impl IntoIterator<Item = InternalEvent>) -> Self {
        let mut queue = Self::new();
        queue.push_all_source_order(events);
        queue
    }

    /// Mechanical source-order admission for the separate kernel owner.  It
    /// is doc-hidden so this mutable queue seam is not a campaign API.
    #[doc(hidden)]
    pub fn push(&mut self, event: InternalEvent) {
        self.events.push_back(event);
    }

    /// Enqueue automatic no-legal-replacement work after game-owned
    /// replacement projection.  This is deliberately crate-private; callers
    /// cannot inject the semantic event through the public queue seam.
    #[allow(dead_code)]
    pub(crate) fn enqueue_no_legal_replacement(
        &mut self,
        occurrence: FaintOccurrenceId,
        authority_epoch: AuthorityEpoch,
        causal: CausalIdentity,
    ) {
        self.events.push_back(InternalEvent::no_legal_replacement(
            occurrence,
            authority_epoch,
            causal,
        ));
    }

    #[doc(hidden)]
    pub fn push_all_source_order(&mut self, events: impl IntoIterator<Item = InternalEvent>) {
        self.events.extend(events);
    }

    pub fn pop(&mut self) -> Result<Option<InternalEvent>, InternalEventQueueError> {
        if self.processed >= INTERNAL_EVENT_BUDGET && !self.events.is_empty() {
            return Err(InternalEventQueueError::InternalEventBudgetExceeded {
                processed: self.processed,
                remaining: self.events.len(),
                remaining_kinds: self.remaining_kinds(),
            });
        }
        let Some(event) = self.events.pop_front() else {
            return Ok(None);
        };
        let kind = event.kind();
        self.processed += 1;
        self.processed_kinds.push(kind);
        Ok(Some(event))
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    pub const fn processed(&self) -> usize {
        self.processed
    }

    /// Return the exact source-order kinds already processed by this queue.
    ///
    /// The slice is intentionally read-only: the kernel trace must observe
    /// the queue's causal ledger, never rewrite it.  This method is public
    /// only for the separate `er-kernel` consumer and is hidden from generated
    /// docs with the rest of the integration boundary.
    #[doc(hidden)]
    pub fn processed_kinds(&self) -> &[InternalEventKind] {
        &self.processed_kinds
    }

    pub fn remaining_kinds(&self) -> Vec<InternalEventKind> {
        self.events.iter().map(InternalEvent::kind).collect()
    }
}
