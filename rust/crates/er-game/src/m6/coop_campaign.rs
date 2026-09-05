//! M6 complete-content two-kernel co-op campaign model.
//!
//! This module owns the pure, deterministic half of the raw-key co-op system
//! proof. It defines campaign schedules (duplicate/delay/disconnect/recovery
//! anchored on ordered Authority V2 traffic), reconstructs an independent
//! candidate replica from serialized authority commits alone through the
//! common role-neutral material applier, verifies receipt order, and folds
//! replay-trace digests. Executing the plans against real kernels is the
//! harness's job; every parity rule that must not drift lives here so host,
//! guest, and candidate comparisons share one implementation.
//!
//! The module is deliberately free of kernel/protocol/sim dependencies: a
//! campaign plan is data, and candidate replay is a pure fold over commit
//! evidence.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_state::snapshot::GameState;
use er_types::battle_control::SeatMenuInstanceAllocator;
use er_types::protocol::{AckStage, AuthorityEntryKind};
use er_types::{AuthorityEntryBody, AuthorityReceiptBody};
use er_types::{OperationId, PhysicalKey, Revision, SeatId};

use crate::material::{
    BattleMaterialApplyContext, BattleMaterialApplyError, BattleMaterialCodecError,
    BattleReplacementMaterialV1, BattleTurnMaterialV1, MaterialApplyResult,
    apply_replacement_material, apply_turn_material, replacement_material_digest,
    turn_material_digest,
};

/// Frozen schema version of the campaign plan and evidence types below.
pub const COOP_CAMPAIGN_SCHEMA_VERSION: u32 = 1;

/// The two human endpoints of a complete-content co-op battle.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoopEndpoint {
    /// The authority endpoint; it hosts the Authority V2 log owner.
    Host,
    /// The replica endpoint; it proposes through retained proposal leases and
    /// never resolves authority entries itself.
    Guest,
}

/// Transport-visible packet families a schedule can anchor on.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub enum CoopPacketKind {
    /// A replica command/replacement proposal traveling guest -> host.
    Proposal,
    /// An authority entry frame (TURN or REPLACEMENT commit) host -> guest.
    AuthorityCommit,
    /// An authority receipt frame guest -> host.
    AuthorityReceipt,
}

/// Directional packet selector used by scheduled faults. `from`/`to` name the
/// emitting and receiving endpoints so a selector matches exactly one stream.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoopPacketSelector {
    pub kind: CoopPacketKind,
    pub from: CoopEndpoint,
    pub to: CoopEndpoint,
}

impl CoopPacketSelector {
    /// Host-issued authority commit stream (host -> guest).
    pub const fn authority_commit() -> Self {
        Self {
            kind: CoopPacketKind::AuthorityCommit,
            from: CoopEndpoint::Host,
            to: CoopEndpoint::Guest,
        }
    }

    /// Guest proposal stream (guest -> host).
    pub const fn guest_proposal() -> Self {
        Self {
            kind: CoopPacketKind::Proposal,
            from: CoopEndpoint::Guest,
            to: CoopEndpoint::Host,
        }
    }

    /// Guest receipt stream (guest -> host).
    pub const fn guest_receipt() -> Self {
        Self {
            kind: CoopPacketKind::AuthorityReceipt,
            from: CoopEndpoint::Guest,
            to: CoopEndpoint::Host,
        }
    }
}

/// Where a scheduled action binds relative to ordered campaign traffic.
///
/// `ordinal` is one-based and counts *deliveries* of packets matching the
/// anchor selector, so duplicates produced by earlier actions are counted
/// exactly as often as they are delivered.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum CoopAnchor {
    /// Apply before delivering the ordinal-matching packet.
    BeforeDelivery {
        selector: CoopPacketSelector,
        ordinal: u32,
    },
    /// Apply immediately after delivering the ordinal-matching packet.
    AfterDelivery {
        selector: CoopPacketSelector,
        ordinal: u32,
    },
    /// Apply once neither endpoint can make transport progress: no deliverable
    /// packet is due and no packet is queued.
    WhenIdle,
}

/// One fault/lifecycle operation inside a campaign schedule.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CoopScheduledActionKind {
    /// Deliver an exact copy of the matched packet after the original.
    DuplicatePacket { selector: CoopPacketSelector },
    /// Postpone the matched packet by an exact virtual delay in milliseconds.
    DelayPacket {
        selector: CoopPacketSelector,
        additional_ms: u64,
    },
    /// Tear down one endpoint's transport; its in-flight traffic goes stale.
    Disconnect { endpoint: CoopEndpoint },
    /// Rebind one endpoint onto a fresh connection generation.
    Reconnect { endpoint: CoopEndpoint },
}

