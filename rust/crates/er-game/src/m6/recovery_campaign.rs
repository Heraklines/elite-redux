//! M6D Snapshot V5 recovery campaigns.
//!
//! This module owns the deterministic continuation-campaign contract for
//! Snapshot V5 recovery boundaries. It is pure: no clock, thread, RNG, or
//! live runtime owner is reachable from here. The module provides
//!
//! 1. [`RecoveryBoundaryKind`] — the eight frozen recovery boundaries,
//! 2. [`RecoveryCampaign`] — physical-key-only campaign scripts split into a
//!    setup phase that reaches the boundary and a continuation phase that is
//!    replayed identically by the native runtime and the restored runtime,
//! 3. the canonical frontier seam — [`capture_frontier_v5`] chains the frozen
//!    M3→M4→V3→M6 migrations over a live mechanical frontier with zero RNG
//!    consumption, and [`verify_restored_frontier_v5`] requires a restored
//!    runtime to reproduce the captured [`GameStateV4`] frontier exactly,
//! 4. [`assert_continuation_identical`] — fail-closed, axis-by-axis
//!    comparison of native versus restored continuation evidence (ordered
//!    effects, ordered RNG audit, causal internal-event audit, per-endpoint
//!    state digests, next control, and complete endpoint snapshots), and
//! 5. [`apply_snapshot_v5_tamper`] — pure wire tampering vectors used to
//!    prove that a tampered Snapshot V5 envelope fails closed.
//!
//! Campaigns carry physical key input only. Presentation settlement, packet
//! delivery, transport changes, timer firings, and disposal are environment
//! callbacks of the virtual scheduler/network harness and are modelled as
//! explicit campaign steps rather than hidden semantic choices.

use er_canonical::content_digest;
use er_state::migration::{M3ToM4MigrationContext, migrate_m3_game_state};
use er_state::migration_v3::{GameStateV3, migrate_game_v2_to_v3};
use er_state::migration_v4::{
    GameStateV4, MigrationEvidenceV4, M5ToM6MigrationContext, migrate_m5_to_m6,
};
use er_state::snapshot::GameState as GameStateV1;
use er_types::PhysicalKey;
use serde_json::Value;
use thiserror::Error;

/// Domain separator prefix for recovery-campaign canonical digests.
pub const RECOVERY_FRONTIER_DIGEST_PREFIX: &str = "blake3-v1:";

/// The eight frozen Snapshot V5 recovery boundaries.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum RecoveryBoundaryKind {
    /// A physical key is held down (pressed, not yet released) with its
    /// router lock, held-button owner, and repeat timer live.
    HeldKey,
    /// A replica seat has collected its command and queued proposals that
    /// the authority has not yet received.
    CollectedCommand,
    /// The authority admission ledger holds an admitted remote proposal
    /// while the frontier has not advanced.
    AdmittedProposal,
    /// Committed authority material/control sits in the virtual network
    /// while a stale replica has not observed it.
    DelayedMaterialControl,
    /// A forced-replacement decision menu is open on the projected control
    /// surface.
    ReplacementSelection,
    /// The replica recovery transaction holds its production fence.
    RecoveryFence,
    /// Presentation barriers are installed and awaiting renderer outcomes.
    PendingPresentation,
    /// Terminal teardown: the endpoint is disposed, resource-free, and
    /// absorbing further input.
    TerminalTeardown,
}

/// Every recovery boundary, in frozen campaign order.
pub const RECOVERY_BOUNDARY_KINDS: [RecoveryBoundaryKind; 8] = [
    RecoveryBoundaryKind::HeldKey,
    RecoveryBoundaryKind::CollectedCommand,
    RecoveryBoundaryKind::AdmittedProposal,
    RecoveryBoundaryKind::DelayedMaterialControl,
    RecoveryBoundaryKind::ReplacementSelection,
    RecoveryBoundaryKind::RecoveryFence,
    RecoveryBoundaryKind::PendingPresentation,
    RecoveryBoundaryKind::TerminalTeardown,
];

