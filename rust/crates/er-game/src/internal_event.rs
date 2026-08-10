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
use er_types::battle_control::BattleControlPlan;
use er_types::battle_ids::{AuthorityEpoch, FaintOccurrenceId, MenuInstanceId};
use er_types::{
    AuthorityEntryKind, ButtonEvent, FrameContext, OperationId, Revision, SeatId, UiIntent,
};
use thiserror::Error;

/// Maximum number of internal events processed by one external step.
pub const INTERNAL_EVENT_BUDGET: usize = 4_096;

/// A typed identity carried through the private game reducer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CausalIdentity {
    pub operation_id: Option<OperationId>,
    pub control_id: Option<String>,
}

impl CausalIdentity {
    pub fn new(operation_id: Option<OperationId>, control_id: Option<String>) -> Self {
        Self {
            operation_id,
            control_id,
        }
    }
}

/// Private semantic work requested from the game reducer.
///
/// `NoLegalReplacement` is deliberately not representable as an external
/// proposal.  The game reducer creates it only after inspecting the stored
/// faint occurrence and validating the current party state.
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

/// A button event after the input reducer captured the endpoint menu ID.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ButtonEventPayload {
    pub endpoint: SeatId,
    pub menu_instance_id: MenuInstanceId,
    pub event: ButtonEvent,
}

/// A UI intent after the UI reducer captured the endpoint menu ID.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UiEventPayload {
    pub endpoint: SeatId,
    pub menu_instance_id: MenuInstanceId,
    pub intent: UiIntent,
}

/// A game reducer request with its causal identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameEventPayload {
    pub intent: GameIntent,
    pub causal: CausalIdentity,
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

/// The only prepared game-resolution payload accepted by the private queue.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PreparedBattleResolution {
    Turn {
        transition: BattleTransition,
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
            Self::Turn { transition, .. } => &transition.before_digest,
            Self::Replacement { transition, .. } => &transition.before_digest,
        }
    }

    pub fn after_digest(&self) -> &MechanicalStateDigest {
        match self {
            Self::Turn { transition, .. } => &transition.after_digest,
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
pub enum InternalEventQueueError {
    #[error("internal event budget exceeded after {processed} events; remaining queue has {remaining} events")]
    InternalEventBudgetExceeded {
        processed: usize,
        remaining: usize,
        remaining_kinds: Vec<InternalEventKind>,
    },
}

/// Kernel-facing FIFO bookkeeping.  It does not reduce events or own any
/// game state; callers pop one event, apply exactly one reducer, then append
/// returned events in source order.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InternalEventQueue {
    events: VecDeque<InternalEvent>,
    processed: usize,
}

impl InternalEventQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_events(events: impl IntoIterator<Item = InternalEvent>) -> Self {
        let mut queue = Self::new();
        queue.push_all_source_order(events);
        queue
    }

    pub fn push(&mut self, event: InternalEvent) {
        self.events.push_back(event);
    }

    pub fn push_all_source_order(&mut self, events: impl IntoIterator<Item = InternalEvent>) {
        self.events.extend(events);
    }

    pub fn pop(&mut self) -> Result<Option<InternalEvent>, InternalEventQueueError> {
        let Some(event) = self.events.pop_front() else {
            return Ok(None);
        };
        if self.processed >= INTERNAL_EVENT_BUDGET {
            self.events.push_front(event);
            return Err(InternalEventQueueError::InternalEventBudgetExceeded {
                processed: self.processed,
                remaining: self.events.len(),
                remaining_kinds: self.remaining_kinds(),
            });
        }
        self.processed += 1;
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

    pub fn remaining_kinds(&self) -> Vec<InternalEventKind> {
        self.events.iter().map(InternalEvent::kind).collect()
    }
}