/// One anchored schedule entry of a campaign plan.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoopScheduledAction {
    pub anchor: CoopAnchor,
    pub action: CoopScheduledActionKind,
}

/// Complete deterministic plan of one raw-key co-op campaign.
///
/// The plan is intentionally small: gameplay progress is produced by physical
/// key input at each endpoint (the harness drives the production menu graph),
/// while this plan pins the exact duplicate/delay/disconnect/recovery fault
/// schedule onto ordered Authority V2 traffic.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoopCampaignV1 {
    pub schema_version: u32,
    pub name: String,
    pub replay_seed: u64,
    pub host_seat: SeatId,
    pub guest_seat: SeatId,
    /// The single confirm key pressed by both endpoints. Physical keys only.
    pub confirm_key: PhysicalKey,
    /// Upper bound on adaptive raw-key decision rounds before failing.
    pub decision_round_bound: u32,
    pub actions: Vec<CoopScheduledAction>,
}

impl CoopCampaignV1 {
    /// Construct and validate one campaign plan.
    pub fn new(
        name: impl Into<String>,
        replay_seed: u64,
        host_seat: SeatId,
        guest_seat: SeatId,
        confirm_key: PhysicalKey,
        decision_round_bound: u32,
        actions: Vec<CoopScheduledAction>,
    ) -> Result<Self, CoopCampaignError> {
        if host_seat == guest_seat {
            return Err(CoopCampaignError::InvalidPlan(
                "host and guest seats must be distinct",
            ));
        }
        if decision_round_bound == 0 {
            return Err(CoopCampaignError::InvalidPlan(
                "decision round bound must be positive",
            ));
        }
        let campaign = Self {
            schema_version: COOP_CAMPAIGN_SCHEMA_VERSION,
            name: name.into(),
            replay_seed,
            host_seat,
            guest_seat,
            confirm_key,
            decision_round_bound,
            actions,
        };
        campaign.validate()?;
        Ok(campaign)
    }