impl RecoveryBoundaryKind {
    /// Stable campaign identifier for handoff evidence.
    pub fn id(self) -> &'static str {
        match self {
            Self::HeldKey => "held-key",
            Self::CollectedCommand => "collected-command",
            Self::AdmittedProposal => "admitted-proposal",
            Self::DelayedMaterialControl => "delayed-material-control",
            Self::ReplacementSelection => "replacement-selection",
            Self::RecoveryFence => "recovery-fence",
            Self::PendingPresentation => "pending-presentation",
            Self::TerminalTeardown => "terminal-teardown",
        }
    }
}

/// Endpoint selector used by campaign steps.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum CampaignEndpoint {
    /// The authority seat (host).
    Authority,
    /// The replica seat (guest).
    Replica,
}

/// One deterministic campaign step.
///
/// Key steps are raw physical input. All other steps are environment
/// callbacks of the virtual scheduler/network harness (packet delivery,
/// transport state, recovery-class timer firings, presentation settlement,
/// endpoint disposal); none of them carries a semantic battle choice.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStep {
    /// Physical keydown on an endpoint.
    KeyDown {
        /// Target endpoint.
        endpoint: CampaignEndpoint,
        /// Physical key code.
        code: PhysicalKey,
        /// Whether the key is printable text input.
        printable: bool,
    },
    /// Physical keyup on an endpoint.
    KeyUp {
        /// Target endpoint.
        endpoint: CampaignEndpoint,
        /// Physical key code.
        code: PhysicalKey,
    },
    /// Full press (keydown followed by keyup).
    Press {
        /// Target endpoint.
        endpoint: CampaignEndpoint,
        /// Physical key code.
        code: PhysicalKey,
        /// Whether the key is printable text input.
        printable: bool,
    },
    /// Deliver up to `count` queued packets in queue order.
    DeliverPackets {
        /// Maximum packet deliveries; [`ALL_PACKETS`] delivers everything.
        count: usize,
    },
    /// Deliver queued packets until only authority-entry frames remain.
    /// Used to stage committed material/control behind in the network.
    DeliverNonAuthorityPackets,
    /// Transport connectivity change; connects allocate the next connection
    /// generation and inform both endpoints.
    TransportChange {
        /// Endpoint whose link changes.
        endpoint: CampaignEndpoint,
        /// Connected after the change.
        connected: bool,
    },
    /// Fire every pending scheduled timer of an endpoint once, in ascending
    /// timer-id order (virtual scheduler callback).
    FireScheduledTimers {
        /// Target endpoint.
        endpoint: CampaignEndpoint,
    },
    /// Settle every outstanding presentation barrier on both endpoints
    /// (renderer callback), then drain the network.
    SettlePendingPresentations,
    /// Dispose both endpoints (terminal teardown).
    DisposeEndpoints,
}

/// Packet-count sentinel meaning "drain the entire queue".
pub const ALL_PACKETS: usize = usize::MAX;

/// A Snapshot V5 recovery campaign: the setup reaching the boundary and the
/// continuation replayed by both runtimes after restoration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryCampaign {
    /// Stable campaign identifier.
    pub id: &'static str,
    /// The boundary this campaign snapshots at.
    pub boundary: RecoveryBoundaryKind,
    /// Steps executed before the Snapshot V5 boundary capture.
    pub setup: Vec<CampaignStep>,
    /// Steps executed identically by the native runtime and the restored
    /// runtime after the boundary; every step produces compared evidence.
    pub continuation: Vec<CampaignStep>,
}

/// The canonical Snapshot V5 frontier captured from one live endpoint.
#[derive(Clone, Debug)]
pub struct CapturedFrontierV5 {
    /// Canonical M6 game frontier migrated from the live mechanical state.
    pub game_v4: GameStateV4,
    /// The migrated M4/V3 canonical layer retained for Snapshot V5 base
    /// assembly (`RestorableKernelSnapshotV5.base.game_v3`).
    pub game_v3: GameStateV3,
    /// Zero-RNG migration evidence for the capture.
    pub migration_evidence: MigrationEvidenceV4,
    /// Canonical digest over the migrated frontier bytes.
    pub frontier_digest: String,
    /// Canonical digest over the prepared-content identity tuple.
    pub prepared_identity_digest: String,
}

