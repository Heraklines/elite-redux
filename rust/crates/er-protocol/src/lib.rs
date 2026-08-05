//! Production Authority V2 state machines for the PokéRogue Redux kernel.

pub mod authority_log;
pub mod proposal;
pub mod recovery;
pub mod replica;
pub mod scheduler;
pub mod successor;
pub mod validation;

pub use authority_log::*;
pub use proposal::*;
pub use recovery::*;
pub use replica::*;
pub use scheduler::*;
pub use successor::*;
pub use validation::*;

pub use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, AuthorityFrontier,
    AuthorityReceipt, AuthorityReceiptBody, AuthorityRecoverySlice, ControlProjectionOutcome,
    FrameContext, FrameType, Material, MaterialApplicationOutcome, NetworkFrame, NetworkPayload,
    NextControl, ProposalMessage, RawFrame, RecoveryAppliedProof, RecoveryBundle,
    RecoveryBundleBody, RecoveryFenceState, RecoveryFenceView, RecoveryPhase, RecoveryRequestBody,
    SafeI53, TailRequestBody, TerminalFrameBody, TimeClass, TimerOwner,
};