    /// Validate anchor/action consistency: delivery anchors use one-based
    /// ordinals, and every disconnect has a later reconnect for the same
    /// endpoint.
    pub fn validate(&self) -> Result<(), CoopCampaignError> {
        if self.schema_version != COOP_CAMPAIGN_SCHEMA_VERSION {
            return Err(CoopCampaignError::SchemaVersion {
                expected: COOP_CAMPAIGN_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        for (position, entry) in self.actions.iter().enumerate() {
            match entry.anchor {
                CoopAnchor::BeforeDelivery { ordinal, .. }
                | CoopAnchor::AfterDelivery { ordinal, .. } => {
                    if ordinal == 0 {
                        return Err(CoopCampaignError::InvalidPlan(
                            "delivery anchors use one-based ordinals",
                        ));
                    }
                }
                CoopAnchor::WhenIdle => {}
            }
            if let CoopScheduledActionKind::Disconnect { endpoint } = entry.action {
                let reconnect_later = self.actions[position + 1..].iter().any(|other| {
                    matches!(other.action, CoopScheduledActionKind::Reconnect { endpoint: other_endpoint } if other_endpoint == endpoint)
                });
                if !reconnect_later {
                    return Err(CoopCampaignError::InvalidPlan(
                        "disconnect without a later reconnect for the same endpoint",
                    ));
                }
            }
        }
        Ok(())
    }

    /// Seat of an endpoint on the mechanical game boundary.
    pub const fn seat_of(&self, endpoint: CoopEndpoint) -> SeatId {
        match endpoint {
            CoopEndpoint::Host => self.host_seat,
            CoopEndpoint::Guest => self.guest_seat,
        }
    }
}

/// Ordered-ledger verdict over observed authority emissions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoopReceiptLedgerV1 {
    pub commits: Vec<CoopCommitIdentityV1>,
}

/// Identity of one accepted authority commit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoopCommitIdentityV1 {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
}

/// Verify that observed authority emissions form the exact ordered ledger a
/// healthy co-op battle must produce. Every emission originates at the
/// authority endpoint; every commit is a TURN, REPLACEMENT, or TERMINAL
/// resolution; first appearances of revisions strictly increase; and any
/// re-emission names an already-seen commit exactly (delivery retry).
pub fn verify_authority_receipt_order(
    authority_seat: SeatId,
    observed: &[(SeatId, AuthorityEntryBody)],
) -> Result<CoopReceiptLedgerV1, CoopCampaignError> {
    let mut commits = Vec::with_capacity(observed.len());
    let mut highest_revision: Option<Revision> = None;
    let mut seen_operations: BTreeSet<OperationId> = BTreeSet::new();
    for (sender, entry) in observed {
        if *sender != authority_seat {
            return Err(CoopCampaignError::ReplicaAuthorityEmission);
        }
        match entry.kind {
            AuthorityEntryKind::TurnCommit
            | AuthorityEntryKind::ReplacementCommit
            | AuthorityEntryKind::TerminalCommit => {}
            other => {
                return Err(CoopCampaignError::UnsupportedCommitKind(format!(
                    "{other:?}"
                )));
            }
        }
        if seen_operations.contains(&entry.operation_id) {
            // Exact redelivery of a known commit: idempotent by contract.
            continue;
        }
        if let Some(highest) = highest_revision
            && entry.revision <= highest
        {
            return Err(CoopCampaignError::RevisionOrderNotIncreasing);
        }
        highest_revision = Some(entry.revision);
        seen_operations.insert(entry.operation_id.clone());
        commits.push(CoopCommitIdentityV1 {
            revision: entry.revision,
            operation_id: entry.operation_id.clone(),
            kind: entry.kind,
        });
    }
    if commits.is_empty() {
        return Err(CoopCampaignError::EmptyAuthorityLedger);
    }
    Ok(CoopReceiptLedgerV1 { commits })
}

fn receipt_stage_rank(stage: &AckStage) -> u8 {
    match stage {
        AckStage::Admitted => 0,
        AckStage::MaterialApplied => 1,
        AckStage::ControlInstalled => 2,
        AckStage::PresentationSettled => 3,
    }
}

/// Verify replica receipts: only the replica acknowledges, every acknowledged
/// revision belongs to the committed ledger, and every material commit is
/// fully installed (acknowledged through control installation or later).
/// Redelivered receipt copies legitimately re-observe earlier stages, so the
/// proof tracks the highest stage each revision reached.
pub fn verify_replica_receipt_order(
    replica_seat: SeatId,
    committed: &CoopReceiptLedgerV1,
    receipts: &[(SeatId, AuthorityReceiptBody)],
) -> Result<(), CoopCampaignError> {
    use std::collections::BTreeMap;
    let material_revisions: BTreeMap<u64, ()> = committed
        .commits
        .iter()
        .filter(|commit| {
            matches!(
                commit.kind,
                AuthorityEntryKind::TurnCommit | AuthorityEntryKind::ReplacementCommit
            )
        })
        .map(|commit| (commit.revision.get().get(), ()))
        .collect();
    let known: BTreeSet<u64> = committed
        .commits
        .iter()
        .map(|commit| commit.revision.get().get())
        .collect();
    let mut highest_stage: BTreeMap<u64, u8> = BTreeMap::new();
    for (sender, receipt) in receipts {
        if *sender != replica_seat {
            return Err(CoopCampaignError::ReplicaAuthorityEmission);
        }
        let revision = receipt.revision.get().get();
        if !known.contains(&revision) {
            return Err(CoopCampaignError::UnknownReceiptRevision(revision));
        }
        let rank = receipt_stage_rank(&receipt.stage);
        let slot = highest_stage.entry(revision).or_insert(rank);
        *slot = (*slot).max(rank);
    }
    for revision in material_revisions.keys() {
        let installed = highest_stage
            .get(revision)
            .is_some_and(|rank| *rank >= receipt_stage_rank(&AckStage::ControlInstalled));
        if !installed {
            return Err(CoopCampaignError::ReceiptStageOutOfOrder(*revision));
        }
    }
    Ok(())
}

/// Independent replica reconstructed purely from serialized authority
/// commits through the common role-neutral material applier.
///
/// The candidate never observes a kernel, a fixture answer, or a reducer:
/// it consumes exactly the bytes the authority published. Its first commit
/// seeds the declared material boundary (`before_state`,
/// `menu_allocators_before`) after the applier has independently validated
/// that boundary against the immutable content pack and oracle identity;
/// every later commit is applied against the chained frontier.
#[derive(Clone, Debug)]
pub struct CoopCandidateReplayV1 {
    local_seat: SeatId,
    current_state: Option<GameState>,
    menu_allocators: Option<Vec<SeatMenuInstanceAllocator>>,
    applied: Vec<CoopCommitIdentityV1>,
}

impl CoopCandidateReplayV1 {
    /// A candidate that will seed itself from the first committed boundary.
    pub fn new(local_seat: SeatId) -> Self {
        Self {
            local_seat,
            current_state: None,
            menu_allocators: None,
            applied: Vec::new(),
        }
    }