/// Build the campaign for one boundary.
pub fn campaign(boundary: RecoveryBoundaryKind) -> RecoveryCampaign {
    let (id, setup, continuation) = match boundary {
        RecoveryBoundaryKind::HeldKey => (
            "m6d-recovery/held-key",
            vec![
                connect(),
                CampaignStep::KeyDown {
                    endpoint: CampaignEndpoint::Authority,
                    code: PhysicalKey::Enter,
                    printable: false,
                },
            ],
            vec![
                key_up_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                deliver_all(),
                settle_presentations(),
            ],
        ),
        RecoveryBoundaryKind::CollectedCommand => (
            "m6d-recovery/collected-command",
            vec![
                connect(),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
            ],
            vec![
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                deliver_all(),
                settle_presentations(),
            ],
        ),
        RecoveryBoundaryKind::AdmittedProposal => (
            "m6d-recovery/admitted-proposal",
            vec![
                connect(),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                deliver_all(),
            ],
            vec![
                press_enter(CampaignEndpoint::Authority),
                deliver_all(),
                settle_presentations(),
            ],
        ),
        RecoveryBoundaryKind::DelayedMaterialControl => (
            "m6d-recovery/delayed-material-control",
            vec![
                connect(),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                deliver_non_authority_packets(),
            ],
            vec![deliver_all(), settle_presentations(), deliver_all()],
        ),
        RecoveryBoundaryKind::ReplacementSelection => (
            "m6d-recovery/replacement-selection",
            vec![
                connect(),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                deliver_non_authority_packets(),
                deliver_all(),
                settle_presentations(),
            ],
            vec![
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                deliver_all(),
                settle_presentations(),
            ],
        ),
        RecoveryBoundaryKind::RecoveryFence => (
            "m6d-recovery/recovery-fence",
            vec![
                connect(),
                CampaignStep::TransportChange {
                    endpoint: CampaignEndpoint::Replica,
                    connected: false,
                },
            ],
            vec![
                CampaignStep::FireScheduledTimers {
                    endpoint: CampaignEndpoint::Replica,
                },
                CampaignStep::TransportChange {
                    endpoint: CampaignEndpoint::Replica,
                    connected: true,
                },
                deliver_all(),
            ],
        ),
        RecoveryBoundaryKind::PendingPresentation => (
            "m6d-recovery/pending-presentation",
            vec![
                connect(),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                deliver_non_authority_packets(),
                deliver_all(),
            ],
            vec![settle_presentations(), deliver_all()],
        ),
        RecoveryBoundaryKind::TerminalTeardown => (
            "m6d-recovery/terminal-teardown",
            vec![
                connect(),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Replica),
                deliver_non_authority_packets(),
                deliver_all(),
                settle_presentations(),
                CampaignStep::DisposeEndpoints,
            ],
            vec![
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Replica),
                press_enter(CampaignEndpoint::Authority),
                press_enter(CampaignEndpoint::Replica),
            ],
        ),
    };
    RecoveryCampaign {
        id,
        boundary,
        setup,
        continuation,
    }
}

/// Every campaign, in [`RECOVERY_BOUNDARY_KINDS`] order.
pub fn recovery_campaigns() -> Vec<RecoveryCampaign> {
    RECOVERY_BOUNDARY_KINDS.map(campaign).to_vec()
}

fn connect() -> CampaignStep {
    CampaignStep::TransportChange {
        endpoint: CampaignEndpoint::Authority,
        connected: true,
    }
}

fn press_enter(endpoint: CampaignEndpoint) -> CampaignStep {
    CampaignStep::Press {
        endpoint,
        code: PhysicalKey::Enter,
        printable: false,
    }
}

fn key_up_enter(endpoint: CampaignEndpoint) -> CampaignStep {
    CampaignStep::KeyUp {
        endpoint,
        code: PhysicalKey::Enter,
    }
}

fn deliver_all() -> CampaignStep {
    CampaignStep::DeliverPackets { count: ALL_PACKETS }
}

fn deliver_non_authority_packets() -> CampaignStep {
    CampaignStep::DeliverNonAuthorityPackets
}

fn settle_presentations() -> CampaignStep {
    CampaignStep::SettlePendingPresentations
}

/// Frozen migration contexts plus the exact content identities needed to
/// lift a live mechanical frontier onto the canonical Snapshot V5 chain.
#[derive(Clone, Debug)]
pub struct RecoveryFrontierContexts {
    /// M3 → M4 companion evidence and run identity.
    pub m3_to_m4: M3ToM4MigrationContext,
    /// Exact battle-content hash string shared by the V2/V3 layers.
    pub battle_content_hash_v2: String,
    /// M5 → M6 program-binding context pinning the prepared-content identity.
    pub m5_to_m6: M5ToM6MigrationContext,
}


/// Capture the canonical Snapshot V5 frontier of a live mechanical state.
///
/// The chain is the frozen production migration ladder:
/// `GameState` → [`migrate_m3_game_state`] → `GameStateV2` →
/// [`migrate_game_v2_to_v3`] → `GameStateV3` → [`migrate_m5_to_m6`] →
/// [`GameStateV4`]. Migration consumes zero RNG; the returned evidence pins
/// that invariant.
pub fn capture_frontier_v5(
    state_v1: &GameStateV1,
    contexts: &RecoveryFrontierContexts,
) -> Result<CapturedFrontierV5, RecoveryCampaignError> {
    let state_v2 = migrate_m3_game_state(state_v1, &contexts.m3_to_m4)
        .map_err(|error| RecoveryCampaignError::Frontier(format!("M3 to M4: {error}")))?;
    if state_v2.battle_content_hash.as_str() != contexts.battle_content_hash_v2 {
        return Err(RecoveryCampaignError::ContentIdentity(format!(
            "migrated V2 battle content {} does not match the campaign content identity {}",
            state_v2.battle_content_hash.as_str(),
            contexts.battle_content_hash_v2
        )));
    }
    let (state_v3, _) =
        migrate_game_v2_to_v3(&state_v2, contexts.battle_content_hash_v2.clone())
            .map_err(|error| RecoveryCampaignError::Frontier(format!("M4 to V3: {error}")))?;
    let (game_v4, migration_evidence) = migrate_m5_to_m6(&state_v3, &contexts.m5_to_m6)
        .map_err(|error| RecoveryCampaignError::Frontier(format!("M5 to M6: {error}")))?;
    if migration_evidence.rng_draws != 0 {
        return Err(RecoveryCampaignError::Frontier(format!(
            "frontier migration consumed {} RNG draws; the chain must consume zero",
            migration_evidence.rng_draws
        )));
    }
    let frontier_digest = format!(
        "{RECOVERY_FRONTIER_DIGEST_PREFIX}{}",
        content_digest(&game_v4)
            .map_err(|error| RecoveryCampaignError::Digest(error.to_string()))?
    );
    let prepared_identity_digest = prepared_identity_digest(&game_v4)?;
    Ok(CapturedFrontierV5 {
        game_v3: state_v3,
        game_v4,
        migration_evidence,
        frontier_digest,
        prepared_identity_digest,
    })
}

/// Require that a restored mechanical frontier reproduces a captured
/// canonical Snapshot V5 frontier exactly.
///
/// The frontier is rebuilt through the same frozen migration ladder and
/// compared by value, by canonical digest, and by zero-RNG evidence. Any
/// divergence fails closed.
pub fn verify_restored_frontier_v5(
    restored_state_v1: &GameStateV1,
    captured: &CapturedFrontierV5,
    contexts: &RecoveryFrontierContexts,
) -> Result<(), RecoveryCampaignError> {
    let reproduced = capture_frontier_v5(restored_state_v1, contexts)?;
    if reproduced.game_v4 != captured.game_v4 {
        return Err(RecoveryCampaignError::Frontier(
            "restored runtime did not reproduce the captured GameStateV4 frontier".to_owned(),
        ));
    }
    if reproduced.frontier_digest != captured.frontier_digest {
        return Err(RecoveryCampaignError::Digest(
            "restored runtime frontier digest diverged from the captured digest".to_owned(),
        ));
    }
    if reproduced.prepared_identity_digest != captured.prepared_identity_digest {
        return Err(RecoveryCampaignError::ContentIdentity(
            "restored runtime prepared-content identity diverged from the captured identity"
                .to_owned(),
        ));
    }
    Ok(())
}