    /// Commits applied so far, in receipt order.
    pub fn frontier(&self) -> &[CoopCommitIdentityV1] {
        &self.applied
    }

    /// Mechanical state after the last applied commit.
    pub fn current_state(&self) -> Option<&GameState> {
        self.current_state.as_ref()
    }

    /// Apply one host-issued commit from its exact serialized payload through
    /// the same applier both kernels use, and prove the published material
    /// digest names exactly these canonical bytes.
    ///
    /// The mechanical state chains across commits (every `before_digest` is
    /// re-verified against the immutable content pack), while the endpoint
    /// menu-allocator view is taken from each material's own applier-validated
    /// `menu_allocators_before`, exactly like a replica resynchronizing its
    /// local frontier from received Authority V2 entries.
    pub fn apply_commit(
        &mut self,
        entry: &AuthorityEntryBody,
        content: &er_content::pack::ContentPack,
    ) -> Result<MaterialApplyResult, CoopCampaignError> {
        let context = match (&self.current_state, &self.menu_allocators) {
            (Some(state), Some(_)) => BattleMaterialApplyContext {
                current_state: state.clone(),
                local_seat: self.local_seat,
                menu_allocators: seed_allocators(entry)?,
            },
            (None, None) => BattleMaterialApplyContext {
                current_state: seed_state(entry)?,
                local_seat: self.local_seat,
                menu_allocators: seed_allocators(entry)?,
            },
            _ => return Err(CoopCampaignError::CandidateFrontierCorrupt),
        };

        let result = match entry.kind {
            AuthorityEntryKind::TurnCommit => {
                let material: BattleTurnMaterialV1 =
                    serde_json::from_value(entry.material.payload.clone()).map_err(|error| {
                        CoopCampaignError::SerializedMaterial(error.to_string())
                    })?;
                let digest = turn_material_digest(&material)?;
                if digest != entry.material.digest {
                    return Err(CoopCampaignError::MaterialDigestMismatch);
                }
                apply_turn_material(&context, &material, content)?
            }
            AuthorityEntryKind::ReplacementCommit => {
                let material: BattleReplacementMaterialV1 =
                    serde_json::from_value(entry.material.payload.clone()).map_err(|error| {
                        CoopCampaignError::SerializedMaterial(error.to_string())
                    })?;
                let digest = replacement_material_digest(&material)?;
                if digest != entry.material.digest {
                    return Err(CoopCampaignError::MaterialDigestMismatch);
                }
                apply_replacement_material(&context, &material, content)?
            }
            other => {
                return Err(CoopCampaignError::UnsupportedCommitKind(format!(
                    "{other:?}"
                )));
            }
        };

        self.current_state = Some(result.after_state.clone());
        self.menu_allocators = Some(result.menu_allocators.clone());
        self.applied.push(CoopCommitIdentityV1 {
            revision: entry.revision,
            operation_id: entry.operation_id.clone(),
            kind: entry.kind,
        });
        Ok(result)
    }
}

fn seed_state(entry: &AuthorityEntryBody) -> Result<GameState, CoopCampaignError> {
    let before = entry
        .material
        .payload
        .get("before_state")
        .ok_or(CoopCampaignError::MissingSeedBoundary)?;
    serde_json::from_value(before.clone()).map_err(|error| {
        CoopCampaignError::SerializedMaterial(format!("before_state seed: {error}"))
    })
}

fn seed_allocators(
    entry: &AuthorityEntryBody,
) -> Result<Vec<SeatMenuInstanceAllocator>, CoopCampaignError> {
    let before = entry
        .material
        .payload
        .get("menu_allocators_before")
        .ok_or(CoopCampaignError::MissingSeedBoundary)?;
    serde_json::from_value(before.clone()).map_err(|error| {
        CoopCampaignError::SerializedMaterial(format!("menu_allocators_before seed: {error}"))
    })
}

/// Proof that one applied commit reproduces the exact host and guest
/// mechanical observations from serialized evidence alone.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoopCommitParityV1 {
    pub after_digest: String,
    pub presentation_digest: String,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
}