fn prepared_identity_digest(game_v4: &GameStateV4) -> Result<String, RecoveryCampaignError> {
    let identity = serde_json::json!({
        "battle_content_hash_v3": game_v4.battle_content_hash_v3.as_str(),
        "semantic_catalog_hash": game_v4.semantic_catalog_hash.as_str(),
    });
    Ok(format!(
        "{RECOVERY_FRONTIER_DIGEST_PREFIX}{}",
        content_digest(&identity)
            .map_err(|error| RecoveryCampaignError::Digest(error.to_string()))?
    ))
}

/// One continuation step's compared evidence. Every field is an ordered,
/// canonical observation of one parity axis; "wire" fields are canonical
/// JSON bytes of the corresponding ordered runtime observations.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContinuationStep {
    /// Step label shared by both runtimes.
    pub label: String,
    /// Ordered kernel-effect bytes emitted by this step (both endpoints).
    pub effects_wire: Vec<u8>,
    /// Ordered RNG-draw audit bytes accumulated since the boundary.
    pub rng_audit_wire: Vec<u8>,
    /// Ordered causal internal-event audit accumulated since the boundary.
    pub internal_events: Vec<String>,
    /// Authority endpoint mechanical state digest.
    pub state_digest_authority: String,
    /// Replica endpoint mechanical state digest.
    pub state_digest_replica: String,
    /// Next-control plan bytes (authority then replica).
    pub next_control_wire: Vec<u8>,
    /// Complete restorable endpoint snapshot bytes (authority then replica);
    /// covers input/router, scheduler, protocol/network, presentation, UI,
    /// terminal, and the three endpoint digests.
    pub endpoint_snapshot_wire: Vec<u8>,
}

/// The parity axis that diverged between native and restored continuation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContinuationAxis {
    /// Ordered effect stream.
    Effects,
    /// Ordered RNG draw audit.
    RngAudit,
    /// Causal internal-event audit.
    InternalEvents,
    /// Authority mechanical state digest.
    AuthorityStateDigest,
    /// Replica mechanical state digest.
    ReplicaStateDigest,
    /// Next control plan.
    NextControl,
    /// Complete endpoint owner-graph snapshot.
    EndpointSnapshot,
}

/// A fail-closed continuation mismatch.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
#[error(
    "continuation diverged at step {step_index} ({step_label}) on axis {axis:?}: {detail}"
)]
pub struct ContinuationMismatch {
    /// Index of the diverging continuation step.
    pub step_index: usize,
    /// Label of the diverging continuation step.
    pub step_label: String,
    /// Diverging parity axis.
    pub axis: ContinuationAxis,
    /// Divergence detail.
    pub detail: String,
}

/// Compare native and restored continuation evidence axis by axis.
///
/// Comparison is ordered and fail-closed: the first diverging axis aborts
/// with a precise mismatch. Final-digest-only agreement is not accepted —
/// every axis must agree at every step.
pub fn assert_continuation_identical(
    native: &[ContinuationStep],
    restored: &[ContinuationStep],
) -> Result<(), ContinuationMismatch> {
    if native.len() != restored.len() {
        return Err(ContinuationMismatch {
            step_index: native.len().min(restored.len()),
            step_label: native
                .get(restored.len())
                .or_else(|| restored.get(native.len()))
                .map(|step| step.label.clone())
                .unwrap_or_default(),
            axis: ContinuationAxis::Effects,
            detail: format!(
                "step count diverged: native {} vs restored {}",
                native.len(),
                restored.len()
            ),
        });
    }
    for (index, (expected, actual)) in native.iter().zip(restored.iter()).enumerate() {
        let mismatch =
            |axis: ContinuationAxis, detail: String| ContinuationMismatch {
                step_index: index,
                step_label: expected.label.clone(),
                axis,
                detail,
            };
        if expected.label != actual.label {
            return Err(mismatch(
                ContinuationAxis::Effects,
                format!("label diverged: {:?} vs {:?}", expected.label, actual.label),
            ));
        }
        if expected.effects_wire != actual.effects_wire {
            return Err(mismatch(
                ContinuationAxis::Effects,
                "ordered effect bytes diverged".to_owned(),
            ));
        }
        if expected.rng_audit_wire != actual.rng_audit_wire {
            return Err(mismatch(
                ContinuationAxis::RngAudit,
                "ordered RNG audit bytes diverged".to_owned(),
            ));
        }
        if expected.internal_events != actual.internal_events {
            return Err(mismatch(
                ContinuationAxis::InternalEvents,
                "causal internal-event audit diverged".to_owned(),
            ));
        }
        if expected.state_digest_authority != actual.state_digest_authority {
            return Err(mismatch(
                ContinuationAxis::AuthorityStateDigest,
                "authority state digest diverged".to_owned(),
            ));
        }
        if expected.state_digest_replica != actual.state_digest_replica {
            return Err(mismatch(
                ContinuationAxis::ReplicaStateDigest,
                "replica state digest diverged".to_owned(),
            ));
        }
        if expected.next_control_wire != actual.next_control_wire {
            return Err(mismatch(
                ContinuationAxis::NextControl,
                "next-control plan bytes diverged".to_owned(),
            ));
        }
        if expected.endpoint_snapshot_wire != actual.endpoint_snapshot_wire {
            return Err(mismatch(
                ContinuationAxis::EndpointSnapshot,
                "complete endpoint snapshot bytes diverged".to_owned(),
            ));
        }
    }
    Ok(())
}

/// Wire tampering vectors proving Snapshot V5 envelopes fail closed.
///
/// Every vector performs a deterministic, structure-preserving mutation of a
/// serialized recovery envelope (`{"kernel": …, "frontier": …}`) so that a
/// downstream validator must reject the envelope instead of repairing it.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum SnapshotV5TamperVector {
    /// Bump the frontier schema version.
    FrontierSchemaVersion,
    /// Bump the mechanics program version.
    MechanicsProgramVersion,
    /// Bump the mechanic-state schema version.
    MechanicStateSchemaVersion,
    /// Swap the prepared battle-content identity hash.
    PreparedBattleContentHash,
    /// Swap the prepared semantic-catalog identity hash.
    SemanticCatalogHash,
    /// Mutate the canonical `game_v4` frontier so it stops matching the
    /// embedded base snapshot frontier.
    CanonicalGameFrontier,
    /// Mutate the base V3 canonical frontier so it stops matching `game_v4`.
    BaseCanonicalFrontier,
    /// Bump the embedded kernel endpoint snapshot schema version.
    KernelEndpointSchema,
}

impl SnapshotV5TamperVector {
    /// Stable vector identifier for evidence.
    pub fn id(self) -> &'static str {
        match self {
            Self::FrontierSchemaVersion => "frontier-schema-version",
            Self::MechanicsProgramVersion => "mechanics-program-version",
            Self::MechanicStateSchemaVersion => "mechanic-state-schema-version",
            Self::PreparedBattleContentHash => "prepared-battle-content-hash",
            Self::SemanticCatalogHash => "semantic-catalog-hash",
            Self::CanonicalGameFrontier => "canonical-game-frontier",
            Self::BaseCanonicalFrontier => "base-canonical-frontier",
            Self::KernelEndpointSchema => "kernel-endpoint-schema",
        }
    }
}

/// All tamper vectors, in frozen order.
pub const SNAPSHOT_V5_TAMPER_VECTORS: [SnapshotV5TamperVector; 8] = [
    SnapshotV5TamperVector::FrontierSchemaVersion,
    SnapshotV5TamperVector::MechanicsProgramVersion,
    SnapshotV5TamperVector::MechanicStateSchemaVersion,
    SnapshotV5TamperVector::PreparedBattleContentHash,
    SnapshotV5TamperVector::SemanticCatalogHash,
    SnapshotV5TamperVector::CanonicalGameFrontier,
    SnapshotV5TamperVector::BaseCanonicalFrontier,
    SnapshotV5TamperVector::KernelEndpointSchema,
];