/// Compare one candidate-applied commit against both live endpoints' exact
/// mechanical observations (`game` and `control` values from the kernel
/// snapshot boundary). Every field must match byte-for-byte as JSON.
pub fn verify_commit_parity(
    candidate: &MaterialApplyResult,
    operation_id: &OperationId,
    kind: AuthorityEntryKind,
    host_game: &serde_json::Value,
    host_control: &serde_json::Value,
    guest_game: &serde_json::Value,
    guest_control: &serde_json::Value,
) -> Result<CoopCommitParityV1, CoopCampaignError> {
    let candidate_game = serde_json::to_value(&candidate.after_state)
        .map_err(|error| CoopCampaignError::SerializedObservation(error.to_string()))?;
    let candidate_control = serde_json::to_value(&candidate.next_control)
        .map_err(|error| CoopCampaignError::SerializedObservation(error.to_string()))?;
    for (field, candidate_value, host_value, guest_value) in [
        ("game", &candidate_game, host_game, guest_game),
        ("control", &candidate_control, host_control, guest_control),
    ] {
        if candidate_value != host_value {
            return Err(CoopCampaignError::CommitParityMismatch {
                field,
                side: "host".to_owned(),
                operation_id: operation_id.clone(),
            });
        }
        if candidate_value != guest_value {
            return Err(CoopCampaignError::CommitParityMismatch {
                field,
                side: "guest".to_owned(),
                operation_id: operation_id.clone(),
            });
        }
    }
    Ok(CoopCommitParityV1 {
        after_digest: candidate.after_digest.as_str().to_owned(),
        presentation_digest: candidate.presentation_digest.as_str().to_owned(),
        operation_id: operation_id.clone(),
        kind,
    })
}

/// Ordered replay-trace digest. Each step folds its canonical observation
/// bytes into an FNV-1a64 chain so two campaigns are trace-identical only if
/// every step produced byte-identical effects in the same order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoopTraceDigestV1 {
    pub value: String,
}

const TRACE_DIGEST_PREFIX: &str = "fnv1a64-v1:";
const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01B3;

impl CoopTraceDigestV1 {
    /// Digest of the empty trace.
    pub fn empty() -> Self {
        Self {
            value: format!("{TRACE_DIGEST_PREFIX}{FNV_OFFSET_BASIS:016x}"),
        }
    }

    /// Fold one step's canonical observation bytes into the chain.
    pub fn fold(&self, step_bytes: &[u8]) -> Self {
        let mut hash = self.current_bits();
        for byte in step_bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        Self {
            value: format!("{TRACE_DIGEST_PREFIX}{hash:016x}"),
        }
    }

    fn current_bits(&self) -> u64 {
        self.value[TRACE_DIGEST_PREFIX.len()..]
            .get(..16)
            .and_then(|hex| u64::from_str_radix(hex, 16).ok())
            .unwrap_or(FNV_OFFSET_BASIS)
    }
}

impl From<BattleMaterialApplyError> for CoopCampaignError {
    fn from(error: BattleMaterialApplyError) -> Self {
        CoopCampaignError::MaterialApply(error)
    }
}

impl From<BattleMaterialCodecError> for CoopCampaignError {
    fn from(error: BattleMaterialCodecError) -> Self {
        CoopCampaignError::MaterialDigest(error.to_string())
    }
}

/// Closed failure categories of the co-op campaign model.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CoopCampaignError {
    #[error("campaign plan schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("campaign plan is invalid: {0}")]
    InvalidPlan(&'static str),
    #[error("a non-authority endpoint emitted an authority commit")]
    ReplicaAuthorityEmission,
    #[error("authority revisions do not strictly increase across the ledger")]
    RevisionOrderNotIncreasing,
    #[error("campaign completed without a single authority commit")]
    EmptyAuthorityLedger,
    #[error("commit kind {0} is not part of the battle co-op grammar")]
    UnsupportedCommitKind(String),
    #[error("serialized material payload does not decode into its typed material: {0}")]
    SerializedMaterial(String),
    #[error("published material digest does not name its exact canonical bytes")]
    MaterialDigestMismatch,
    #[error("material digest canonicalization failed: {0}")]
    MaterialDigest(String),
    #[error("first commit does not declare a seed boundary")]
    MissingSeedBoundary,
    #[error("candidate frontier is corrupt: state and allocator seeds disagree")]
    CandidateFrontierCorrupt,
    #[error("common material applier rejected a serialized commit: {0}")]
    MaterialApply(BattleMaterialApplyError),
    #[error("candidate {field} diverged from the {side} observation at {operation_id}")]
    CommitParityMismatch {
        field: &'static str,
        side: String,
        operation_id: OperationId,
    },
    #[error("kernel observation serialization failed: {0}")]
    SerializedObservation(String),
    #[error("replica acknowledged revision {0} that the authority never committed")]
    UnknownReceiptRevision(u64),
    #[error("replica acknowledgement stages for revision {0} arrived out of order")]
    ReceiptStageOutOfOrder(u64),
}