/// Apply one deterministic tampering vector to a serialized recovery
/// envelope, returning the mutated wire value.
pub fn apply_snapshot_v5_tamper(
    envelope: &Value,
    vector: SnapshotV5TamperVector,
) -> Result<Value, RecoveryCampaignError> {
    let mut tampered = envelope.clone();
    let missing = || RecoveryCampaignError::Tamper {
        vector: vector.id().to_owned(),
        detail: "expected envelope path is missing".to_owned(),
    };
    match vector {
        SnapshotV5TamperVector::FrontierSchemaVersion => {
            let version = path_u64(&tampered, &["frontier", "schema_version"])
                .ok_or_else(missing)?;
            *path_mut(&mut tampered, &["frontier", "schema_version"]).ok_or_else(missing)? =
                Value::from(version + 1);
        }
        SnapshotV5TamperVector::MechanicsProgramVersion => {
            let version = path_u64(&tampered, &["frontier", "mechanics_program_version"])
                .ok_or_else(missing)?;
            *path_mut(&mut tampered, &["frontier", "mechanics_program_version"])
                .ok_or_else(missing)? = Value::from(version + 1);
        }
        SnapshotV5TamperVector::MechanicStateSchemaVersion => {
            let version =
                path_u64(&tampered, &["frontier", "mechanic_state_schema_version"])
                    .ok_or_else(missing)?;
            *path_mut(&mut tampered, &["frontier", "mechanic_state_schema_version"])
                .ok_or_else(missing)? = Value::from(version + 1);
        }
        SnapshotV5TamperVector::PreparedBattleContentHash => {
            *path_mut(
                &mut tampered,
                &["frontier", "prepared_content", "battle_content_hash"],
            )
            .ok_or_else(missing)? = Value::from(decoy_battle_content_hash());
        }
        SnapshotV5TamperVector::SemanticCatalogHash => {
            *path_mut(
                &mut tampered,
                &["frontier", "prepared_content", "semantic_catalog_hash"],
            )
            .ok_or_else(missing)? = Value::from(decoy_catalog_hash());
        }
        SnapshotV5TamperVector::CanonicalGameFrontier => {
            bump_mode(
                &mut tampered,
                &["frontier", "game_v4", "base", "schema_version"],
                missing,
            )?;
        }
        SnapshotV5TamperVector::BaseCanonicalFrontier => {
            bump_mode(
                &mut tampered,
                &["frontier", "base", "game_v3", "base", "schema_version"],
                missing,
            )?;
        }
        SnapshotV5TamperVector::KernelEndpointSchema => {
            let version = path_u64(&tampered, &["kernel", "schema_version"])
                .ok_or_else(missing)?;
            *path_mut(&mut tampered, &["kernel", "schema_version"]).ok_or_else(missing)? =
                Value::from(version + 1);
        }
    }
    Ok(tampered)
}

fn decoy_battle_content_hash() -> String {
    format!("blake3-v3:{}", "f".repeat(64))
}

fn decoy_catalog_hash() -> String {
    "f".repeat(64)
}

fn path_u64(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_u64()
}

fn path_mut<'a>(value: &'a mut Value, path: &[&str]) -> Option<&'a mut Value> {
    let mut current = value;
    for segment in path {
        current = current.get_mut(*segment)?;
    }
    Some(current)
}

fn bump_mode(
    envelope: &mut Value,
    path: &[&str],
    missing: impl Fn() -> RecoveryCampaignError,
) -> Result<(), RecoveryCampaignError> {
    let mode = path_u64(envelope, path).ok_or_else(&missing)?;
    *path_mut(envelope, path).ok_or_else(&missing)? = Value::from(mode + 1);
    Ok(())
}

/// Recovery-campaign failure modes. Every variant is fail-closed: the caller
/// receives the exact reason and no repaired state.
#[derive(Debug, Error)]
pub enum RecoveryCampaignError {
    /// The frozen migration ladder rejected the frontier.
    #[error("frontier migration failed closed: {0}")]
    Frontier(String),
    /// Prepared or battle content identity diverged.
    #[error("content identity mismatch: {0}")]
    ContentIdentity(String),
    /// Canonical digest computation failed.
    #[error("canonical digest failed: {0}")]
    Digest(String),
    /// A tampering vector could not be applied to the envelope wire.
    #[error("tamper vector {vector} could not be applied: {detail}")]
    Tamper {
        /// Vector identifier.
        vector: String,
        /// Failure detail.
        detail: String,
    },
}
